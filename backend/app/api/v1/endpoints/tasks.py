"""Task CRUD, assignment / reassignment, priorities, dates and dependencies."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.access import member_ids, require_member
from app.core.database import first, get_db, rows
from app.core.security import get_current_user
from app.schemas.work import TaskCreate, TaskUpdate
from app.services.activity_service import log_activity, log_task
from app.services.common import load_tasks
from app.services.notification_service import notify

router = APIRouter(tags=["tasks"])
MANAGER_ROLES = ("admin", "supervisor", "owner")


def _validate_refs(project_id: str, assignee_ids: list[str], depends_on: list[str], milestone_id: str | None, task_id: str | None = None):
    db = get_db()
    bad = set(assignee_ids) - set(member_ids(project_id))
    if bad:
        raise HTTPException(422, "Tasks can only be assigned to project members")
    if depends_on:
        found = {t["id"] for t in rows(db.table("tasks").select("id").eq("project_id", project_id).in_("id", depends_on))}
        if found != set(depends_on):
            raise HTTPException(422, "A dependency refers to a task outside this project")
        if task_id and _creates_cycle(project_id, task_id, depends_on):
            raise HTTPException(422, "That dependency would create a loop")
    if milestone_id and not first(db.table("milestones").select("id").eq("id", milestone_id).eq("project_id", project_id)):
        raise HTTPException(422, "Milestone not found in this project")


def _creates_cycle(project_id: str, task_id: str, new_deps: list[str]) -> bool:
    edges: dict[str, list[str]] = {}
    for t in load_tasks(project_id):
        edges[t["id"]] = list(t["depends_on"])
    edges[task_id] = list(new_deps)
    seen, stack = set(), list(new_deps)
    while stack:
        cur = stack.pop()
        if cur == task_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(edges.get(cur, []))
    return False


def _set_assignees(task: dict, new_ids: list[str], actor: dict, project: dict) -> None:
    db = get_db()
    old = {a["user_id"] for a in rows(db.table("task_assignees").select("user_id").eq("task_id", task["id"]))}
    new = set(new_ids)
    if old == new:
        return
    if old - new:
        db.table("task_assignees").delete().eq("task_id", task["id"]).in_("user_id", list(old - new)).execute()
    if new - old:
        db.table("task_assignees").insert([{"task_id": task["id"], "user_id": u} for u in new - old]).execute()
    action = "reassigned" if old else "assigned"
    log_task(project["id"], task["id"], actor["id"], action, ",".join(sorted(old)) or None, ",".join(sorted(new)) or None)
    log_activity(project["id"], actor["id"], f"{action} task", "task", task["id"], {"title": task["title"]})
    notify(list(new - old), "task_assigned", f"Task {action} to you: {task['title']}", project["name"],
           f"/projects/{project['id']}?tab=board", exclude=actor["id"])
    notify(list(old - new), "task_reassigned", f"You were unassigned from: {task['title']}", project["name"],
           f"/projects/{project['id']}?tab=board", exclude=actor["id"])


@router.get("/projects/{project_id}/tasks")
def list_tasks(project_id: str, user: dict = Depends(get_current_user)):
    require_member(project_id, user)
    return load_tasks(project_id)


@router.post("/projects/{project_id}/tasks", status_code=201)
def create_task(project_id: str, body: TaskCreate, user: dict = Depends(get_current_user)):
    project, _ = require_member(project_id, user)
    _validate_refs(project_id, body.assignee_ids, body.depends_on, body.milestone_id)
    data = body.model_dump(mode="json", exclude={"assignee_ids", "depends_on"})
    data.update({"project_id": project_id, "created_by": user["id"]})
    if data["status"] == "completed":
        data["completed_at"] = datetime.now(timezone.utc).isoformat()
    task = get_db().table("tasks").insert(data).execute().data[0]
    if body.depends_on:
        get_db().table("task_dependencies").insert([{"task_id": task["id"], "depends_on_task_id": d} for d in body.depends_on]).execute()
    log_task(project_id, task["id"], user["id"], "created", None, task["status"])
    log_activity(project_id, user["id"], "created a task", "task", task["id"], {"title": task["title"]})
    _set_assignees(task, body.assignee_ids, user, project)
    task["assignee_ids"], task["depends_on"] = body.assignee_ids, body.depends_on
    return task


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, body: TaskUpdate, user: dict = Depends(get_current_user)):
    db = get_db()
    task = first(db.table("tasks").select("*").eq("id", task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    project, role = require_member(task["project_id"], user)
    current = next(t for t in load_tasks(task["project_id"]) if t["id"] == task_id)
    if role not in MANAGER_ROLES and user["id"] not in current["assignee_ids"] and task["created_by"] != user["id"]:
        raise HTTPException(403, "Only the owner, an assignee or the creator can edit this task")

    patch = body.model_dump(mode="json", exclude_unset=True, exclude={"assignee_ids", "depends_on"})
    new_deps = body.depends_on if body.depends_on is not None else current["depends_on"]
    new_assignees = body.assignee_ids if body.assignee_ids is not None else current["assignee_ids"]
    _validate_refs(task["project_id"], new_assignees, new_deps if body.depends_on is not None else [],
                   patch.get("milestone_id"), task_id if body.depends_on is not None else None)

    new_status = patch.get("status")
    if new_status and new_status != task["status"]:
        if new_status != "todo" and new_deps:
            open_deps = rows(db.table("tasks").select("title").in_("id", new_deps).neq("status", "completed"))
            if open_deps:
                raise HTTPException(409, "Blocked by unfinished dependencies: " + ", ".join(d["title"] for d in open_deps))
        patch["completed_at"] = datetime.now(timezone.utc).isoformat() if new_status == "completed" else None
        log_task(task["project_id"], task_id, user["id"], "completed" if new_status == "completed" else "status_changed",
                 task["status"], new_status)
    if patch:
        task = db.table("tasks").update(patch).eq("id", task_id).execute().data[0]
    if body.depends_on is not None:
        db.table("task_dependencies").delete().eq("task_id", task_id).execute()
        if body.depends_on:
            db.table("task_dependencies").insert([{"task_id": task_id, "depends_on_task_id": d} for d in body.depends_on]).execute()
    if body.assignee_ids is not None:
        _set_assignees(task, body.assignee_ids, user, project)
    if new_status and new_status != current["status"]:
        log_activity(task["project_id"], user["id"], f"moved a task to {new_status.replace('_', ' ')}", "task", task_id, {"title": task["title"]})
    return next(t for t in load_tasks(task["project_id"]) if t["id"] == task_id)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    task = first(get_db().table("tasks").select("*").eq("id", task_id))
    if not task:
        raise HTTPException(404, "Task not found")
    _, role = require_member(task["project_id"], user)
    if role not in MANAGER_ROLES and task["created_by"] != user["id"]:
        raise HTTPException(403, "Only the owner, supervisor or the task's creator can delete it")
    get_db().table("tasks").delete().eq("id", task_id).execute()
    log_task(task["project_id"], None, user["id"], "deleted", task["title"], None)
    log_activity(task["project_id"], user["id"], "deleted a task", "task", None, {"title": task["title"]})
