"""Project-level authorization helpers used by every project-scoped endpoint.

Effective project roles:
  admin       platform admin (full access)
  owner       project lead (full control of the project)
  member      regular team member (works on tasks, milestones, ideas, files)
  supervisor  the project's assigned supervisor: READ, COMMENT, REACT and VIEW only

Which helper to use:
  require_member       any role above; for reads, comments and reactions
  require_contributor  admin / owner / member; for creating or changing work (tasks, ideas, files, submissions)
  require_lead         admin / owner; for managing the project (milestones, meetings, team, settings, approvals)
  require_oversight    admin / owner / supervisor; for read-only reports such as exports
"""
from fastapi import HTTPException

from app.core.database import first, get_db

SUPERVISOR_READ_ONLY = "Supervisors have read-only access: they can view, comment and react, but not make changes."


def get_project(project_id: str) -> dict:
    p = first(get_db().table("projects").select("*").eq("id", project_id))
    if not p:
        raise HTTPException(404, "Project not found")
    return p


def project_role(project: dict, user: dict) -> str | None:
    if user["role"] == "admin":
        return "admin"
    if project.get("supervisor_id") == user["id"]:
        return "supervisor"
    m = first(get_db().table("project_members").select("role").eq("project_id", project["id"]).eq("user_id", user["id"]))
    return m["role"] if m else None


def require_member(project_id: str, user: dict) -> tuple[dict, str]:
    project = get_project(project_id)
    role = project_role(project, user)
    if not role:
        raise HTTPException(403, "You are not a member of this project")
    return project, role


def require_contributor(project_id: str, user: dict) -> tuple[dict, str]:
    project, role = require_member(project_id, user)
    if role == "supervisor":
        raise HTTPException(403, SUPERVISOR_READ_ONLY)
    return project, role


def require_lead(project_id: str, user: dict) -> tuple[dict, str]:
    project, role = require_member(project_id, user)
    if role == "supervisor":
        raise HTTPException(403, SUPERVISOR_READ_ONLY)
    if role not in ("admin", "owner"):
        raise HTTPException(403, "Only the project lead can do that")
    return project, role


def require_oversight(project_id: str, user: dict) -> tuple[dict, str]:
    project, role = require_member(project_id, user)
    if role not in ("admin", "owner", "supervisor"):
        raise HTTPException(403, "Only the project lead or supervisor can view this")
    return project, role


def member_ids(project_id: str) -> list[str]:
    data = get_db().table("project_members").select("user_id").eq("project_id", project_id).execute().data or []
    return [m["user_id"] for m in data]


def lead_ids(project: dict) -> list[str]:
    """Everyone who can approve and manage: the owner plus any co-owners."""
    data = get_db().table("project_members").select("user_id").eq("project_id", project["id"]).eq("role", "owner").execute().data or []
    return list(dict.fromkeys([project["owner_id"], *[m["user_id"] for m in data]]))


def is_member_of(project_id: str, user_id: str) -> bool:
    return bool(first(get_db().table("project_members").select("id").eq("project_id", project_id).eq("user_id", user_id)))
