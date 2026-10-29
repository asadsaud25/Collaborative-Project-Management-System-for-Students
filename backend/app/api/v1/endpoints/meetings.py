"""Meeting scheduler: instant or planned, all members (and the supervisor) or a subset, link auto-generated,
notified by email + DM + in-app. Only the project lead or an admin can schedule; supervisors can view and join."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.access import member_ids, require_lead, require_member
from app.core.config import get_settings
from app.core.database import first, get_db, rows
from app.core.security import get_current_user
from app.schemas.work import MeetingCreate
from app.services.activity_service import log_activity
from app.services.common import profiles_map
from app.services.email_service import EmailMessage, esc, send_many
from app.services.meeting_service import create_meeting_link
from app.services.notification_service import notify
from app.services.realtime import manager

router = APIRouter(tags=["meetings"])


@router.get("/projects/{project_id}/meetings")
def list_meetings(project_id: str, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    ms = rows(get_db().table("meetings").select("*").eq("project_id", project_id).order("starts_at"))
    if not ms:
        return []
    parts = rows(get_db().table("meeting_participants").select("meeting_id,user_id").in_("meeting_id", [m["id"] for m in ms]))
    for m in ms:
        m["participant_ids"] = [p["user_id"] for p in parts if p["meeting_id"] == m["id"]]
    return ms


@router.post("/projects/{project_id}/meetings", status_code=201)
def create_meeting(project_id: str, body: MeetingCreate, user: dict = Depends(get_current_user)):
    project, _ = require_lead(project_id, user)
    everyone = list(dict.fromkeys([*member_ids(project_id), *([project["supervisor_id"]] if project.get("supervisor_id") else [])]))
    ids = everyone if body.participant_ids is None else body.participant_ids
    if set(ids) - set(everyone):
        raise HTTPException(422, "Participants must be project members or the project supervisor")
    ids = list(dict.fromkeys([*ids, user["id"]]))
    starts = datetime.now(timezone.utc) if body.instant else body.starts_at
    if not starts:
        raise HTTPException(422, "Choose a start time or mark the meeting as instant")
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=timezone.utc)
    profs = profiles_map(ids)
    link, provider = create_meeting_link(body.title, starts, body.duration_min, [p["email"] for p in profs.values()])
    db = get_db()
    meeting = db.table("meetings").insert({
        "project_id": project_id, "title": body.title, "description": body.description, "starts_at": starts.isoformat(),
        "duration_min": body.duration_min, "is_instant": body.instant, "meet_link": link, "link_provider": provider,
        "created_by": user["id"]}).execute().data[0]
    db.table("meeting_participants").insert([{"meeting_id": meeting["id"], "user_id": u} for u in ids]).execute()
    when = "now" if body.instant else starts.strftime("%a %d %b, %H:%M UTC")
    dm_body = f"Meeting: {body.title}\nWhen: {when}\nJoin: {link}"
    others = [u for u in ids if u != user["id"] and profs.get(u)]
    outcomes = send_many([EmailMessage(
        to=profs[u]["email"], subject=f"Meeting: {body.title} ({project['name']})", title=body.title,
        body_html=f"<p><b>{esc(user['full_name'])}</b> scheduled a meeting for <b>{esc(project['name'])}</b>.</p><p>When: {esc(when)}</p>",
        cta_label="Join meeting", cta_url=link) for u in others])
    for uid in others:
        dm = db.table("direct_messages").insert({"sender_id": user["id"], "recipient_id": uid, "body": dm_body, "kind": "meeting"}).execute().data[0]
        manager.push(uid, {"event": "dm", "data": dm})
    notify(ids, "meeting", f"Meeting: {body.title}", when, f"/projects/{project_id}?tab=meetings", exclude=user["id"])
    log_activity(project_id, user["id"], "scheduled a meeting", "meeting", meeting["id"], {"title": body.title})
    return {**meeting, "participant_ids": ids, "emails_sent": sum(1 for o in outcomes if o.ok),
            "emails_failed": [{"email": o.to, "error": o.error} for o in outcomes if not o.ok]}


@router.delete("/meetings/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: str, user: dict = Depends(get_current_user)):
    m = first(get_db().table("meetings").select("*").eq("id", meeting_id))
    if not m:
        raise HTTPException(404, "Meeting not found")
    require_lead(m["project_id"], user)
    get_db().table("meetings").delete().eq("id", meeting_id).execute()
