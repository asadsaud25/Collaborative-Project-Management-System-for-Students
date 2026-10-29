import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { RiskPanel } from "@/components/analytics/Analytics";
import { Avatar, Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, ErrorState, PageLoader, Progress, Stat, statusTone } from "@/components/ui";
import { api, errMsg } from "@/services/api";
import type { ActivityItem, Milestone, Risk } from "@/types";
import { ago, fmtDate, label } from "@/utils/format";

interface Data { projects: { id: string; name: string; course?: string; due_date?: string; progress: number; risk_count: number; health: string }[]; review_queue: Milestone[]; risks: Risk[]; activity: ActivityItem[] }

/** Supervisor view (read-only): supervised projects, milestones awaiting the lead's approval, health, risks and recent activity. */
export default function SupervisorDashboard() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["dashboard-supervisor"], meta: { inline: true }, queryFn: async () => (await api.get<Data>("/dashboard/supervisor")).data });
  const [, force] = useState(0);
  if (isLoading) return <PageLoader />; if (error || !data) return <ErrorState message={errMsg(error)} retry={() => { refetch(); force((x) => x + 1); }} />;
  const avg = data.projects.length ? Math.round(data.projects.reduce((a, p) => a + p.progress, 0) / data.projects.length) : 0;
  return (
    <div className="space-y-5" data-tour="dashboard">
      <div><h1 className="text-xl font-semibold tracking-tight">Supervisor dashboard</h1><p className="text-xs text-muted-foreground">Projects you supervise. You can view progress, comment and react; the project lead handles approvals.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Projects" value={data.projects.length} /><Stat label="Awaiting lead approval" value={data.review_queue.length} /><Stat label="Average progress" value={`${avg}%`} /><Stat label="Risk flags" value={data.risks.length} /></div>
      <Card><CardHeader><CardTitle>Awaiting lead approval</CardTitle></CardHeader><CardBody className="divide-y !py-1">{!data.review_queue.length ? <p className="py-3 text-xs text-muted-foreground">Nothing waiting. Submitted milestones appear here until the lead approves them.</p> : data.review_queue.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium">{m.title} <span className="font-normal text-muted-foreground">· {m.weight}%</span></p><p className="text-xs text-muted-foreground">{m.project_name} · {m.assignee?.full_name ?? "unassigned"} · submitted {m.submitted_at ? ago(m.submitted_at) : ""}</p></div>
          <Link to={`/projects/${m.project_id}?tab=milestones`}><Button size="sm" variant="outline">View</Button></Link></div>))}</CardBody></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Projects</CardTitle></CardHeader><CardBody className="space-y-3 !pt-3">{!data.projects.length ? <Empty title="No supervised projects" hint="Project leads add you by your email, when they create a project or later from the project page." /> : data.projects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="block space-y-1.5"><div className="flex items-center justify-between"><span className="text-sm font-medium">{p.name}</span><div className="flex items-center gap-1.5"><Badge tone={statusTone(p.health)}>{label(p.health)}</Badge><span className="text-xs text-muted-foreground">{p.progress}%</span></div></div><Progress value={p.progress} tone="bg-success" />{p.due_date && <p className="text-xs text-muted-foreground">Due {fmtDate(p.due_date)}</p>}</Link>))}</CardBody></Card>
        <RiskPanel risks={data.risks} />
      </div>
      <Card><CardHeader><CardTitle>Recent activity</CardTitle></CardHeader><CardBody className="divide-y !py-1">{!data.activity.length ? <p className="py-3 text-xs text-muted-foreground">No activity yet.</p> : data.activity.map((a) => (
        <div key={a.id} className="flex items-center gap-2 py-2 text-sm"><Avatar name={a.actor?.full_name} className="h-5 w-5" /><span className="min-w-0 flex-1 truncate"><span className="font-medium">{a.actor?.full_name ?? "Someone"}</span> <span className="text-muted-foreground">{a.action}</span></span><span className="text-xs text-muted-foreground">{ago(a.created_at)}</span></div>))}</CardBody></Card>
    </div>
  );
}
