import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, PageLoader, Progress, Tabs, statusTone } from "@/components/ui";
import { useMembers } from "@/hooks/useProject";
import { api, download, toastError } from "@/services/api";
import type { ActivityItem, Progress as P, Risk } from "@/types";
import { ago, fmtDateTime, label } from "@/utils/format";

/** Overall vs individual weighted progress. */
export function ProgressPanel({ pid, progress }: { pid: string; progress: P }) {
  const members = useMembers(pid).data ?? [];
  return (
    <Card><CardHeader><CardTitle>Weighted progress</CardTitle><span className="text-2xl font-semibold">{progress.overall_percent}%</span></CardHeader>
      <CardBody className="space-y-3 !pt-3"><Progress value={progress.overall_percent} tone="bg-success" />
        <p className="text-xs text-muted-foreground">{progress.approved_weight}% approved of {progress.planned_weight}% planned{progress.unallocated_weight ? ` (${progress.unallocated_weight}% not yet allocated)` : ""}.</p>
        <div className="space-y-2 border-t pt-3">{Object.keys(progress.per_user).length === 0 ? <p className="text-xs text-muted-foreground">Assign milestones to members to see individual progress.</p> : Object.entries(progress.per_user).map(([uid, u]) => (
          <div key={uid}><div className="mb-1 flex justify-between text-xs"><span>{members.find((m) => m.user_id === uid)?.profile?.full_name ?? "Member"}</span><span className="text-muted-foreground">{u.completed_weight}/{u.assigned_weight}%</span></div><Progress value={u.percent} /></div>))}</div>
      </CardBody></Card>
  );
}

/** Overdue tasks, delayed milestones and unowned high-priority work. */
export function RiskPanel({ risks }: { risks: Risk[] }) {
  return (
    <Card><CardHeader><CardTitle>Risk indicators</CardTitle><Badge tone={risks.some((r) => r.severity === "high") ? "danger" : risks.length ? "warning" : "success"}>{risks.length ? `${risks.length} open` : "Clear"}</Badge></CardHeader>
      <CardBody className="space-y-1.5 !pt-3">{!risks.length ? <p className="text-xs text-muted-foreground">No overdue tasks, delayed milestones or unowned high-priority work.</p> : risks.slice(0, 8).map((r, i) => (
        <div key={i} className="flex items-start gap-2 text-xs"><AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${r.severity === "high" ? "text-danger" : r.severity === "medium" ? "text-warning" : "text-muted-foreground"}`} /><span>{r.title}{r.project_name ? ` (${r.project_name})` : ""}</span></div>))}</CardBody></Card>
  );
}

const PIE = ["#a1a1aa", "#3b82f6", "#f59e0b", "#10b981"];
/** Recorded contributions. Not a measure of effort. */
export function ContributionCharts({ pid, taskCounts }: { pid: string; taskCounts: Record<string, number> }) {
  const { data, isLoading } = useQuery({ queryKey: ["contributions", pid], queryFn: async () => (await api.get<{ members: { name: string; tasks_assigned: number; tasks_completed: number; commits: number; milestone_weight_approved: number }[]; github_connected: boolean; note: string }>(`/projects/${pid}/contributions`)).data });
  if (isLoading || !data) return <PageLoader />;
  const pie = Object.entries(taskCounts).map(([k, v]) => ({ name: label(k), value: v })).filter((x) => x.value > 0);
  return (
    <Card><CardHeader><CardTitle>Contribution analytics</CardTitle></CardHeader><CardBody className="space-y-3 !pt-3">
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="h-56"><ResponsiveContainer><BarChart data={data.members} margin={{ left: -20 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="tasks_completed" name="Tasks done" fill="#10b981" radius={[3, 3, 0, 0]} /><Bar dataKey="tasks_assigned" name="Tasks assigned" fill="#a1a1aa" radius={[3, 3, 0, 0]} />{data.github_connected && <Bar dataKey="commits" name="Recent commits" fill="#3b82f6" radius={[3, 3, 0, 0]} />}</BarChart></ResponsiveContainer></div>
        <div className="h-56">{pie.length ? <ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70}>{pie.map((_, i) => <Cell key={i} fill={PIE[i % 4]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer> : <p className="grid h-full place-items-center text-xs text-muted-foreground">No tasks yet</p>}</div>
      </div>
      <p className="text-xs text-muted-foreground">{data.note}</p></CardBody></Card>
  );
}

/** Activity, task, file and milestone logs. */
export function LogsPanel({ pid }: { pid: string }) {
  const [kind, setKind] = useState("activity");
  const { data, isLoading } = useQuery({ queryKey: ["logs", pid, kind], queryFn: async () => (await api.get<(ActivityItem & { from_value?: string; to_value?: string; file_name?: string; note?: string })[]>(`/projects/${pid}/logs/${kind}`)).data });
  const text = (l: NonNullable<typeof data>[number]) => kind === "activity" ? `${l.action}${l.meta && (l.meta as { title?: string }).title ? `: ${(l.meta as { title?: string }).title}` : ""}` : kind === "tasks" ? `${label(l.action as string)}${l.to_value ? ` → ${l.to_value}` : ""}` : kind === "files" ? `${l.action} ${l.file_name}` : `${label(l.action as string)}${l.note ? `: ${l.note}` : ""}`;
  return (
    <div className="space-y-3"><Tabs value={kind} onChange={setKind} tabs={[{ id: "activity", label: "Activity" }, { id: "tasks", label: "Task contributions" }, { id: "files", label: "File contributions" }, { id: "milestones", label: "Milestone log" }]} />
      {isLoading ? <PageLoader /> : !data?.length ? <Empty title="Nothing logged yet" /> : <Card className="divide-y">{data.map((l) => (
        <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="min-w-0 truncate"><span className="font-medium">{l.actor?.full_name ?? "Someone"}</span> <span className="text-muted-foreground">{text(l)}</span></span><span className="shrink-0 text-xs text-muted-foreground" title={fmtDateTime(l.created_at)}>{ago(l.created_at)}</span></div>))}</Card>}
    </div>
  );
}

export function ExportButtons({ pid, name }: { pid: string; name: string }) {
  const [busy, setBusy] = useState("");
  const go = async (f: string) => { setBusy(f); try { await download(`/projects/${pid}/export?format=${f}`, `${name.replace(/\W+/g, "_")}.${f}`); } catch (e) { toastError(e); } finally { setBusy(""); } };
  return <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">Export</span>{["csv", "json", "pdf"].map((f) => <Button key={f} variant="outline" size="sm" loading={busy === f} onClick={() => go(f)}><Download className="h-3.5 w-3.5" />{f.toUpperCase()}</Button>)}</div>;
}
export { statusTone };
