"""Smoke tests that need no database: auth gate, error format and validation.
Run from backend/:  SUPABASE_URL=https://x.supabase.co SUPABASE_SERVICE_ROLE_KEY=k python -m pytest tests -q  (pip install pytest)"""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import get_current_user  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
FAKE = {"id": "u1", "role": "student", "full_name": "Test", "email": "t@x.io"}


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_requires_auth():
    r = client.get("/api/v1/projects")
    assert r.status_code == 401 and r.json()["error"]["message"]


def test_discover_route_not_shadowed():
    assert client.get("/api/v1/projects/discover").status_code == 401


def test_validation_message():
    app.dependency_overrides[get_current_user] = lambda: FAKE
    try:
        r = client.post("/api/v1/projects", json={"name": "x"})
        assert r.status_code == 422 and "name" in r.json()["error"]["message"]
        assert client.post("/api/v1/dm", json={"recipient_id": "u1", "body": "hi"}).status_code == 400
    finally:
        app.dependency_overrides.clear()


# ----------------------------------------------------------------------------- role boundaries
import asyncio  # noqa: E402
import uuid  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.api.v1.endpoints import messages  # noqa: E402
from app.core import access  # noqa: E402
from app.services import email_service  # noqa: E402

PID = str(uuid.uuid4())
UID = str(uuid.uuid4())
OTHER = str(uuid.uuid4())
PROJECT = {"id": PID, "owner_id": "owner-1", "supervisor_id": "sup-1", "name": "P"}


def as_user(monkeypatch, user_id: str, platform_role: str, member_role: str | None):
    """Pretend `user_id` has `member_role` in PROJECT (None = not a member)."""
    monkeypatch.setattr(access, "get_project", lambda _pid: PROJECT)
    monkeypatch.setattr(access, "first", lambda _q: {"role": member_role} if member_role else None)
    class Chain:                      # any .table().select().eq()... returns itself; first() is patched above
        def __getattr__(self, _n):
            return lambda *_a, **_k: self
    monkeypatch.setattr(access, "get_db", lambda: Chain())
    return {"id": user_id, "role": platform_role, "full_name": "T", "email": "t@x.io"}


def test_supervisor_is_read_only(monkeypatch):
    u = as_user(monkeypatch, "sup-1", "supervisor", None)
    assert access.require_member(PID, u)[1] == "supervisor"          # may read, comment, react
    assert access.require_oversight(PID, u)[1] == "supervisor"       # may view exports
    for guard in (access.require_contributor, access.require_lead):
        with pytest.raises(HTTPException) as e:
            guard(PID, u)
        assert e.value.status_code == 403


def test_lead_and_member_boundaries(monkeypatch):
    lead = as_user(monkeypatch, "owner-1", "student", "owner")
    assert access.require_lead(PID, lead)[1] == "owner"
    member = as_user(monkeypatch, "m-1", "student", "member")
    assert access.require_contributor(PID, member)[1] == "member"
    with pytest.raises(HTTPException) as e:
        access.require_lead(PID, member)
    assert e.value.status_code == 403
    admin = as_user(monkeypatch, "a-1", "admin", None)
    assert access.require_lead(PID, admin)[1] == "admin"
    stranger = as_user(monkeypatch, "x-1", "student", None)
    with pytest.raises(HTTPException) as e:
        access.require_member(PID, stranger)
    assert e.value.status_code == 403


@pytest.mark.parametrize("method,path,body", [
    ("post", f"/api/v1/projects/{PID}/tasks", {"title": "t"}),
    ("post", f"/api/v1/projects/{PID}/milestones", {"title": "m", "weight": 10}),
    ("post", f"/api/v1/projects/{PID}/meetings", {"title": "standup", "instant": True}),
    ("post", f"/api/v1/projects/{PID}/assign-supervisor", {"supervisor_email": "s@x.io"}),
    ("post", f"/api/v1/projects/{PID}/invites", {"invites": [{"email": "a@x.io"}]}),
    ("post", f"/api/v1/projects/{PID}/ideas", {"title": "idea"}),
])
def test_supervisor_gets_403_on_write_routes(monkeypatch, method, path, body):
    u = as_user(monkeypatch, "sup-1", "supervisor", None)
    app.dependency_overrides[get_current_user] = lambda: u
    try:
        r = getattr(client, method)(path, json=body)
        assert r.status_code == 403, (path, r.status_code, r.text)
        assert "read-only" in r.json()["error"]["message"]
    finally:
        app.dependency_overrides.clear()


