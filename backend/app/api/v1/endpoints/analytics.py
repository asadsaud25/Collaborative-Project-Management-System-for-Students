"""Dashboards (student / supervisor / project overview), risk indicators, contribution analytics,
calendar feed, logs and report export (CSV / JSON / PDF)."""
import csv
import io
import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.access import require_member, require_oversight
from app.core.database import get_db, rows
from app.core.security import get_current_user
from app.services.common import load_tasks, profiles_map
from app.services.progress_service import (compute_risks, contributions, health_label, project_commits, project_progress)

router = APIRouter(tags=["analytics"])


def _my_project_ids(user: dict) -> list[str]:
    db = get_db()
    ids = {m["project_id"] for m in rows(db.table("project_members").select("project_id").eq("user_id", user["id"]))}
    ids |= {p["id"] for p in rows(db.table("projects").select("id").eq("supervisor_id", user["id"]))}
    return list(ids)


# ------------------------------------------------------------ student dashboard
@router.get("/dashboard/student")
def student_dashboard(user: dict = Depends(get_current_user)):
    db = get_db()
    pids = [m["project_id"] for m in rows(db.table("project_members").select("project_id").eq("user_id", user["id"]))]
    projects = rows(db.table("projects").select("*").in_("id", pids)) if pids else []
    my_tasks, progress, commits = [], [], []
    for p in projects:
        for t in load_tasks(p["id"]):
            if user["id"] in t["assignee_ids"]:
                my_tasks.append({**t, "project_name": p["name"]})
        pr = project_progress(p["id"])
        mine = pr["per_user"].get(user["id"], {"assigned_weight": 0, "completed_weight": 0, "percent": 0})
        progress.append({"project_id": p["id"], "project_name": p["name"], "overall_percent": pr["overall_percent"], "mine": mine})
        if user.get("github_username") and p.get("github_token_enc"):
            for c in project_commits(p, 50):
                if c["author"].lower() == user["github_username"].lower():
                    commits.append({**c, "project_name": p["name"]})
    open_tasks = [t for t in my_tasks if t["status"] != "completed"]
    open_tasks.sort(key=lambda t: (t["deadline"] is None, t["deadline"] or ""))
    now = datetime.now(timezone.utc).isoformat()
    meetings = []
    if pids:
        mine_m = {r["meeting_id"] for r in rows(db.table("meeting_participants").select("meeting_id").eq("user_id", user["id"]))}
        if mine_m:
            meetings = rows(db.table("meetings").select("*").in_("id", list(mine_m)).gte("starts_at", now).order("starts_at").limit(5))
    unread = db.table("direct_messages").select("id", count="exact").eq("recipient_id", user["id"]).is_("read_at", "null").execute().count or 0
    review = [m for m in rows(db.table("milestones").select("*").eq("assignee_id", user["id"])) if m["status"] in ("changes_requested", "in_review")]
    # milestones waiting for this user's approval: only on projects they lead, never their own work
    lead_pids = [m["project_id"] for m in rows(db.table("project_members").select("project_id").eq("user_id", user["id"]).eq("role", "owner"))]
    to_approve = []
    if lead_pids:
        names = {p["id"]: p["name"] for p in projects}
        to_approve = [{**m, "project_name": names.get(m["project_id"], "")} for m in
                      rows(db.table("milestones").select("*").in_("project_id", lead_pids).eq("status", "in_review"))
                      if m["assignee_id"] != user["id"]]
    weights = [p["mine"] for p in progress]
    assigned, done = sum(w["assigned_weight"] for w in weights), sum(w["completed_weight"] for w in weights)
    return {
        "tasks": open_tasks[:30], "completed_tasks": len(my_tasks) - len(open_tasks),
        "upcoming_deadlines": [t for t in open_tasks if t["deadline"]][:8],
        "personal_progress_percent": round(100 * done / assigned) if assigned else 0,
        "progress_by_project": progress, "meetings": meetings, "unread_messages": unread,
        "milestones_needing_attention": review, "milestones_to_approve": to_approve, "commits": sorted(commits, key=lambda c: c["date"] or "", reverse=True)[:10],
    }


