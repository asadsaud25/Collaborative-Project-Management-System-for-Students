"""Thin GitHub REST client that works with private repositories (PAT or OAuth token)."""
import hashlib
import hmac

import httpx
from fastapi import HTTPException

API = "https://api.github.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "CPMS"}


def gh_get(path: str, token: str, params: dict | None = None):
    try:
        r = httpx.get(f"{API}{path}", headers=_headers(token), params=params, timeout=15)
    except httpx.HTTPError:
        raise HTTPException(502, "GitHub could not be reached. Try again shortly.")
    if r.status_code == 401:
        raise HTTPException(401, "GitHub rejected the stored token. Reconnect the repository.")
    if r.status_code == 404:
        raise HTTPException(404, "Repository not found, or the token has no access to it (private repos need the 'repo' scope).")
    if r.status_code == 403:
        if r.headers.get("x-ratelimit-remaining") == "0":
            raise HTTPException(503, "GitHub rate limit reached. Try again later.")
        raise HTTPException(403, "GitHub refused the request. Check the token's permissions.")
    if r.status_code >= 400:
        raise HTTPException(502, f"GitHub returned {r.status_code}")
    return r.json()


def verify_repo(owner: str, repo: str, token: str) -> dict:
    return gh_get(f"/repos/{owner}/{repo}", token)


def list_repos(token: str) -> list[dict]:
    data = gh_get("/user/repos", token, {"per_page": 100, "sort": "pushed", "affiliation": "owner,collaborator,organization_member"})
    return [{"owner": r["owner"]["login"], "name": r["name"], "full_name": r["full_name"], "private": r["private"]} for r in data]


def fetch_activity(owner: str, repo: str, token: str, author: str | None = None, per_page: int = 30) -> dict:
    base = f"/repos/{owner}/{repo}"
    cparams: dict = {"per_page": per_page}
    if author:
        cparams["author"] = author
    commits = gh_get(f"{base}/commits", token, cparams)
    pulls = gh_get(f"{base}/pulls", token, {"state": "all", "sort": "updated", "direction": "desc", "per_page": 15})
    issues_raw = gh_get(f"{base}/issues", token, {"state": "all", "sort": "updated", "direction": "desc", "per_page": 30})
    branches = gh_get(f"{base}/branches", token, {"per_page": 30})
    return {
        "commits": [{
            "sha": c["sha"], "short_sha": c["sha"][:7],
            "message": (c["commit"]["message"] or "").split("\n")[0] or "Untitled commit",
            "author": (c.get("author") or {}).get("login") or (c["commit"].get("author") or {}).get("name") or "unknown",
            "date": (c["commit"].get("author") or {}).get("date"), "url": c["html_url"],
        } for c in commits],
        "pull_requests": [{
            "number": p["number"], "title": p["title"], "state": "merged" if p.get("merged_at") else p["state"],
            "author": (p.get("user") or {}).get("login"), "updated_at": p["updated_at"], "url": p["html_url"],
            "branch": p["head"]["ref"],
        } for p in pulls],
        "issues": [{
            "number": i["number"], "title": i["title"], "state": i["state"],
            "author": (i.get("user") or {}).get("login"), "updated_at": i["updated_at"], "url": i["html_url"],
        } for i in issues_raw if "pull_request" not in i],
        "branches": [{"name": b["name"], "protected": b.get("protected", False), "sha": b["commit"]["sha"][:7]} for b in branches],
    }


def verify_webhook_signature(secret: str, body: bytes, signature: str | None) -> bool:
    if not signature or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def exchange_oauth_code(client_id: str, client_secret: str, code: str) -> str:
    r = httpx.post("https://github.com/login/oauth/access_token", timeout=15,
                   headers={"Accept": "application/json"},
                   data={"client_id": client_id, "client_secret": client_secret, "code": code})
    token = r.json().get("access_token")
    if not token:
        raise HTTPException(400, r.json().get("error_description", "GitHub did not return an access token"))
    return token
