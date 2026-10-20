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
