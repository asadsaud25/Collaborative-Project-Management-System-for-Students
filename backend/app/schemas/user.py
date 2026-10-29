from pydantic import BaseModel, Field


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=120)
    university: str | None = None
    course: str | None = None
    semester: int | None = Field(None, ge=1, le=8)
    skills: list[str] | None = None
    interests: list[str] | None = None
    availability: str | None = None
    github_username: str | None = None
    avatar_url: str | None = None
