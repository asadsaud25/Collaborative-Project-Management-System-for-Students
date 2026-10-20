"""'Report user' complaints filed by any signed-in user; reviewed in the admin dashboard."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.database import first, get_db, rows
from app.core.security import get_current_user
from app.schemas.social import ComplaintCreate
from app.services.notification_service import notify

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/complaints", status_code=201)
def file_complaint(body: ComplaintCreate, user: dict = Depends(get_current_user)):
    if body.reported_user_id == user["id"]:
        raise HTTPException(400, "You cannot report yourself")
    db = get_db()
    if not first(db.table("profiles").select("id").eq("id", body.reported_user_id)):
        raise HTTPException(404, "That user does not exist")
    c = db.table("complaints").insert({**body.model_dump(), "reporter_id": user["id"]}).execute().data[0]
    admins = [a["id"] for a in rows(db.table("profiles").select("id").eq("role", "admin"))]
    notify(admins, "complaint", "New user report filed", body.reason.replace("_", " "), "/admin")
    return {"id": c["id"], "status": c["status"]}


@router.get("/complaints/mine")
def my_complaints(user: dict = Depends(get_current_user)):
    return rows(get_db().table("complaints").select("id,reason,status,created_at").eq("reporter_id", user["id"]).order("created_at", desc=True))
