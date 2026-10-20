"""Administration: platform stats, users/roles, universities, complaint review queue, system health."""
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import get_settings
from app.core.database import first, get_db, rows
from app.core.security import require_admin
from app.schemas.social import ComplaintResolve, RoleUpdate, SuspendUpdate, UniversityCreate
from app.services.activity_service import log_activity
from app.services.common import profiles_map
from app.services.notification_service import notify

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _count(table: str, **eq) -> int:
    q = get_db().table(table).select("id", count="exact")
    for k, v in eq.items():
        q = q.eq(k, v)
    return q.limit(1).execute().count or 0


@router.get("/stats")
def stats():
    return {"users": _count("profiles"), "students": _count("profiles", role="student"), "supervisors": _count("profiles", role="supervisor"),
            "admins": _count("profiles", role="admin"), "suspended": _count("profiles", is_suspended=True),
            "projects": _count("projects"), "active_projects": _count("projects", status="active"),
            "tasks": _count("tasks"), "open_complaints": _count("complaints", status="open"), "universities": _count("universities")}


@router.get("/users")
def users(q: str = Query("", max_length=80), role: str | None = None):
    qq = get_db().table("profiles").select("id,full_name,email,role,university,course,is_suspended,created_at")
    if role:
        qq = qq.eq("role", role)
    if q.strip():
        term = q.strip().replace(",", " ")
        qq = qq.or_(f"full_name.ilike.%{term}%,email.ilike.%{term}%")
    return rows(qq.order("created_at", desc=True).limit(100))


@router.patch("/users/{user_id}/role")
def set_role(user_id: str, body: RoleUpdate, admin: dict = Depends(require_admin)):
    if user_id == admin["id"] and body.role != "admin":
        raise HTTPException(400, "You cannot remove your own admin role")
    res = get_db().table("profiles").update({"role": body.role}).eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "User not found")
    log_activity(None, admin["id"], f"set role to {body.role}", "user", user_id)
    notify([user_id], "role", f"Your role is now {body.role}", None, "/dashboard")
    return res.data[0]


@router.patch("/users/{user_id}/suspend")
def suspend(user_id: str, body: SuspendUpdate, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "You cannot suspend yourself")
    res = get_db().table("profiles").update({"is_suspended": body.suspended}).eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(404, "User not found")
    log_activity(None, admin["id"], "suspended a user" if body.suspended else "reinstated a user", "user", user_id)
    return res.data[0]


@router.get("/projects")
def all_projects():
    return rows(get_db().table("projects").select("id,name,status,course,owner_id,supervisor_id,due_date,created_at").order("created_at", desc=True).limit(100))


@router.get("/universities")
def list_universities():
    return rows(get_db().table("universities").select("*").order("name"))


@router.post("/universities", status_code=201)
def add_university(body: UniversityCreate):
    return get_db().table("universities").insert(body.model_dump()).execute().data[0]


@router.delete("/universities/{uni_id}", status_code=204)
def delete_university(uni_id: str):
    get_db().table("universities").delete().eq("id", uni_id).execute()


@router.get("/complaints")
def complaints(status: str | None = None):
    qq = get_db().table("complaints").select("*")
    if status:
        qq = qq.eq("status", status)
    items = rows(qq.order("created_at", desc=True).limit(100))
    profs = profiles_map([c["reporter_id"] for c in items] + [c["reported_user_id"] for c in items])
    return [{**c, "reporter": profs.get(c["reporter_id"]), "reported": profs.get(c["reported_user_id"])} for c in items]


@router.patch("/complaints/{complaint_id}")
def resolve_complaint(complaint_id: str, body: ComplaintResolve, admin: dict = Depends(require_admin)):
    patch = {"status": body.status, "resolution_note": body.note, "resolved_by": admin["id"],
             "resolved_at": datetime.now(timezone.utc).isoformat() if body.status != "reviewing" else None}
    res = get_db().table("complaints").update(patch).eq("id", complaint_id).execute()
    if not res.data:
        raise HTTPException(404, "Complaint not found")
    c = res.data[0]
    if body.status in ("resolved", "dismissed"):
        notify([c["reporter_id"]], "complaint", f"Your report was {body.status}", body.note, "/dashboard")
    return c


@router.get("/system")
def system_health():
    """DB connectivity, auth service reachability, email/GitHub/Meet configuration and recent error logs."""
    s = get_settings()
    checks = {}
    try:
        get_db().table("profiles").select("id").limit(1).execute()
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"
    try:
        checks["auth"] = "ok" if httpx.get(f"{s.supabase_url}/auth/v1/health", headers={"apikey": s.supabase_anon_key}, timeout=5).status_code < 500 else "degraded"
    except httpx.HTTPError:
        checks["auth"] = "unreachable"
    checks["email_provider"] = "resend" if s.resend_api_key else "sendgrid" if s.sendgrid_api_key else "not configured"
    checks["github_oauth"] = "configured" if s.github_oauth_client_id else "not configured"
    checks["google_meet"] = "configured" if s.google_refresh_token else "jitsi fallback"
    checks["token_encryption"] = "configured" if s.token_encryption_key else "MISSING"
    logs = rows(get_db().table("system_logs").select("*").order("created_at", desc=True).limit(30))
    return {"checks": checks, "recent_logs": logs}
