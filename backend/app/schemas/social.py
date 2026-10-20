from typing import Literal

from pydantic import BaseModel, Field


class IdeaCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    body: str = ""
    color: str = "slate"


class IdeaUpdate(BaseModel):
    status: Literal["open", "planned", "done", "dropped"]


class IdeaVote(BaseModel):
    reaction: Literal["up", "heart", "rocket", "think"] = "up"


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class DMCreate(BaseModel):
    recipient_id: str
    body: str = Field(min_length=1, max_length=4000)


class ThreadCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    body: str = ""
    category: str = "general"


class ComplaintCreate(BaseModel):
    reported_user_id: str
    project_id: str | None = None
    reason: Literal["harassment", "no_contribution", "plagiarism", "spam", "other"]
    details: str | None = Field(None, max_length=2000)


class ComplaintResolve(BaseModel):
    status: Literal["reviewing", "resolved", "dismissed"]
    note: str | None = None


class RoleUpdate(BaseModel):
    role: Literal["admin", "supervisor", "student"]


class SuspendUpdate(BaseModel):
    suspended: bool


class UniversityCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    department: str | None = None
