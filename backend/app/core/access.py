"""Project-level authorization helpers used by every project-scoped endpoint.

Effective project roles:
  admin       platform admin (full access)
  supervisor  the project's assigned supervisor (manager + reviewer)
  owner       project owner / team lead (manager)
  reviewer    designated reviewer (may review milestones, read-only otherwise)
  member      regular team member
"""
from fastapi import HTTPException

from app.core.database import first, get_db


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


def require_manager(project_id: str, user: dict) -> tuple[dict, str]:
    project, role = require_member(project_id, user)
    if role not in ("admin", "supervisor", "owner"):
        raise HTTPException(403, "Only the project owner or supervisor can do that")
    return project, role


def require_reviewer(project_id: str, user: dict) -> tuple[dict, str]:
    project, role = require_member(project_id, user)
    if role not in ("admin", "supervisor", "owner", "reviewer"):
        raise HTTPException(403, "Only reviewers, the owner or the supervisor can review")
    return project, role


def member_ids(project_id: str) -> list[str]:
    data = get_db().table("project_members").select("user_id").eq("project_id", project_id).execute().data or []
    return [m["user_id"] for m in data]


def is_member_of(project_id: str, user_id: str) -> bool:
    return bool(first(get_db().table("project_members").select("id").eq("project_id", project_id).eq("user_id", user_id)))
