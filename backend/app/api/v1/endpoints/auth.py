"""Profile endpoints. Sign-up / sign-in / Google OAuth are handled by Supabase Auth in the browser;
the backend only validates the resulting session token."""
from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.core.security import get_current_user
from app.schemas.user import ProfileUpdate

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
