"""Profile endpoints. Sign-up / sign-in / Google OAuth are handled by Supabase Auth in the browser;
the backend only validates the resulting session token."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db, rows
from app.core.security import get_current_user
from app.schemas.user import ProfileUpdate
from app.services.common import PROFILE_COLS

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    """Current user's profile, role and profile-completeness flag."""
    complete = bool(user.get("full_name") and user.get("university") and user.get("course"))
    return {**user, "profile_complete": complete}


@router.patch("/me")
def update_me(body: ProfileUpdate, user: dict = Depends(get_current_user)):
    """Update own profile. Role and suspension can only be changed by an admin."""
    patch = body.model_dump(exclude_unset=True)
    if "skills" in patch and patch["skills"] is not None:
        patch["skills"] = [s.strip() for s in patch["skills"] if s.strip()][:30]
    if not patch:
        return user
    res = get_db().table("profiles").update(patch).eq("id", user["id"]).execute()
    return res.data[0]


@router.get("/users")
def search_users(q: str = Query("", max_length=80), user: dict = Depends(get_current_user)):
    """Find people by name or email (for DMs, reports and assignments)."""
    qq = get_db().table("profiles").select(PROFILE_COLS).neq("id", user["id"]).eq("is_suspended", False)
    if q.strip():
        term = q.strip().replace(",", " ")
        qq = qq.or_(f"full_name.ilike.%{term}%,email.ilike.%{term}%")
    return rows(qq.order("full_name").limit(20))


@router.get("/universities")
def universities(user: dict = Depends(get_current_user)):
    return rows(get_db().table("universities").select("*").order("name"))
