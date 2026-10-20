import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, GitCommit, MessageSquare, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, ErrorState, PageLoader, Progress, Stat, statusTone } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, errMsg } from "@/services/api";
import type { Commit, Meeting, Milestone, Task } from "@/types";
import { ago, fmtDate, fmtDateTime, isOverdue, label } from "@/utils/format";

interface Data { tasks: Task[]; completed_tasks: number; upcoming_deadlines: Task[]; personal_progress_percent: number; unread_messages: number; meetings: Meeting[];
  progress_by_project: { project_id: string; project_name: string; overall_percent: number; mine: { assigned_weight: number; completed_weight: number; percent: number } }[]; milestones_needing_attention: Milestone[]; commits: Commit[] }

/** Personal view: my tasks, deadlines, my share of weighted progress, meetings, messages and commits. */
export default function StudentDashboard() {
  const { profile } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["dashboard-student"], queryFn: async () => (await api.get<Data>("/dashboard/student")).data });
  if (isLoading) return <PageLoader />; if (error || !data) return <ErrorState message={errMsg(error)} retry={refetch} />;
  return (
    <div className="space-y-5" data-tour="dashboard">
      <div><h1 className="text-xl font-semibold tracking-tight">Hi {profile?.full_name.split(" ")[0]}</h1><p className="text-xs text-muted-foreground">Here is what needs your attention.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="My progress" value={`${data.personal_progress_percent}%`} hint="Approved share of my milestone weight" /><Stat label="Open tasks" value={data.tasks.length} /><Stat label="Completed tasks" value={data.completed_tasks} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Link to="/messages"><Stat label="Unread messages" value={data.unread_messages} icon={<MessageSquare className="h-4 w-4" />} /></Link></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>My tasks</CardTitle></CardHeader><CardBody className="divide-y !py-1">{!data.tasks.length ? <p className="py-3 text-xs text-muted-foreground">No open tasks assigned to you.</p> : data.tasks.slice(0, 8).map((t) => (
          <Link key={t.id} to={`/projects/${t.project_id}?tab=board`} className="flex items-center justify-between gap-2 py-2.5 hover:opacity-80"><div className="min-w-0"><p className="truncate text-sm">{t.title}</p><p className="text-xs text-muted-foreground">{t.project_name}</p></div>
            <div className="flex shrink-0 items-center gap-1.5"><Badge tone={statusTone(t.priority)}>{label(t.priority)}</Badge>{t.deadline && <Badge tone={isOverdue(t.deadline) ? "danger" : "neutral"}>{fmtDate(t.deadline)}</Badge>}</div></Link>))}</CardBody></Card>
        <Card><CardHeader><CardTitle>Progress by project</CardTitle></CardHeader><CardBody className="space-y-3 !pt-3">{!data.progress_by_project.length ? <Empty title="No projects yet" action={<Link to="/discover"><Button size="sm">Find a project</Button></Link>} /> : data.progress_by_project.map((p) => (
          <Link key={p.project_id} to={`/projects/${p.project_id}?tab=milestones`} className="block space-y-1.5"><div className="flex justify-between text-sm"><span>{p.project_name}</span><span className="text-xs text-muted-foreground">team {p.overall_percent}% · me {p.mine.percent}%</span></div><Progress value={p.overall_percent} tone="bg-success" /><Progress value={p.mine.percent} className="h-1" /></Link>))}</CardBody></Card>
        <Card><CardHeader><CardTitle>Upcoming meetings</CardTitle></CardHeader><CardBody className="space-y-2 !pt-3">{!data.meetings.length ? <p className="text-xs text-muted-foreground">No meetings scheduled.</p> : data.meetings.map((m) => <div key={m.id} className="flex items-center justify-between text-sm"><div><p>{m.title}</p><p className="text-xs text-muted-foreground">{fmtDateTime(m.starts_at)}</p></div>{m.meet_link && <a href={m.meet_link} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Video className="h-3.5 w-3.5" />Join</Button></a>}</div>)}</CardBody></Card>
        <Card><CardHeader><CardTitle>My recent commits</CardTitle></CardHeader><CardBody className="divide-y !py-1">{!data.commits.length ? <p className="py-3 text-xs text-muted-foreground">{profile?.github_username ? "No recent commits found in your connected projects." : "Add your GitHub username in your profile to see your commits here."}</p> : data.commits.map((c) => (
          <div key={c.sha} className="flex items-center gap-2 py-2 text-xs"><GitCommit className="h-3.5 w-3.5 text-muted-foreground" /><code className="rounded bg-muted px-1">{c.short_sha}</code><span className="min-w-0 flex-1 truncate">{c.message}</span><span className="text-muted-foreground">{c.date ? ago(c.date) : ""}</span></div>))}</CardBody></Card>
      </div>
      {!!data.milestones_needing_attention.length && <Card><CardHeader><CardTitle>Milestones needing attention</CardTitle></CardHeader><CardBody className="space-y-2 !pt-3">{data.milestones_needing_attention.map((m) => <Link key={m.id} to={`/projects/${m.project_id}?tab=milestones`} className="flex items-center justify-between text-sm"><span>{m.title}</span><Badge tone={statusTone(m.status)}>{label(m.status)}</Badge></Link>)}</CardBody></Card>}
    </div>
  );
}
