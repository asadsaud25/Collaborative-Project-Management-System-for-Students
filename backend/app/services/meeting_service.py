"""Creates a meeting link. Uses Google Calendar (real Google Meet) when GOOGLE_* credentials are set,
otherwise falls back to a Jitsi room so the scheduler always works."""
import uuid
from datetime import datetime, timedelta

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("meeting")


def _google_access_token() -> str | None:
    s = get_settings()
    if not (s.google_client_id and s.google_client_secret and s.google_refresh_token):
        return None
    r = httpx.post("https://oauth2.googleapis.com/token", timeout=10, data={
        "client_id": s.google_client_id, "client_secret": s.google_client_secret,
        "refresh_token": s.google_refresh_token, "grant_type": "refresh_token"})
    return r.json().get("access_token") if r.status_code == 200 else None


def create_meeting_link(title: str, starts_at: datetime, duration_min: int, attendee_emails: list[str]) -> tuple[str, str]:
    """Returns (url, provider) where provider is 'google_meet' or 'jitsi'."""
    try:
        token = _google_access_token()
        if token:
            end = starts_at + timedelta(minutes=duration_min)
            r = httpx.post(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                params={"conferenceDataVersion": 1, "sendUpdates": "none"}, timeout=15,
                headers={"Authorization": f"Bearer {token}"},
                json={"summary": title, "start": {"dateTime": starts_at.isoformat()},
                      "end": {"dateTime": end.isoformat()},
                      "attendees": [{"email": e} for e in attendee_emails],
                      "conferenceData": {"createRequest": {"requestId": uuid.uuid4().hex,
                                                           "conferenceSolutionKey": {"type": "hangoutsMeet"}}}})
            link = r.json().get("hangoutLink") if r.status_code < 300 else None
            if link:
                return link, "google_meet"
            log.warning("google calendar did not return a Meet link", extra={"ctx": {"status": r.status_code}})
    except Exception as exc:
        log.warning("google meet creation failed", extra={"ctx": {"error": str(exc)}})
    return f"https://meet.jit.si/cpms-{uuid.uuid4().hex[:12]}", "jitsi"
