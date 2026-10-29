from datetime import date
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str = ""
    course: str | None = None
    visibility: Literal["public", "private"] = "public"
    required_skills: list[str] = []
    start_date: date | None = None
    due_date: date | None = None
    supervisor_email: EmailStr | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=160)
    description: str | None = None
    course: str | None = None
    status: Literal["active", "on_hold", "completed", "archived"] | None = None
    visibility: Literal["public", "private"] | None = None
    required_skills: list[str] | None = None
    start_date: date | None = None
    due_date: date | None = None


class InviteEntry(BaseModel):
    email: EmailStr
    name: str | None = None


class InviteCreate(BaseModel):
    invites: list[InviteEntry] = Field(min_length=1, max_length=25)


class MemberRoleUpdate(BaseModel):
    role: Literal["owner", "member"]


class AssignSupervisor(BaseModel):
    supervisor_email: EmailStr


class JoinRequestCreate(BaseModel):
    message: str | None = Field(None, max_length=500)


class JoinDecision(BaseModel):
    approve: bool


class GithubConnect(BaseModel):
    owner: str = Field(pattern=r"^[A-Za-z0-9_.-]+$")
    repo: str = Field(pattern=r"^[A-Za-z0-9_.-]+$")
    token: str | None = None            # PAT; omit to reuse an OAuth token already stored
    auth_type: Literal["pat", "oauth"] = "pat"


class ProjectImport(BaseModel):
    """Shape produced by GET /projects/{id}/export?format=json (plus hand-written files)."""
    project: ProjectCreate
    milestones: list[dict] = []
    tasks: list[dict] = []
