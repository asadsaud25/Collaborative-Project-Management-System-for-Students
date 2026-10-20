"""Direct messages, community forum and the live WebSocket channel."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.core.database import first, get_db, rows
from app.core.security import get_current_user, verify_token
from app.schemas.social import CommentCreate, DMCreate, ThreadCreate
from app.services.common import profiles_map
from app.services.notification_service import notify
from app.services.realtime import manager

router = APIRouter(tags=["messages"])


# ------------------------------------------------------------ direct messages
@router.get("/dm/conversations")
def conversations(user: dict = Depends(get_current_user)):
    db = get_db()
    msgs = rows(db.table("direct_messages").select("*").or_(f"sender_id.eq.{user['id']},recipient_id.eq.{user['id']}")
                .order("created_at", desc=True).limit(500))
    convo: dict[str, dict] = {}
    for m in msgs:
        other = m["recipient_id"] if m["sender_id"] == user["id"] else m["sender_id"]
        c = convo.setdefault(other, {"user_id": other, "last_message": m["body"], "last_at": m["created_at"], "unread": 0})
        if m["recipient_id"] == user["id"] and not m["read_at"]:
            c["unread"] += 1
    profs = profiles_map(list(convo))
    return sorted([{**c, "profile": profs.get(uid)} for uid, c in convo.items()], key=lambda c: c["last_at"], reverse=True)


@router.get("/dm/{other_id}")
def thread(other_id: str, user: dict = Depends(get_current_user)):
    db, me = get_db(), user["id"]
    msgs = rows(db.table("direct_messages").select("*")
                .or_(f"and(sender_id.eq.{me},recipient_id.eq.{other_id}),and(sender_id.eq.{other_id},recipient_id.eq.{me})")
                .order("created_at").limit(300))
    db.table("direct_messages").update({"read_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("recipient_id", me).eq("sender_id", other_id).is_("read_at", "null").execute()
    return msgs


@router.post("/dm", status_code=201)
def send_dm(body: DMCreate, user: dict = Depends(get_current_user)):
    if body.recipient_id == user["id"]:
        raise HTTPException(400, "You cannot message yourself")
    target = first(get_db().table("profiles").select("id,is_suspended").eq("id", body.recipient_id))
    if not target or target["is_suspended"]:
        raise HTTPException(404, "Recipient not found")
    msg = get_db().table("direct_messages").insert({"sender_id": user["id"], "recipient_id": body.recipient_id, "body": body.body}).execute().data[0]
    manager.push(body.recipient_id, {"event": "dm", "data": msg})
    return msg


# ------------------------------------------------------------ forum
@router.get("/forum/threads")
def list_threads(category: str | None = None, q: str = Query("", max_length=80), user: dict = Depends(get_current_user)):
    db = get_db()
    qq = db.table("forum_threads").select("*")
    if category:
        qq = qq.eq("category", category)
    if q.strip():
        qq = qq.ilike("title", f"%{q.strip()}%")
    threads = rows(qq.order("created_at", desc=True).limit(100))
    if not threads:
        return []
    posts = rows(db.table("forum_posts").select("thread_id").in_("thread_id", [t["id"] for t in threads]))
    authors = profiles_map([t["author_id"] for t in threads])
    return [{**t, "author": authors.get(t["author_id"]), "reply_count": sum(1 for p in posts if p["thread_id"] == t["id"])} for t in threads]


@router.post("/forum/threads", status_code=201)
def create_thread(body: ThreadCreate, user: dict = Depends(get_current_user)):
    return get_db().table("forum_threads").insert({**body.model_dump(), "author_id": user["id"]}).execute().data[0]


@router.get("/forum/threads/{thread_id}")
def read_thread(thread_id: str, user: dict = Depends(get_current_user)):
    t = first(get_db().table("forum_threads").select("*").eq("id", thread_id))
    if not t:
        raise HTTPException(404, "Thread not found")
    posts = rows(get_db().table("forum_posts").select("*").eq("thread_id", thread_id).order("created_at"))
    authors = profiles_map([t["author_id"]] + [p["author_id"] for p in posts])
    return {**t, "author": authors.get(t["author_id"]), "posts": [{**p, "author": authors.get(p["author_id"])} for p in posts]}


@router.post("/forum/threads/{thread_id}/posts", status_code=201)
def reply(thread_id: str, body: CommentCreate, user: dict = Depends(get_current_user)):
    t = first(get_db().table("forum_threads").select("id,author_id,title").eq("id", thread_id))
    if not t:
        raise HTTPException(404, "Thread not found")
    post = get_db().table("forum_posts").insert({"thread_id": thread_id, "author_id": user["id"], "body": body.body}).execute().data[0]
    notify([t["author_id"]], "forum_reply", f"{user['full_name']} replied to “{t['title']}”", body.body[:120], "/forum", exclude=user["id"])
    return post


@router.delete("/forum/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: str, user: dict = Depends(get_current_user)):
    t = first(get_db().table("forum_threads").select("author_id").eq("id", thread_id))
    if not t:
        raise HTTPException(404, "Thread not found")
    if t["author_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Only the author or an administrator can delete a thread")
    get_db().table("forum_threads").delete().eq("id", thread_id).execute()


# ------------------------------------------------------------ websocket
@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = Query("")):
    """Live channel: pushes {event: 'notification' | 'dm', data}. Authenticate with ?token=<supabase access token>."""
    try:
        import anyio
        auth_user = await anyio.to_thread.run_sync(verify_token, token)
    except Exception:
        await ws.close(code=4401)
        return
    await manager.connect(auth_user["id"], ws)
    try:
        while True:
            await ws.receive_text()      # keep-alive pings from the client
    except WebSocketDisconnect:
        manager.disconnect(auth_user["id"], ws)
