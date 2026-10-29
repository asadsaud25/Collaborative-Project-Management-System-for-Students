"""Project file uploads (Supabase Storage) with a file contribution log."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.access import require_contributor, require_member
from app.core.database import get_db, rows
from app.core.security import get_current_user
from app.services.activity_service import log_activity
from app.services.common import profiles_map

router = APIRouter(tags=["files"])
BUCKET = "project-files"
MAX_BYTES = 20 * 1024 * 1024


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)[:120] or "file"


def _log(project_id: str, user_id: str, name: str, path: str, action: str):
    get_db().table("file_contribution_logs").insert({"project_id": project_id, "actor_id": user_id, "file_name": name,
                                                      "storage_path": path, "action": action}).execute()


@router.get("/projects/{project_id}/files")
def list_files(project_id: str, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    items = get_db().storage.from_(BUCKET).list(project_id) or []
    return [{"name": i["name"], "size": (i.get("metadata") or {}).get("size"), "updated_at": i.get("updated_at")} for i in items if i.get("name") != ".emptyFolderPlaceholder"]


@router.post("/projects/{project_id}/files", status_code=201)
async def upload_file(project_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    require_contributor(project_id, user)
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Files are limited to 20 MB")
    name = _safe(file.filename or "file")
    path = f"{project_id}/{name}"
    store = get_db().storage.from_(BUCKET)
    replaced = any(i["name"] == name for i in (store.list(project_id) or []))
    store.upload(path, data, {"content-type": file.content_type or "application/octet-stream", "upsert": "true"})
    _log(project_id, user["id"], name, path, "replaced" if replaced else "uploaded")
    log_activity(project_id, user["id"], "replaced a file" if replaced else "uploaded a file", "file", None, {"name": name})
    return {"name": name, "replaced": replaced}


@router.get("/projects/{project_id}/files/{name}/url")
def download_url(project_id: str, name: str, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    path = f"{project_id}/{_safe(name)}"
    res = get_db().storage.from_(BUCKET).create_signed_url(path, 300)
    url = res.get("signedURL") or res.get("signedUrl")
    if not url:
        raise HTTPException(404, "File not found")
    _log(project_id, user["id"], _safe(name), path, "downloaded")
    return {"url": url}
