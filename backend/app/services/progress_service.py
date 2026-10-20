"""Weighted progress, risk indicators and contribution analytics."""
from datetime import date, datetime, timedelta, timezone

from app.core.crypto import decrypt
from app.core.database import get_db, rows
from app.core.logging import get_logger
from app.services import github_service
from app.services.common import load_tasks

log = get_logger("progress")


def project_progress(project_id: str) -> dict:
    """Overall progress = sum of weights of APPROVED milestones (0-100).
    Individual progress = approved weight among milestones assigned to that member."""
    ms = rows(get_db().table("milestones").select("id,weight,status,assignee_id").eq("project_id", project_id))
    approved = sum(m["weight"] for m in ms if m["status"] == "approved")
    total = sum(m["weight"] for m in ms)
    per_user: dict[str, dict] = {}
    for m in ms:
        if not m["assignee_id"]:
            continue
        u = per_user.setdefault(m["assignee_id"], {"assigned_weight": 0, "completed_weight": 0})
        u["assigned_weight"] += m["weight"]
        if m["status"] == "approved":
            u["completed_weight"] += m["weight"]
    for u in per_user.values():
        u["percent"] = round(100 * u["completed_weight"] / u["assigned_weight"]) if u["assigned_weight"] else 0
    return {"overall_percent": approved, "planned_weight": total, "unallocated_weight": max(0, 100 - total),
            "approved_weight": approved, "per_user": per_user}


def compute_risks(project: dict, persist: bool = True) -> list[dict]:
    today = date.today()
    pid = project["id"]
    risks: list[dict] = []
    for t in load_tasks(pid):
        if t["status"] != "completed" and t["deadline"] and date.fromisoformat(t["deadline"]) < today:
            risks.append({"kind": "overdue_task", "severity": "high", "entity_id": t["id"],
                          "title": f"Task overdue: {t['title']} (due {t['deadline']})"})
        if t["priority"] in ("high", "urgent") and not t["assignee_ids"] and t["status"] != "completed":
            risks.append({"kind": "unassigned_high_priority", "severity": "medium", "entity_id": t["id"],
                          "title": f"High-priority task has no owner: {t['title']}"})
    for m in rows(get_db().table("milestones").select("*").eq("project_id", pid)):
        if m["status"] != "approved" and m["end_date"] and date.fromisoformat(m["end_date"]) < today:
            risks.append({"kind": "delayed_milestone", "severity": "high", "entity_id": m["id"],
                          "title": f"Milestone delayed: {m['title']} (target {m['end_date']})"})
        if m["status"] == "in_review" and m["submitted_at"]:
            sub = datetime.fromisoformat(m["submitted_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - sub > timedelta(days=3):
                risks.append({"kind": "stalled_review", "severity": "low", "entity_id": m["id"],
                              "title": f"Waiting for review over 3 days: {m['title']}"})
    if persist:
        db = get_db()
        db.table("risk_indicators").delete().eq("project_id", pid).execute()
        if risks:
            db.table("risk_indicators").insert([{**r, "project_id": pid} for r in risks]).execute()
    return risks


def health_label(progress_pct: int, risks: list[dict]) -> str:
    high = sum(1 for r in risks if r["severity"] == "high")
    if high >= 3:
        return "at_risk"
    if high >= 1 or len(risks) >= 4:
        return "needs_attention"
    return "healthy"


def project_commits(project: dict, limit: int = 100) -> list[dict]:
    """Commits from GitHub if connected; [] on any failure (analytics must not break)."""
    if not (project.get("github_owner") and project.get("github_token_enc")):
        return []
    try:
        token = decrypt(project["github_token_enc"])
        return github_service.fetch_activity(project["github_owner"], project["github_repo"], token, per_page=limit)["commits"]
    except Exception as exc:
        log.warning("commit fetch failed", extra={"ctx": {"project": project["id"], "error": str(getattr(exc, 'detail', exc))}})
        return []


def contributions(project: dict) -> dict:
    pid = project["id"]
    members = rows(get_db().table("project_members").select("user_id").eq("project_id", pid))
    uids = [m["user_id"] for m in members]
    profs = {p["id"]: p for p in rows(get_db().table("profiles").select("id,full_name,github_username").in_("id", uids))} if uids else {}
    tasks = load_tasks(pid)
    prog = project_progress(pid)
    commits = project_commits(project)
    commit_counts: dict[str, int] = {}
    for c in commits:
        commit_counts[c["author"].lower()] = commit_counts.get(c["author"].lower(), 0) + 1
    out = []
    for uid in uids:
        p = profs.get(uid, {})
        mine = [t for t in tasks if uid in t["assignee_ids"]]
        gh = (p.get("github_username") or "").lower()
        out.append({
            "user_id": uid, "name": p.get("full_name", "Unknown"),
            "tasks_assigned": len(mine), "tasks_completed": sum(1 for t in mine if t["status"] == "completed"),
            "milestone_weight_approved": prog["per_user"].get(uid, {}).get("completed_weight", 0),
            "commits": commit_counts.get(gh, 0) if gh else 0, "github_username": p.get("github_username"),
        })
    return {"members": out, "github_connected": bool(project.get("github_token_enc")),
            "note": "These figures summarise recorded activity only. They are not a complete measure of anyone's effort."}
