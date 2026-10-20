"""Supabase client (service role) plus tiny query helpers.

The service-role key bypasses RLS, so *every* endpoint must call an access
helper from app.core.access before touching project data.
"""
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_db() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def first(query: Any) -> dict | None:
    """Run a postgrest query and return the first row or None."""
    data = query.limit(1).execute().data
    return data[0] if data else None


def rows(query: Any) -> list[dict]:
    """Run a postgrest query and return all rows."""
    return query.execute().data or []
