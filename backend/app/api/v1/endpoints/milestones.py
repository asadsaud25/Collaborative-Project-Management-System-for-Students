"""Weighted milestones, submission queue and review (approve / request changes)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.access import member_ids, require_manager, require_member, require_reviewer
from app.core.crypto import decrypt
from app.core.database import first, get_db, rows
from app.core.security import get_current_user
from app.schemas.work import MilestoneCreate, MilestoneReview, MilestoneSubmit, MilestoneUpdate
from app.services import github_service
from app.services.activity_service import log_activity, log_milestone
from app.services.notification_service import notify
from app.services.progress_service import project_progress

router = APIRouter(tags=["milestones"])


def _get(milestone_id: str) -> dict:
    m = first(get_db().table("milestones").select("*").eq("id", milestone_id))
    if not m:
        raise HTTPException(404, "Milestone not found")
    return m


def _check_weight(project_id: str, weight: int, exclude_id: str | None = None) -> None:
    ms = rows(get_db().table("milestones").select("id,weight").eq("project_id", project_id))
    used = sum(m["weight"] for m in ms if m["id"] != exclude_id)
    if used + weight > 100:
        raise HTTPException(422, f"Weights would total {used + weight}%. Only {100 - used}% is still available.")


def _check_people(project_id: str, *ids: str | None) -> None:
    allowed = set(member_ids(project_id))
    for i in ids:
        if i and i not in allowed:
            raise HTTPException(422, "Assignees and reviewers must be project members")


@router.get("/projects/{project_id}/milestones")
def list_milestones(project_id: str, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    return {"milestones": rows(get_db().table("milestones").select("*").eq("project_id", project_id).order("start_date").order("created_at")),
            "progress": project_progress(project_id)}


@router.post("/projects/{project_id}/milestones", status_code=201)
def create_milestone(project_id: str, body: MilestoneCreate, user: dict = Depends(get_current_user)):
    require_manager(project_id, user)
    _check_weight(project_id, body.weight)
    _check_people(project_id, body.assignee_id, body.reviewer_id)
    m = get_db().table("milestones").insert({**body.model_dump(mode="json"), "project_id": project_id}).execute().data[0]
    log_milestone(project_id, m["id"], user["id"], "created", f"{m['title']} ({m['weight']}%)")
    log_activity(project_id, user["id"], "created a milestone", "milestone", m["id"], {"title": m["title"]})
    if m["assignee_id"]:
        notify([m["assignee_id"]], "milestone", f"Milestone assigned: {m['title']}", None, f"/projects/{project_id}?tab=milestones", exclude=user["id"])
    return m


@router.patch("/milestones/{milestone_id}")
def update_milestone(milestone_id: str, body: MilestoneUpdate, user: dict = Depends(get_current_user)):
    m = _get(milestone_id)
    require_manager(m["project_id"], user)
    patch = body.model_dump(mode="json", exclude_unset=True)
    if m["status"] == "approved" and ("weight" in patch or "status" in patch):
        raise HTTPException(409, "Approved milestones are locked. Their weight and status can no longer change.")
    if "weight" in patch:
        _check_weight(m["project_id"], patch["weight"], milestone_id)
    _check_people(m["project_id"], patch.get("assignee_id"), patch.get("reviewer_id"))
    if not patch:
        return m
    out = get_db().table("milestones").update(patch).eq("id", milestone_id).execute().data[0]
    log_milestone(m["project_id"], milestone_id, user["id"], "updated", ", ".join(patch))
    return out


@router.delete("/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: str, user: dict = Depends(get_current_user)):
    m = _get(milestone_id)
    require_manager(m["project_id"], user)
    get_db().table("milestones").delete().eq("id", milestone_id).execute()
    log_milestone(m["project_id"], None, user["id"], "deleted", m["title"])


@router.post("/milestones/{milestone_id}/submit")
def submit_milestone(milestone_id: str, body: MilestoneSubmit, user: dict = Depends(get_current_user)):
    """Student marks a milestone complete. It enters the review queue; progress does NOT change yet."""
    m = _get(milestone_id)
    project, role = require_member(m["project_id"], user)
    if m["assignee_id"] != user["id"] and role not in ("admin", "supervisor", "owner"):
        raise HTTPException(403, "Only the assignee or the project owner can submit this milestone")
    if m["status"] in ("approved", "in_review"):
        raise HTTPException(409, f"This milestone is already {m['status'].replace('_', ' ')}")
    out = get_db().table("milestones").update({
        "status": "in_review", "submission_note": body.note, "submission_commit_shas": body.commit_shas,
        "submitted_at": datetime.now(timezone.utc).isoformat(), "review_note": None}).eq("id", milestone_id).execute().data[0]
    log_milestone(project["id"], milestone_id, user["id"], "submitted", body.note)
    log_activity(project["id"], user["id"], "submitted a milestone for review", "milestone", milestone_id, {"title": m["title"]})
    reviewers = [project["owner_id"], project.get("supervisor_id") or "", m.get("reviewer_id") or ""]
    notify(reviewers, "review_requested", f"Review requested: {m['title']}", project["name"], f"/projects/{project['id']}?tab=milestones", exclude=user["id"])
    return out


@router.post("/milestones/{milestone_id}/review")
def review_milestone(milestone_id: str, body: MilestoneReview, user: dict = Depends(get_current_user)):
    """Approve (progress updates automatically) or send back with a note."""
    m = _get(milestone_id)
    project, role = require_reviewer(m["project_id"], user)
    if m["status"] != "in_review":
        raise HTTPException(409, "Only submitted milestones can be reviewed")
    if m["assignee_id"] == user["id"] and role != "admin":
        raise HTTPException(403, "You cannot approve your own milestone. Ask the supervisor or a designated reviewer.")
    if not body.approve and not (body.note or "").strip():
        raise HTTPException(422, "Add a note explaining what needs to change")
    status = "approved" if body.approve else "changes_requested"
    out = get_db().table("milestones").update({
        "status": status, "review_note": body.note, "reviewer_id": user["id"],
        "reviewed_at": datetime.now(timezone.utc).isoformat()}).eq("id", milestone_id).execute().data[0]
    log_milestone(project["id"], milestone_id, user["id"], status, body.note)
    log_activity(project["id"], user["id"], "approved a milestone" if body.approve else "requested changes on a milestone",
                 "milestone", milestone_id, {"title": m["title"]})
    notify([m["assignee_id"] or ""], "review_result",
           f"{'Approved' if body.approve else 'Changes requested'}: {m['title']}", body.note, f"/projects/{project['id']}?tab=milestones")
    return {"milestone": out, "progress": project_progress(project["id"])}


@router.get("/milestones/{milestone_id}/evidence")
def milestone_evidence(milestone_id: str, user: dict = Depends(get_current_user)):
    """Reviewer view: commits the student attached plus the assignee's commits in the milestone window."""
    m = _get(milestone_id)
    project, _ = require_reviewer(m["project_id"], user)
    if not project.get("github_token_enc"):
        return {"connected": False, "attached": [], "assignee_commits": []}
    token = decrypt(project["github_token_enc"])
    owner, repo = project["github_owner"], project["github_repo"]
    attached = []
    for sha in (m["submission_commit_shas"] or [])[:20]:
        try:
            c = github_service.gh_get(f"/repos/{owner}/{repo}/commits/{sha}", token)
            attached.append({"sha": c["sha"], "short_sha": c["sha"][:7], "message": c["commit"]["message"].split("\n")[0],
                             "author": (c.get("author") or {}).get("login") or c["commit"]["author"]["name"],
                             "date": c["commit"]["author"]["date"], "url": c["html_url"]})
        except HTTPException as exc:
            attached.append({"sha": sha, "short_sha": sha[:7], "message": f"Could not load commit ({exc.detail})", "author": "", "date": None, "url": None})
    assignee_commits: list = []
    if m["assignee_id"]:
        prof = first(get_db().table("profiles").select("github_username").eq("id", m["assignee_id"]))
        if prof and prof.get("github_username"):
            params = {"author": prof["github_username"], "per_page": 20}
            if m.get("start_date"):
                params["since"] = f"{m['start_date']}T00:00:00Z"
            if m.get("submitted_at"):
                params["until"] = m["submitted_at"]
            data = github_service.gh_get(f"/repos/{owner}/{repo}/commits", token, params)
            assignee_commits = [{"sha": c["sha"], "short_sha": c["sha"][:7], "message": c["commit"]["message"].split("\n")[0],
                                 "author": prof["github_username"], "date": c["commit"]["author"]["date"], "url": c["html_url"]} for c in data]
    return {"connected": True, "attached": attached, "assignee_commits": assignee_commits}
