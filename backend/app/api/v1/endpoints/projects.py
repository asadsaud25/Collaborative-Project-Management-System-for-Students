"""Projects, membership, invitations, join requests, team matching and import."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.access import get_project, project_role, require_manager, require_member
from app.core.config import get_settings
from app.core.database import first, get_db, rows
from app.core.security import get_current_user
from app.schemas.project import (InviteCreate, JoinDecision, JoinRequestCreate, MemberRoleUpdate, ProjectCreate,
                                 ProjectImport, ProjectUpdate)
from app.services.activity_service import log_activity
from app.services.common import profiles_map
from app.services.email_service import send_email
from app.services.notification_service import notify
from app.services.progress_service import project_progress

router = APIRouter(tags=["projects"])
HIDDEN = {"github_token_enc", "github_webhook_secret"}


def public_project(p: dict) -> dict:
    out = {k: v for k, v in p.items() if k not in HIDDEN}
    out["github_connected"] = bool(p.get("github_token_enc") and p.get("github_repo"))
    return out


def _managers(project: dict) -> list[str]:
    ids = [project["owner_id"]]
    if project.get("supervisor_id"):
        ids.append(project["supervisor_id"])
    return ids


# ------------------------------------------------------------------ projects
@router.get("/projects")
def list_projects(user: dict = Depends(get_current_user)):
    """Projects visible to me: all (admin), supervised + joined (supervisor), joined (student)."""
    db = get_db()
    ids = {m["project_id"] for m in rows(db.table("project_members").select("project_id").eq("user_id", user["id"]))}
    if user["role"] == "admin":
        projects = rows(db.table("projects").select("*").order("created_at", desc=True))
    else:
        ids |= {p["id"] for p in rows(db.table("projects").select("id").eq("supervisor_id", user["id"]))}
        projects = rows(db.table("projects").select("*").in_("id", list(ids)).order("created_at", desc=True)) if ids else []
    out = []
    for p in projects:
        pp = public_project(p)
        pp["progress"] = project_progress(p["id"])["overall_percent"]
        pp["my_role"] = project_role(p, user)
        out.append(pp)
    return out


@router.get("/projects/discover")
def discover(q: str = Query("", max_length=80), user: dict = Depends(get_current_user)):
    """Public projects the user has not joined yet (for join requests)."""
    db = get_db()
    mine = {m["project_id"] for m in rows(db.table("project_members").select("project_id").eq("user_id", user["id"]))}
    qq = db.table("projects").select("id,name,description,course,required_skills,owner_id,status").eq("visibility", "public").eq("status", "active")
    if q.strip():
        qq = qq.ilike("name", f"%{q.strip()}%")
    found = [p for p in rows(qq.order("created_at", desc=True).limit(50)) if p["id"] not in mine]
    pend = {j["project_id"] for j in rows(db.table("join_requests").select("project_id").eq("user_id", user["id"]).eq("status", "pending"))}
    owners = profiles_map([p["owner_id"] for p in found])
    return [{**p, "owner_name": owners.get(p["owner_id"], {}).get("full_name"), "request_pending": p["id"] in pend} for p in found]


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, user: dict = Depends(get_current_user)):
    db = get_db()
    data = body.model_dump(mode="json", exclude={"supervisor_email"})
    data["owner_id"] = user["id"]
    if body.supervisor_email:
        sup = first(db.table("profiles").select("id,role").ilike("email", body.supervisor_email))
        if sup and sup["role"] in ("supervisor", "admin"):
            data["supervisor_id"] = sup["id"]
    p = db.table("projects").insert(data).execute().data[0]
    db.table("project_members").upsert({"project_id": p["id"], "user_id": user["id"], "role": "owner"},
                                       on_conflict="project_id,user_id").execute()
    log_activity(p["id"], user["id"], "created the project", "project", p["id"], {"name": p["name"]})
    if p.get("supervisor_id"):
        notify([p["supervisor_id"]], "project", "You were assigned as supervisor", p["name"], f"/projects/{p['id']}")
    return public_project(p)


@router.post("/projects/import", status_code=201)
def import_project(body: ProjectImport, user: dict = Depends(get_current_user)):
    """Create a project from a JSON export (project + milestones + tasks)."""
    total = sum(int(m.get("weight", 0)) for m in body.milestones)
    if total > 100:
        raise HTTPException(422, f"Milestone weights total {total}%, the maximum is 100%")
    p = create_project(body.project, user)
    db = get_db()
    for m in body.milestones:
        db.table("milestones").insert({
            "project_id": p["id"], "title": m["title"], "weight": int(m["weight"]),
            "description": m.get("description"), "completion_criteria": m.get("completion_criteria"),
            "start_date": m.get("start_date"), "end_date": m.get("end_date")}).execute()
    for t in body.tasks:
        db.table("tasks").insert({
            "project_id": p["id"], "title": t["title"], "description": t.get("description", ""),
            "priority": t.get("priority", "medium") if t.get("priority") in ("low", "medium", "high", "urgent") else "medium",
            "deadline": t.get("deadline"), "created_by": user["id"]}).execute()
    log_activity(p["id"], user["id"], "imported project data", "project", p["id"],
                 {"milestones": len(body.milestones), "tasks": len(body.tasks)})
    return p


@router.get("/projects/{project_id}")
def read_project(project_id: str, user: dict = Depends(get_current_user)):
    project, role = require_member(project_id, user)
    out = public_project(project)
    out["my_role"] = role
    owner = profiles_map([project["owner_id"], project.get("supervisor_id") or ""])
    out["owner"] = owner.get(project["owner_id"])
    out["supervisor"] = owner.get(project.get("supervisor_id") or "")
    return out


@router.patch("/projects/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, user: dict = Depends(get_current_user)):
    require_manager(project_id, user)
    patch = body.model_dump(mode="json", exclude_unset=True)
    if not patch:
        return public_project(get_project(project_id))
    p = get_db().table("projects").update(patch).eq("id", project_id).execute().data[0]
    log_activity(project_id, user["id"], "updated project settings", "project", project_id, {"fields": list(patch)})
    return public_project(p)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    project = get_project(project_id)
    if project["owner_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Only the owner or an administrator can delete a project")
    get_db().table("projects").delete().eq("id", project_id).execute()


# ------------------------------------------------------------------ members
@router.get("/projects/{project_id}/members")
def list_members(project_id: str, user: dict = Depends(get_current_user)):
    project, _ = require_member(project_id, user)
    ms = rows(get_db().table("project_members").select("*").eq("project_id", project_id).order("joined_at"))
    profs = profiles_map([m["user_id"] for m in ms] + ([project["supervisor_id"]] if project.get("supervisor_id") else []))
    out = [{**m, "profile": profs.get(m["user_id"])} for m in ms]
    if project.get("supervisor_id") and project["supervisor_id"] not in {m["user_id"] for m in ms}:
        out.append({"id": f"sup-{project['supervisor_id']}", "project_id": project_id, "user_id": project["supervisor_id"],
                    "role": "supervisor", "joined_at": project["created_at"], "profile": profs.get(project["supervisor_id"])})
    return out


@router.patch("/projects/{project_id}/members/{user_id}")
def change_member_role(project_id: str, user_id: str, body: MemberRoleUpdate, user: dict = Depends(get_current_user)):
    require_manager(project_id, user)
    res = get_db().table("project_members").update({"role": body.role}).eq("project_id", project_id).eq("user_id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "Member not found")
    log_activity(project_id, user["id"], f"set a member's project role to {body.role}", "member", user_id)
    return res.data[0]


@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: str, user_id: str, user: dict = Depends(get_current_user)):
    project, role = require_member(project_id, user)
    if user_id != user["id"] and role not in ("admin", "supervisor", "owner"):
        raise HTTPException(403, "Only the project owner or supervisor can remove members")
    if user_id == project["owner_id"]:
        raise HTTPException(400, "The project owner cannot be removed. Transfer ownership or delete the project.")
    get_db().table("project_members").delete().eq("project_id", project_id).eq("user_id", user_id).execute()
    get_db().table("task_assignees").delete().eq("user_id", user_id).in_(
        "task_id", [t["id"] for t in rows(get_db().table("tasks").select("id").eq("project_id", project_id))] or ["00000000-0000-0000-0000-000000000000"]).execute()
    log_activity(project_id, user["id"], "removed a member" if user_id != user["id"] else "left the project", "member", user_id)
    if user_id != user["id"]:
        notify([user_id], "membership", f"You were removed from {project['name']}")


# ------------------------------------------------------------------ invites
@router.post("/projects/{project_id}/invites", status_code=201)
def create_invites(project_id: str, body: InviteCreate, user: dict = Depends(get_current_user)):
    """Create invite links and email them. The join link is always returned so it can be shared manually."""
    project, _ = require_manager(project_id, user)
    db, s = get_db(), get_settings()
    results = []
    for entry in body.invites:
        email = entry.email.lower()
        existing_user = first(db.table("profiles").select("id").ilike("email", email))
        if existing_user and first(db.table("project_members").select("id").eq("project_id", project_id).eq("user_id", existing_user["id"])):
            results.append({"email": email, "status": "already_member"})
            continue
        inv = first(db.table("project_invites").select("*").eq("project_id", project_id).ilike("email", email).eq("status", "pending"))
        if not inv:
            inv = db.table("project_invites").insert({"project_id": project_id, "email": email, "name": entry.name,
                                                      "invited_by": user["id"]}).execute().data[0]
        link = f"{s.frontend_url}/invite/{inv['token']}"
        sent = send_email(email, f"{user['full_name']} invited you to {project['name']} on CPMS",
                          "You're invited to a project",
                          f"<p>Hi {entry.name or 'there'},</p><p><b>{user['full_name']}</b> invited you to join "
                          f"<b>{project['name']}</b>. Sign in with Google or create an account using this email address "
                          f"and you'll be added automatically.</p>", "Join project", link)
        if existing_user:
            notify([existing_user["id"]], "invite", f"Invitation to {project['name']}", f"From {user['full_name']}", f"/invite/{inv['token']}")
        results.append({"email": email, "status": "invited", "link": link, "email_sent": sent, "invite_id": inv["id"]})
    log_activity(project_id, user["id"], f"invited {len(results)} people", "invite", None)
    return results


@router.get("/projects/{project_id}/invites")
def list_invites(project_id: str, user: dict = Depends(get_current_user)):
    require_manager(project_id, user)
    s = get_settings()
    inv = rows(get_db().table("project_invites").select("*").eq("project_id", project_id).eq("status", "pending").order("created_at", desc=True))
    return [{**i, "link": f"{s.frontend_url}/invite/{i['token']}"} for i in inv]


@router.delete("/projects/{project_id}/invites/{invite_id}", status_code=204)
def revoke_invite(project_id: str, invite_id: str, user: dict = Depends(get_current_user)):
    require_manager(project_id, user)
    get_db().table("project_invites").update({"status": "revoked"}).eq("id", invite_id).eq("project_id", project_id).execute()


@router.get("/invites/{token}")
def preview_invite(token: str):
    """Public: lets the join page show which project the link is for before sign-in."""
    inv = first(get_db().table("project_invites").select("*").eq("token", token))
    if not inv or inv["status"] != "pending" or inv["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise HTTPException(404, "This invitation is no longer valid")
    p = get_project(inv["project_id"])
    inviter = profiles_map([inv["invited_by"] or ""]).get(inv["invited_by"] or "")
    return {"project_name": p["name"], "email": inv["email"], "invited_by": inviter["full_name"] if inviter else None}


def _accept(inv: dict, user: dict) -> dict:
    db = get_db()
    db.table("project_members").upsert({"project_id": inv["project_id"], "user_id": user["id"], "role": "member"},
                                       on_conflict="project_id,user_id", ignore_duplicates=True).execute()
    db.table("project_invites").update({"status": "accepted"}).eq("id", inv["id"]).execute()
    project = get_project(inv["project_id"])
    log_activity(project["id"], user["id"], "joined via invitation", "member", user["id"])
    notify(_managers(project), "membership", f"{user['full_name']} joined {project['name']}", None, f"/projects/{project['id']}", exclude=user["id"])
    return {"project_id": project["id"], "project_name": project["name"]}


@router.post("/invites/{token}/accept")
def accept_invite(token: str, user: dict = Depends(get_current_user)):
    inv = first(get_db().table("project_invites").select("*").eq("token", token))
    if not inv or inv["status"] != "pending" or inv["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise HTTPException(404, "This invitation is no longer valid")
    if inv["email"].lower() != user["email"].lower():
        raise HTTPException(403, f"This invitation was sent to {inv['email']}. Sign in with that email address to accept it.")
    return _accept(inv, user)


@router.post("/invites/claim")
def claim_invites(user: dict = Depends(get_current_user)):
    """Called after every sign-in: joins the user to every pending, unexpired invite for their email."""
    invs = rows(get_db().table("project_invites").select("*").ilike("email", user["email"]).eq("status", "pending")
                .gt("expires_at", datetime.now(timezone.utc).isoformat()))
    return [_accept(i, user) for i in invs]


# ------------------------------------------------------------------ join requests
@router.post("/projects/{project_id}/join-requests", status_code=201)
def request_to_join(project_id: str, body: JoinRequestCreate, user: dict = Depends(get_current_user)):
    project = get_project(project_id)
    if project["visibility"] != "public" or project["status"] != "active":
        raise HTTPException(403, "This project is not accepting join requests")
    if project_role(project, user) in ("owner", "member", "reviewer", "supervisor"):
        raise HTTPException(409, "You are already part of this project")
    db = get_db()
    if first(db.table("join_requests").select("id").eq("project_id", project_id).eq("user_id", user["id"]).eq("status", "pending")):
        raise HTTPException(409, "You already have a pending request for this project")
    jr = db.table("join_requests").insert({"project_id": project_id, "user_id": user["id"], "message": body.message}).execute().data[0]
    notify(_managers(project), "join_request", f"{user['full_name']} asked to join {project['name']}", body.message, f"/projects/{project_id}?tab=team")
    log_activity(project_id, user["id"], "requested to join", "join_request", jr["id"])
    return jr


@router.get("/projects/{project_id}/join-requests")
def list_join_requests(project_id: str, user: dict = Depends(get_current_user)):
    require_manager(project_id, user)
    jrs = rows(get_db().table("join_requests").select("*").eq("project_id", project_id).eq("status", "pending").order("created_at"))
    profs = profiles_map([j["user_id"] for j in jrs])
    return [{**j, "profile": profs.get(j["user_id"])} for j in jrs]


@router.get("/me/join-requests")
def my_join_requests(user: dict = Depends(get_current_user)):
    return rows(get_db().table("join_requests").select("*").eq("user_id", user["id"]).order("created_at", desc=True))


@router.post("/join-requests/{request_id}/decide")
def decide_join_request(request_id: str, body: JoinDecision, user: dict = Depends(get_current_user)):
    db = get_db()
    jr = first(db.table("join_requests").select("*").eq("id", request_id))
    if not jr:
        raise HTTPException(404, "Request not found")
    project, _ = require_manager(jr["project_id"], user)
    if jr["status"] != "pending":
        raise HTTPException(409, "This request was already decided")
    db.table("join_requests").update({"status": "approved" if body.approve else "rejected", "decided_by": user["id"],
                                      "decided_at": datetime.now(timezone.utc).isoformat()}).eq("id", request_id).execute()
    if body.approve:
        db.table("project_members").upsert({"project_id": project["id"], "user_id": jr["user_id"], "role": "member"},
                                           on_conflict="project_id,user_id", ignore_duplicates=True).execute()
    notify([jr["user_id"]], "join_decision", f"Your request to join {project['name']} was {'approved' if body.approve else 'declined'}",
           None, f"/projects/{project['id']}" if body.approve else "/projects")
    log_activity(project["id"], user["id"], "approved a join request" if body.approve else "declined a join request", "join_request", request_id)
    return {"status": "approved" if body.approve else "rejected"}


# ------------------------------------------------------------------ evidence-based team matching
@router.get("/projects/{project_id}/matching")
def suggest_teammates(project_id: str, user: dict = Depends(get_current_user)):
    """Rank students by evidence: skill overlap with the project's required skills,
    shared course, and stated availability. Each suggestion lists the evidence used."""
    project, _ = require_manager(project_id, user)
    member_set = {m["user_id"] for m in rows(get_db().table("project_members").select("user_id").eq("project_id", project_id))}
    wanted = {s.lower() for s in project.get("required_skills") or []}
    cands = rows(get_db().table("profiles").select("id,full_name,email,skills,interests,course,university,availability,github_username")
                 .eq("role", "student").eq("is_suspended", False).limit(500))
    out = []
    for c in cands:
        if c["id"] in member_set:
            continue
        skills = {s.lower() for s in c["skills"] or []}
        overlap = sorted(wanted & skills)
        score = len(overlap) * 3
        evidence = [f"Has skill: {s}" for s in overlap]
        if project.get("course") and c.get("course") and project["course"].lower() == c["course"].lower():
            score += 2
            evidence.append(f"Same course: {c['course']}")
        if c.get("availability"):
            score += 1
            evidence.append(f"Availability: {c['availability']}")
        if score > 0:
            out.append({"profile": c, "score": score, "evidence": evidence})
    return sorted(out, key=lambda x: -x["score"])[:10]
