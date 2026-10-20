"""Writes to the activity log, and the task / milestone / file contribution logs."""
from app.core.database import get_db
from app.core.logging import get_logger

log = get_logger("activity")


def log_activity(project_id: str | None, actor_id: str | None, action: str, entity_type: str,
                 entity_id: str | None = None, meta: dict | None = None) -> None:
    try:
        get_db().table("activity_logs").insert({
            "project_id": project_id, "actor_id": actor_id, "action": action,
            "entity_type": entity_type, "entity_id": entity_id, "meta": meta or {},
        }).execute()
    except Exception as exc:
        log.warning("activity log failed", extra={"ctx": {"error": str(exc)}})


def log_task(project_id: str, task_id: str | None, actor_id: str, action: str,
             from_value: str | None = None, to_value: str | None = None) -> None:
    try:
        get_db().table("task_contribution_logs").insert({
            "project_id": project_id, "task_id": task_id, "actor_id": actor_id,
            "action": action, "from_value": from_value, "to_value": to_value,
        }).execute()
    except Exception as exc:
        log.warning("task log failed", extra={"ctx": {"error": str(exc)}})


def log_milestone(project_id: str, milestone_id: str | None, actor_id: str, action: str, note: str | None = None) -> None:
    try:
        get_db().table("milestone_logs").insert({
            "project_id": project_id, "milestone_id": milestone_id, "actor_id": actor_id,
            "action": action, "note": note,
        }).execute()
    except Exception as exc:
        log.warning("milestone log failed", extra={"ctx": {"error": str(exc)}})