# ----------------------------------------------------------------------------- direct messages
def test_dm_blocked_without_shared_project(monkeypatch):
    monkeypatch.setattr(messages, "can_send_dm", lambda s, r: False)
    app.dependency_overrides[get_current_user] = lambda: {**FAKE, "id": UID}
    try:
        r = client.post("/api/v1/dm", json={"recipient_id": OTHER, "body": "hi"})
        assert r.status_code == 403 and "share a project" in r.json()["error"]["message"]
    finally:
        app.dependency_overrides.clear()


def test_dm_rejects_malformed_ids():
    app.dependency_overrides[get_current_user] = lambda: {**FAKE, "id": UID}
    try:
        assert client.post("/api/v1/dm", json={"recipient_id": "x),or(id.neq.1", "body": "hi"}).status_code == 422
        assert client.get("/api/v1/dm/not-a-uuid").status_code == 422      # would otherwise reach a PostgREST filter
    finally:
        app.dependency_overrides.clear()


def test_removed_endpoints_are_gone():
    app.dependency_overrides[get_current_user] = lambda: {**FAKE, "id": UID, "role": "admin"}
    try:
        for path in ("/api/v1/admin/universities", "/api/v1/auth/universities", "/api/v1/auth/users"):
            assert client.get(path).status_code == 404, path
    finally:
        app.dependency_overrides.clear()


def test_profile_semester_validation():
    app.dependency_overrides[get_current_user] = lambda: {**FAKE, "id": UID}
    try:
        for bad in (0, 9, -1):
            assert client.patch("/api/v1/auth/me", json={"semester": bad}).status_code == 422
    finally:
        app.dependency_overrides.clear()


# ----------------------------------------------------------------------------- email dispatch
def msgs(n):
    return [email_service.EmailMessage(f"user{i}@x.io", "s", "t", "<p>b</p>", "Go", f"https://app/invite/{i}") for i in range(n)]


def test_every_recipient_gets_a_result_without_provider(monkeypatch):
    monkeypatch.setattr(email_service, "get_settings", lambda: type("S", (), {"resend_api_key": "", "sendgrid_api_key": ""})())
    res = email_service.send_many(msgs(3))
    assert [r.to for r in res] == [f"user{i}@x.io" for i in range(3)]
    assert not any(r.ok for r in res) and all(r.error for r in res)


class Resp:
    def __init__(self, status, payload=None, headers=None):
        self.status_code, self._p, self.headers, self.text = status, payload or {}, headers or {}, str(payload)

    def json(self):
        return self._p


def test_resend_uses_one_batch_request_for_all_recipients(monkeypatch):
    calls = []

    async def fake_post(_c, url, _h, payload):
        calls.append((url, payload))
        return Resp(200, {"data": []})

    monkeypatch.setattr(email_service, "_post", fake_post)
    res = asyncio.run(email_service._send_resend(None, "k", "CPMS <a@b.io>", msgs(5)))
    assert len(calls) == 1 and calls[0][0].endswith("/emails/batch") and len(calls[0][1]) == 5
    assert all(r.ok for r in res)
    assert {p["to"][0] for p in calls[0][1]} == {f"user{i}@x.io" for i in range(5)}          # one email per person
    assert len({p["html"] for p in calls[0][1]}) == 5                                          # each with its own link


def test_bad_batch_falls_back_so_other_recipients_still_get_mail(monkeypatch):
    async def fake_post(_c, url, _h, payload):
        if url.endswith("/batch"):
            return Resp(422, {"message": "invalid"})
        return Resp(422, {"message": "bad address"}) if payload["to"] == ["user1@x.io"] else Resp(200)

    async def no_sleep(_s):
        return None

    monkeypatch.setattr(email_service, "_post", fake_post)
    monkeypatch.setattr(email_service.asyncio, "sleep", no_sleep)
    res = asyncio.run(email_service._send_resend(None, "k", "CPMS <a@b.io>", msgs(3)))
    assert [r.ok for r in res] == [True, False, True] and "bad address" in res[1].error


def test_email_html_is_escaped():
    out = email_service._wrap("T", "<p>x</p>", "Go", 'https://a/b?"><script>')
    assert "<script>" not in out
