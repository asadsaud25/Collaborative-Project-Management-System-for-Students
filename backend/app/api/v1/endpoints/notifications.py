"""In-app notification feed plus the deadline-alert job."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from app.core.database import get_db, rows
from app.core.logging import get_logger
from app.core.security import get_current_user, require_admin
from app.services.common import load_tasks
from app.services.notification_service import notify

router = APIRouter(prefix="/notifications", tags=["notifications"])
log = get_logger("deadlines")


@router.get("")
def list_notifications(user: dict = Depends(get_current_user)):
    db = get_db()
    items = rows(db.table("notifications").select("*").eq("user_id", user["id"]).order("created_at", desc=True).limit(60))
    unread = db.table("notifications").select("id", count="exact").eq("user_id", user["id"]).is_("read_at", "null").execute().count or 0
    return {"items": items, "unread": unread}


@router.post("/read-all", status_code=204)
def read_all(user: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    get_db().table("notifications").update({"read_at": datetime.now(timezone.utc).isoformat()}).eq("user_id", user["id"]).is_("read_at", "null").execute()


@router.post("/{notification_id}/read", status_code=204)
def read_one(notification_id: str, user: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    get_db().table("notifications").update({"read_at": datetime.now(timezone.utc).isoformat()}).eq("id", notification_id).eq("user_id", user["id"]).execute()


def run_deadline_alerts() -> int:
    """Notify assignees about tasks due within 24h (once) and tasks that are overdue (once per day)."""
    today, tomorrow = date.today(), date.today() + timedelta(days=1)
    sent = 0
    for p in rows(get_db().table("projects").select("id,name").eq("status", "active")):
        for t in load_tasks(p["id"]):
            if t["status"] == "completed" or not t["deadline"] or not t["assignee_ids"]:
                continue
            d = date.fromisoformat(t["deadline"])
            link = f"/projects/{p['id']}?tab=board"
            if d < today:
                notify(t["assignee_ids"], "deadline_missed", f"Overdue: {t['title']}", f"Was due {t['deadline']} ({p['name']})", link,
                       dedupe_key=f"overdue:{t['id']}:{today.isoformat()}")
                sent += 1
            elif d <= tomorrow:
                notify(t["assignee_ids"], "deadline_soon", f"Due {'today' if d == today else 'tomorrow'}: {t['title']}", p["name"], link,
                       dedupe_key=f"soon:{t['id']}:{t['deadline']}")
                sent += 1
    log.info("deadline alerts run", extra={"ctx": {"tasks_notified": sent}})
    return sent


@router.post("/run-deadline-check")
def trigger(user: dict = Depends(require_admin)):
    """Manual trigger (admin). The same job runs automatically every hour."""
    return {"tasks_notified": run_deadline_alerts()}
