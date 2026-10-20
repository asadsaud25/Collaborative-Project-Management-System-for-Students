"""Small shared query helpers."""
from app.core.database import get_db, rows

PROFILE_COLS = "id,full_name,email,avatar_url,github_username,role,university,course,class_name,skills"


def profiles_map(ids: list[str]) -> dict[str, dict]:
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    data = rows(get_db().table("profiles").select(PROFILE_COLS).in_("id", ids))
    return {p["id"]: p for p in data}


def load_tasks(project_id: str) -> list[dict]:
    """All tasks of a project with `assignee_ids` and `depends_on` filled in."""
    db = get_db()
    tasks = rows(db.table("tasks").select("*").eq("project_id", project_id).order("position").order("created_at"))
    if not tasks:
        return []
    ids = [t["id"] for t in tasks]
    assignees = rows(db.table("task_assignees").select("task_id,user_id").in_("task_id", ids))
    deps = rows(db.table("task_dependencies").select("task_id,depends_on_task_id").in_("task_id", ids))
    a_map: dict[str, list[str]] = {}
    d_map: dict[str, list[str]] = {}
    for a in assignees:
        a_map.setdefault(a["task_id"], []).append(a["user_id"])
    for d in deps:
        d_map.setdefault(d["task_id"], []).append(d["depends_on_task_id"])
    for t in tasks:
        t["assignee_ids"] = a_map.get(t["id"], [])
        t["depends_on"] = d_map.get(t["id"], [])
    return tasks