# ------------------------------------------------------------ supervisor dashboard
@router.get("/dashboard/supervisor")
def supervisor_dashboard(user: dict = Depends(get_current_user)):
    if user["role"] not in ("supervisor", "admin"):
        raise HTTPException(403, "Supervisor access required")
    db = get_db()
    q = db.table("projects").select("id,name,course,status,due_date,owner_id")
    projects = rows(q if user["role"] == "admin" else q.eq("supervisor_id", user["id"]))
    summary, queue, all_risks, pids = [], [], [], [p["id"] for p in projects]
    for p in projects:
        pr = project_progress(p["id"])
        risks = compute_risks(p, persist=False)
        all_risks += [{**r, "project_id": p["id"], "project_name": p["name"]} for r in risks]
        summary.append({**p, "progress": pr["overall_percent"], "risk_count": len(risks), "health": health_label(pr["overall_percent"], risks)})
    if pids:
        pend = rows(db.table("milestones").select("*").in_("project_id", pids).eq("status", "in_review").order("submitted_at"))
        names = {p["id"]: p["name"] for p in projects}
        people = profiles_map([m["assignee_id"] or "" for m in pend])
        queue = [{**m, "project_name": names[m["project_id"]], "assignee": people.get(m["assignee_id"] or "")} for m in pend]
    activity = rows(db.table("activity_logs").select("*").in_("project_id", pids).order("created_at", desc=True).limit(25)) if pids else []
    actors = profiles_map([a["actor_id"] or "" for a in activity])
    return {"projects": summary, "review_queue": queue, "risks": all_risks[:30],
            "activity": [{**a, "actor": actors.get(a["actor_id"] or "")} for a in activity]}


# ------------------------------------------------------------ project overview
@router.get("/projects/{project_id}/overview")
def project_overview(project_id: str, user: dict = Depends(get_current_user)):
    project, role = require_member(project_id, user)
    tasks = load_tasks(project_id)
    pr = project_progress(project_id)
    risks = compute_risks(project)
    today = date.today().isoformat()
    by_status = {s: sum(1 for t in tasks if t["status"] == s) for s in ("todo", "in_progress", "in_review", "completed")}
    members = rows(get_db().table("project_members").select("user_id").eq("project_id", project_id))
    return {
        "progress": pr, "risks": risks, "health": health_label(pr["overall_percent"], risks),
        "task_counts": by_status, "task_total": len(tasks), "member_count": len(members),
        "upcoming_deadlines": sorted([t for t in tasks if t["deadline"] and t["deadline"] >= today and t["status"] != "completed"], key=lambda t: t["deadline"])[:6],
        "my_role": role,
    }


@router.get("/projects/{project_id}/risks")
def project_risks(project_id: str, user: dict = Depends(get_current_user)):
    project, _ = require_member(project_id, user)
    return compute_risks(project)


@router.get("/projects/{project_id}/contributions")
def project_contributions(project_id: str, user: dict = Depends(get_current_user)):
    project, _ = require_member(project_id, user)
    return contributions(project)


@router.get("/projects/{project_id}/calendar")
def calendar(project_id: str, user: dict = Depends(get_current_user)):
    """Everything with a date on one feed: task deadlines, milestone targets and meetings."""
    require_member(project_id, user)
    db = get_db()
    events = []
    for t in load_tasks(project_id):
        if t["deadline"]:
            events.append({"id": t["id"], "type": "task", "title": t["title"], "date": t["deadline"], "status": t["status"]})
    for m in rows(db.table("milestones").select("id,title,end_date,status,weight").eq("project_id", project_id)):
        if m["end_date"]:
            events.append({"id": m["id"], "type": "milestone", "title": f"{m['title']} ({m['weight']}%)", "date": m["end_date"], "status": m["status"]})
    for m in rows(db.table("meetings").select("id,title,starts_at,meet_link").eq("project_id", project_id)):
        events.append({"id": m["id"], "type": "meeting", "title": m["title"], "date": m["starts_at"][:10], "time": m["starts_at"], "link": m["meet_link"]})
    return sorted(events, key=lambda e: e["date"])


# ------------------------------------------------------------ logs
@router.get("/projects/{project_id}/logs/{kind}")
def logs(project_id: str, kind: str, limit: int = Query(50, le=200), user: dict = Depends(get_current_user)):
    """kind: activity | tasks | files | milestones"""
    require_member(project_id, user)
    table = {"activity": "activity_logs", "tasks": "task_contribution_logs", "files": "file_contribution_logs", "milestones": "milestone_logs"}.get(kind)
    if not table:
        raise HTTPException(404, "Unknown log type")
    data = rows(get_db().table(table).select("*").eq("project_id", project_id).order("created_at", desc=True).limit(limit))
    actors = profiles_map([d["actor_id"] or "" for d in data])
    return [{**d, "actor": actors.get(d["actor_id"] or "")} for d in data]


