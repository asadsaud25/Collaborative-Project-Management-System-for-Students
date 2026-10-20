"""Idea board: ideas, reactions/upvotes and threaded comments."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.access import require_manager, require_member
from app.core.database import first, get_db, rows
from app.core.security import get_current_user
from app.schemas.social import CommentCreate, IdeaCreate, IdeaUpdate, IdeaVote
from app.services.activity_service import log_activity
from app.services.common import profiles_map

router = APIRouter(tags=["ideas"])


def _idea(idea_id: str) -> dict:
    i = first(get_db().table("ideas").select("*").eq("id", idea_id))
    if not i:
        raise HTTPException(404, "Idea not found")
    return i


@router.get("/projects/{project_id}/ideas")
def list_ideas(project_id: str, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    db = get_db()
    ideas = rows(db.table("ideas").select("*").eq("project_id", project_id).order("created_at", desc=True))
    if not ideas:
        return []
    ids = [i["id"] for i in ideas]
    votes = rows(db.table("idea_votes").select("idea_id,user_id,reaction").in_("idea_id", ids))
    comments = rows(db.table("idea_comments").select("idea_id").in_("idea_id", ids))
    authors = profiles_map([i["author_id"] for i in ideas])
    out = []
    for i in ideas:
        v = [x for x in votes if x["idea_id"] == i["id"]]
        reactions: dict[str, int] = {}
        for x in v:
            reactions[x["reaction"]] = reactions.get(x["reaction"], 0) + 1
        out.append({**i, "author": authors.get(i["author_id"]), "reactions": reactions, "score": len(v),
                    "my_reactions": [x["reaction"] for x in v if x["user_id"] == user["id"]],
                    "comment_count": sum(1 for c in comments if c["idea_id"] == i["id"])})
    return sorted(out, key=lambda x: (-x["score"], x["created_at"]), reverse=False)


@router.post("/projects/{project_id}/ideas", status_code=201)
def create_idea(project_id: str, body: IdeaCreate, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    idea = get_db().table("ideas").insert({**body.model_dump(), "project_id": project_id, "author_id": user["id"]}).execute().data[0]
    log_activity(project_id, user["id"], "posted an idea", "idea", idea["id"], {"title": idea["title"]})
    return idea


@router.patch("/ideas/{idea_id}")
def update_idea(idea_id: str, body: IdeaUpdate, user: dict = Depends(get_current_user)):
    idea = _idea(idea_id)
    _, role = require_member(idea["project_id"], user)
    if idea["author_id"] != user["id"] and role not in ("admin", "supervisor", "owner"):
        raise HTTPException(403, "Only the author or project owner can change an idea's status")
    return get_db().table("ideas").update({"status": body.status}).eq("id", idea_id).execute().data[0]


@router.delete("/ideas/{idea_id}", status_code=204)
def delete_idea(idea_id: str, user: dict = Depends(get_current_user)):
    idea = _idea(idea_id)
    _, role = require_member(idea["project_id"], user)
    if idea["author_id"] != user["id"] and role not in ("admin", "supervisor", "owner"):
        raise HTTPException(403, "Only the author or project owner can delete an idea")
    get_db().table("ideas").delete().eq("id", idea_id).execute()


@router.post("/ideas/{idea_id}/vote")
def toggle_vote(idea_id: str, body: IdeaVote, user: dict = Depends(get_current_user)):
    idea = _idea(idea_id)
    require_member(idea["project_id"], user)
    db = get_db()
    existing = first(db.table("idea_votes").select("idea_id").eq("idea_id", idea_id).eq("user_id", user["id"]).eq("reaction", body.reaction))
    if existing:
        db.table("idea_votes").delete().eq("idea_id", idea_id).eq("user_id", user["id"]).eq("reaction", body.reaction).execute()
        return {"active": False}
    db.table("idea_votes").insert({"idea_id": idea_id, "user_id": user["id"], "reaction": body.reaction}).execute()
    return {"active": True}


@router.get("/ideas/{idea_id}/comments")
def list_comments(idea_id: str, user: dict = Depends(get_current_user)):
    idea = _idea(idea_id)
    require_member(idea["project_id"], user)
    cs = rows(get_db().table("idea_comments").select("*").eq("idea_id", idea_id).order("created_at"))
    authors = profiles_map([c["author_id"] for c in cs])
    return [{**c, "author": authors.get(c["author_id"])} for c in cs]


@router.post("/ideas/{idea_id}/comments", status_code=201)
def add_comment(idea_id: str, body: CommentCreate, user: dict = Depends(get_current_user)):
    idea = _idea(idea_id)
    require_member(idea["project_id"], user)
    return get_db().table("idea_comments").insert({"idea_id": idea_id, "author_id": user["id"], "body": body.body}).execute().data[0]
