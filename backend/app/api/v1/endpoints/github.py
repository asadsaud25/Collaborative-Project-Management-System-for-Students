"""Private-repo GitHub integration: PAT or OAuth token, activity fetch, repo picker, webhook receiver."""
import json
import secrets
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.access import member_ids, require_manager, require_member
from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.core.database import first, get_db, rows
from app.core.logging import get_logger
from app.core.security import get_current_user
from app.schemas.project import GithubConnect
from app.services import github_service
from app.services.activity_service import log_activity
from app.services.notification_service import notify

router = APIRouter(tags=["github"])
log = get_logger("github")


def _token(project: dict) -> str:
    if not project.get("github_token_enc"):
        raise HTTPException(404, "No GitHub token is connected to this project")
    return decrypt(project["github_token_enc"])


@router.put("/projects/{project_id}/github")
def connect_repo(project_id: str, body: GithubConnect, user: dict = Depends(get_current_user)):
    """Connect a (private) repository using a Personal Access Token, or reuse a token saved by the OAuth flow."""
    project, _ = require_manager(project_id, user)
    token = body.token.strip() if body.token else None
    if not token:
        token = _token(project)          # OAuth token stored earlier
    repo = github_service.verify_repo(body.owner, body.repo, token)
    secret = project.get("github_webhook_secret") or secrets.token_hex(20)
    patch = {"github_owner": repo["owner"]["login"], "github_repo": repo["name"],
             "github_token_enc": encrypt(token), "github_auth_type": body.auth_type if body.token else (project.get("github_auth_type") or "oauth"),
             "github_webhook_secret": secret}
    get_db().table("projects").update(patch).eq("id", project_id).execute()
    s = get_settings()
    hook_url = f"{s.backend_url}/api/v1/github/webhook/{project_id}"
    hook_created = False
    try:  # best effort; needs admin:repo_hook scope and a publicly reachable backend URL
        r = httpx.post(f"https://api.github.com/repos/{repo['owner']['login']}/{repo['name']}/hooks", timeout=10,
                       headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "CPMS"},
                       json={"name": "web", "active": True, "events": ["push", "issues", "pull_request"],
                             "config": {"url": hook_url, "content_type": "json", "secret": secret}})
        hook_created = r.status_code in (201, 422)   # 422 = hook already exists
    except httpx.HTTPError:
        pass
    log_activity(project_id, user["id"], "connected a GitHub repository", "repository", None, {"repo": repo["full_name"], "private": repo["private"]})
    return {"repository": repo["full_name"], "private": repo["private"], "webhook_created": hook_created,
            "manual_webhook": None if hook_created else {"payload_url": hook_url, "content_type": "application/json", "secret": secret,
                                                         "events": ["push", "issues", "pull_request"]}}


@router.delete("/projects/{project_id}/github", status_code=204)
def disconnect_repo(project_id: str, user: dict = Depends(get_current_user)):
    require_manager(project_id, user)
    get_db().table("projects").update({"github_owner": None, "github_repo": None, "github_token_enc": None,
                                       "github_auth_type": None, "github_webhook_secret": None}).eq("id", project_id).execute()
    log_activity(project_id, user["id"], "disconnected the GitHub repository", "repository")


@router.get("/projects/{project_id}/github/activity")
def activity(project_id: str, author: str | None = None, user: dict = Depends(get_current_user)):
    project, _ = require_member(project_id, user)
    if not (project.get("github_owner") and project.get("github_token_enc")):
        return {"connected": False}
    data = github_service.fetch_activity(project["github_owner"], project["github_repo"], _token(project), author=author)
    return {"connected": True, "repository": f"{project['github_owner']}/{project['github_repo']}", **data}


