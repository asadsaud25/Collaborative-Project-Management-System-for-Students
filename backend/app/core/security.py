"""Authentication: validates the Supabase access token sent by the frontend.

Works with both legacy HS256 and newer asymmetric Supabase projects because it
asks Supabase Auth itself (/auth/v1/user) instead of verifying the JWT locally.
Validated tokens are cached for 60 seconds.
"""
import time

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.database import first, get_db

bearer = HTTPBearer(auto_error=False)
_cache: dict[str, tuple[float, dict]] = {}


def verify_token(token: str) -> dict:
    now = time.time()
    hit = _cache.get(token)
    if hit and hit[0] > now:
        return hit[1]
    s = get_settings()
    try:
        r = httpx.get(
            f"{s.supabase_url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": s.supabase_anon_key or s.supabase_service_role_key},
            timeout=8,
        )
    except httpx.HTTPError:
        raise HTTPException(503, "Authentication service unreachable")
    if r.status_code != 200:
        raise HTTPException(401, "Session expired. Please sign in again.")
    user = r.json()
    if len(_cache) > 2000:
        _cache.clear()
    _cache[token] = (now + 60, user)
    return user


def _ensure_profile(auth_user: dict) -> dict:
    db = get_db()
    profile = first(db.table("profiles").select("*").eq("id", auth_user["id"]))
    if profile:
        return profile
    meta = auth_user.get("user_metadata") or {}
    row = {
        "id": auth_user["id"],
        "email": auth_user.get("email", ""),
        "full_name": meta.get("full_name") or meta.get("name") or (auth_user.get("email", "").split("@")[0]),
        "avatar_url": meta.get("avatar_url"),
    }
    db.table("profiles").upsert(row).execute()
    return first(db.table("profiles").select("*").eq("id", auth_user["id"])) or row


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Sign in to continue")
    profile = _ensure_profile(verify_token(creds.credentials))
    if profile.get("is_suspended"):
        raise HTTPException(403, "This account has been suspended. Contact an administrator.")
    return profile


def require_roles(*roles: str):
    """Dependency factory: require one of the given application roles."""
    def dep(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "You do not have permission to do that")
        return user
    return dep


require_admin = require_roles("admin")
