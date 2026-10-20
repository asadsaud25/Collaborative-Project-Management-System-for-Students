"""Creates in-app notifications and pushes them over WebSocket."""
from app.core.database import get_db
from app.core.logging import get_logger
from app.services.realtime import manager

log = get_logger("notify")


def notify(user_ids: list[str], type_: str, title: str, body: str | None = None,
           link: str | None = None, dedupe_key: str | None = None, exclude: str | None = None) -> None:
    """Notify users. `dedupe_key` (suffixed per user) makes the call idempotent."""
    targets = [u for u in dict.fromkeys(user_ids) if u and u != exclude]
    if not targets:
        return
    payload = [
        {"user_id": u, "type": type_, "title": title, "body": body, "link": link,
         **({"dedupe_key": f"{dedupe_key}:{u}"} if dedupe_key else {})}
        for u in targets
    ]
    try:
        q = get_db().table("notifications")
        if dedupe_key:
            res = q.upsert(payload, on_conflict="dedupe_key", ignore_duplicates=True).execute()
        else:
            res = q.insert(payload).execute()
        for row in res.data or []:
            manager.push(row["user_id"], {"event": "notification", "data": row})
    except Exception as exc:  # notifications must never break the main request
        log.warning("notification failed", extra={"ctx": {"error": str(exc)}})