# ------------------------------------------------------------ export
@router.get("/projects/{project_id}/export")
def export_report(project_id: str, format: str = Query("json", pattern="^(json|csv|pdf)$"), user: dict = Depends(get_current_user)):
    project, _ = require_oversight(project_id, user)   # lead, supervisor (read-only) or admin
    tasks = load_tasks(project_id)
    ms = rows(get_db().table("milestones").select("*").eq("project_id", project_id).order("start_date"))
    pr = project_progress(project_id)
    contrib = contributions(project)
    names = profiles_map([u for t in tasks for u in t["assignee_ids"]] + [m["assignee_id"] or "" for m in ms])
    fname = "".join(c if c.isalnum() else "_" for c in project["name"])[:40] or "project"
    task_rows = [{"title": t["title"], "status": t["status"], "priority": t["priority"], "start_date": t["start_date"], "deadline": t["deadline"],
                  "assignees": ", ".join(names[u]["full_name"] for u in t["assignee_ids"] if u in names)} for t in tasks]
    ms_rows = [{"title": m["title"], "weight": m["weight"], "status": m["status"], "start_date": m["start_date"], "end_date": m["end_date"],
                "assignee": names.get(m["assignee_id"] or "", {}).get("full_name", ""), "description": m.get("description"),
                "completion_criteria": m.get("completion_criteria")} for m in ms]
    if format == "json":
        payload = {"project": {"name": project["name"], "description": project["description"], "course": project["course"],
                               "visibility": project["visibility"], "required_skills": project["required_skills"],
                               "start_date": project["start_date"], "due_date": project["due_date"]},
                   "generated_at": datetime.now(timezone.utc).isoformat(), "progress": pr, "milestones": ms_rows, "tasks": task_rows, "contributions": contrib}
        return Response(json.dumps(payload, indent=2, default=str), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{fname}.json"'})
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([f"Project: {project['name']}", f"Overall progress: {pr['overall_percent']}%"])
        w.writerow([])
        w.writerow(["MILESTONES"]); w.writerow(["title", "weight_%", "status", "start", "end", "assignee"])
        for m in ms_rows:
            w.writerow([m["title"], m["weight"], m["status"], m["start_date"], m["end_date"], m["assignee"]])
        w.writerow([]); w.writerow(["TASKS"]); w.writerow(["title", "status", "priority", "start", "deadline", "assignees"])
        for t in task_rows:
            w.writerow([t["title"], t["status"], t["priority"], t["start_date"], t["deadline"], t["assignees"]])
        w.writerow([]); w.writerow(["CONTRIBUTIONS (recorded activity, not a measure of effort)"])
        w.writerow(["member", "tasks_assigned", "tasks_completed", "milestone_weight_approved", "commits"])
        for c in contrib["members"]:
            w.writerow([c["name"], c["tasks_assigned"], c["tasks_completed"], c["milestone_weight_approved"], c["commits"]])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'})
    # pdf
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, title=f"{project['name']} progress report")
    st = getSampleStyleSheet()

    def tbl(header, body):
        t = Table([header] + [[str(c or "") for c in r] for r in body], repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111111")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                               ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.25, colors.grey)]))
        return t
    story = [Paragraph(f"{project['name']}: progress report", st["Title"]),
             Paragraph(f"Generated {datetime.now().strftime('%d %b %Y')}. Overall progress {pr['overall_percent']}% "
                       f"({pr['approved_weight']} of {pr['planned_weight']} planned weight approved).", st["Normal"]), Spacer(1, 12),
             Paragraph("Milestones", st["Heading2"]),
             tbl(["Title", "Weight", "Status", "End", "Assignee"], [[m["title"], f"{m['weight']}%", m["status"], m["end_date"], m["assignee"]] for m in ms_rows]),
             Spacer(1, 12), Paragraph("Tasks", st["Heading2"]),
             tbl(["Title", "Status", "Priority", "Deadline", "Assignees"], [[t["title"], t["status"], t["priority"], t["deadline"], t["assignees"]] for t in task_rows]),
             Spacer(1, 12), Paragraph("Contributions", st["Heading2"]),
             tbl(["Member", "Tasks done", "Assigned", "Weight", "Commits"],
                 [[c["name"], c["tasks_completed"], c["tasks_assigned"], c["milestone_weight_approved"], c["commits"]] for c in contrib["members"]]),
             Spacer(1, 6), Paragraph(contrib["note"], st["Italic"])]
    doc.build(story)
    return Response(out.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}.pdf"'})