@router.get("/projects/{project_id}/github/events")
def webhook_events(project_id: str, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    return rows(get_db().table("github_events").select("id,kind,title,author,url,ref,occurred_at").eq("project_id", project_id)
                .order("occurred_at", desc=True).limit(50))


@router.get("/projects/{project_id}/github/repos")
def my_repos(project_id: str, user: dict = Depends(get_current_user)):
    project, _ = require_manager(project_id, user)
    return github_service.list_repos(_token(project))


# ---------------------------------------------------------------- OAuth
class OAuthExchange(BaseModel):
    code: str
    state: str


@router.get("/github/oauth/url")
def oauth_url(project_id: str, user: dict = Depends(get_current_user)):
    s = get_settings()
    if not s.github_oauth_client_id:
        raise HTTPException(501, "GitHub OAuth is not configured on the server. Use a Personal Access Token instead.")
    require_manager(project_id, user)
    state = encrypt(json.dumps({"u": user["id"], "p": project_id, "t": int(time.time())}))
    redirect = f"{s.frontend_url}/github/callback"
    return {"url": f"https://github.com/login/oauth/authorize?client_id={s.github_oauth_client_id}&scope=repo%20read:user"
                   f"&redirect_uri={redirect}&state={state}"}


@router.post("/github/oauth/exchange")
def oauth_exchange(body: OAuthExchange, user: dict = Depends(get_current_user)):
    """Swap the OAuth code for a token, store it encrypted, and return the repos to pick from."""
    s = get_settings()
    try:
        st = json.loads(decrypt(body.state))
    except Exception:
        raise HTTPException(400, "Invalid OAuth state")
    if st["u"] != user["id"] or time.time() - st["t"] > 600:
        raise HTTPException(400, "OAuth session expired. Start again.")
    require_manager(st["p"], user)
    token = github_service.exchange_oauth_code(s.github_oauth_client_id, s.github_oauth_client_secret, body.code)
    get_db().table("projects").update({"github_token_enc": encrypt(token), "github_auth_type": "oauth"}).eq("id", st["p"]).execute()
    return {"project_id": st["p"], "repos": github_service.list_repos(token)}


# ---------------------------------------------------------------- webhook
@router.post("/github/webhook/{project_id}")
async def webhook(project_id: str, request: Request):
    """Public endpoint called by GitHub. Authenticated by the HMAC signature only."""
    body = await request.body()
    project = first(get_db().table("projects").select("id,name,github_webhook_secret").eq("id", project_id))
    if not project or not project.get("github_webhook_secret"):
        raise HTTPException(404, "Unknown project")
    if not github_service.verify_webhook_signature(project["github_webhook_secret"], body, request.headers.get("x-hub-signature-256")):
        raise HTTPException(401, "Bad signature")
    event = request.headers.get("x-github-event", "")
    p = json.loads(body or b"{}")
    row = None
    if event == "push" and p.get("commits"):
        branch = (p.get("ref") or "").split("/")[-1]
        n = len(p["commits"])
        row = {"kind": "push", "title": f"{n} commit{'s' if n != 1 else ''} pushed to {branch}: {p['commits'][-1]['message'].splitlines()[0]}",
               "author": (p.get("pusher") or {}).get("name"), "url": p.get("compare"), "ref": branch}
    elif event == "issues" and p.get("action") in ("opened", "closed", "reopened"):
        i = p["issue"]
        row = {"kind": "issues", "title": f"Issue #{i['number']} {p['action']}: {i['title']}", "author": i["user"]["login"], "url": i["html_url"]}
    elif event == "pull_request" and p.get("action") in ("opened", "closed", "reopened"):
        pr = p["pull_request"]
        act = "merged" if pr.get("merged") else p["action"]
        row = {"kind": "pull_request", "title": f"PR #{pr['number']} {act}: {pr['title']}", "author": pr["user"]["login"], "url": pr["html_url"],
               "ref": pr["head"]["ref"]}
    if row:
        get_db().table("github_events").insert({**row, "project_id": project_id, "payload": {"event": event, "action": p.get("action")}}).execute()
        notify(member_ids(project_id), "github", row["title"], project["name"], f"/projects/{project_id}?tab=github")
    return {"ok": True}
