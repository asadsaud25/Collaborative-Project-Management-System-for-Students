"""Aggregates every v1 router."""
from fastapi import APIRouter

from app.api.v1.endpoints import admin, analytics, auth, files, github, idea_board, meetings, messages, milestones, notifications, projects, reports, tasks

api_router = APIRouter()
for module in (auth, projects, tasks, milestones, meetings, github, idea_board, analytics, messages, notifications, files, reports, admin):
    api_router.include_router(module.router)
