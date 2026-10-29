from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

TaskStatus = Literal["todo", "in_progress", "in_review", "completed"]
Priority = Literal["low", "medium", "high", "urgent"]


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    status: TaskStatus = "todo"
    priority: Priority = "medium"
    milestone_id: str | None = None
    start_date: date | None = None
    deadline: date | None = None
    assignee_ids: list[str] = []
    depends_on: list[str] = []


class TaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    status: TaskStatus | None = None
    priority: Priority | None = None
    milestone_id: str | None = None
    start_date: date | None = None
    deadline: date | None = None
    assignee_ids: list[str] | None = None     # replacing the list = (re)assignment
    depends_on: list[str] | None = None
    position: int | None = None


class MilestoneCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    completion_criteria: str | None = None
    phase: str | None = None
    weight: int = Field(ge=1, le=100)
    start_date: date | None = None
    end_date: date | None = None
    assignee_id: str | None = None


class MilestoneUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    completion_criteria: str | None = None
    phase: str | None = None
    weight: int | None = Field(None, ge=1, le=100)
    start_date: date | None = None
    end_date: date | None = None
    assignee_id: str | None = None
    status: Literal["planned", "in_progress"] | None = None


class MilestoneSubmit(BaseModel):
    note: str | None = Field(None, max_length=2000)
    commit_shas: list[str] = []


class MilestoneReview(BaseModel):
    approve: bool
    note: str | None = Field(None, max_length=2000)


class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = None
    instant: bool = False
    starts_at: datetime | None = None
    duration_min: int = Field(30, ge=5, le=480)
    participant_ids: list[str] | None = None   # None = everyone on the project
