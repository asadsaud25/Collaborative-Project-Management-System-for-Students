import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, ErrorState, Input, PageLoader, Select, Stat, Tabs, statusTone } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, errMsg, toastError } from "@/services/api";
import type { MiniProfile } from "@/types";
import { ago, fmtDate, label } from "@/utils/format";

interface U { id: string; full_name: string; email: string; role: string; university?: string; is_suspended: boolean }
interface C { id: string; reason: string; details?: string; status: string; created_at: string; reporter: MiniProfile | null; reported: MiniProfile | null; resolution_note?: string }

/** Admin: platform stats, user/role management, complaints queue, universities and system health. */
export default function AdminDashboard() {
  const qc = useQueryClient(); const me = useAuth((s) => s.profile); const [tab, setTab] = useState("users"); const [q, setQ] = useState(""); const [uni, setUni] = useState("");
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: async () => (await api.get<Record<string, number>>("/admin/stats")).data });
  const users = useQuery({ queryKey: ["admin-users", q], queryFn: async () => (await api.get<U[]>("/admin/users", { params: { q } })).data });
  const complaints = useQuery({ queryKey: ["admin-complaints"], queryFn: async () => (await api.get<C[]>("/admin/complaints")).data });
  const unis = useQuery({ queryKey: ["admin-unis"], queryFn: async () => (await api.get<{ id: string; name: string }[]>("/admin/universities")).data });
  const projects = useQuery({ queryKey: ["admin-projects"], enabled: tab === "projects", queryFn: async () => (await api.get<{ id: string; name: string; status: string; due_date?: string; created_at: string }[]>("/admin/projects")).data });
  const sys = useQuery({ queryKey: ["admin-system"], enabled: tab === "system", queryFn: async () => (await api.get<{ checks: Record<string, string>; recent_logs: { id: string; level: string; message: string; created_at: string }[] }>("/admin/system")).data });
  const refresh = () => ["admin-stats", "admin-users", "admin-complaints", "admin-unis"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const role = useMutation({ mutationFn: ({ id, r }: { id: string; r: string }) => api.patch(`/admin/users/${id}/role`, { role: r }), onSuccess: () => { toast.success("Role updated"); refresh(); }, onError: toastError });
  const suspend = useMutation({ mutationFn: ({ id, s }: { id: string; s: boolean }) => api.patch(`/admin/users/${id}/suspend`, { suspended: s }), onSuccess: refresh, onError: toastError });
  const resolve = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/admin/complaints/${id}`, { status, note: prompt("Resolution note (optional)") || null }), onSuccess: refresh, onError: toastError });
  const addUni = useMutation({ mutationFn: () => api.post("/admin/universities", { name: uni }), onSuccess: () => { setUni(""); refresh(); }, onError: toastError });
  const delUni = useMutation({ mutationFn: (id: string) => api.delete(`/admin/universities/${id}`), onSuccess: refresh, onError: toastError });
  const deadlines = useMutation({ mutationFn: async () => (await api.post("/notifications/run-deadline-check")).data, onSuccess: (d) => toast.success(`Deadline alerts sent for ${d.tasks_notified} task(s)`), onError: toastError });
  if (stats.error) return <ErrorState message={errMsg(stats.error)} />;
  const open = complaints.data?.filter((c) => c.status === "open" || c.status === "reviewing").length ?? 0;
  return (
    <div className="space-y-5" data-tour="dashboard">
      <div><h1 className="text-xl font-semibold tracking-tight">Administration</h1><p className="text-xs text-muted-foreground">Users, roles, reports and platform health.</p></div>
      {stats.data && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Users" value={stats.data.users} hint={`${stats.data.students} students · ${stats.data.supervisors} supervisors`} /><Stat label="Projects" value={stats.data.projects} hint={`${stats.data.active_projects} active`} /><Stat label="Tasks" value={stats.data.tasks} /><Stat label="Open reports" value={stats.data.open_complaints} /></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "users", label: "Users" }, { id: "reports", label: "Reports", badge: open }, { id: "projects", label: "Projects" }, { id: "universities", label: "Universities" }, { id: "system", label: "System health" }]} />
      {tab === "users" && <div className="space-y-3"><Input className="max-w-sm" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        {users.isLoading ? <PageLoader /> : <Card className="divide-y">{users.data?.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"><div className="min-w-0"><p className="text-sm font-medium">{u.full_name} {u.is_suspended && <Badge tone="danger">Suspended</Badge>}</p><p className="text-xs text-muted-foreground">{u.email}{u.university ? ` · ${u.university}` : ""}</p></div>
            <div className="flex items-center gap-2"><Select className="h-8 w-32 text-xs" value={u.role} disabled={u.id === me?.id} onChange={(e) => role.mutate({ id: u.id, r: e.target.value })}>{["student", "supervisor", "admin"].map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select>
              <Button variant="outline" size="sm" disabled={u.id === me?.id} onClick={() => suspend.mutate({ id: u.id, s: !u.is_suspended })}>{u.is_suspended ? "Reinstate" : "Suspend"}</Button></div></div>))}</Card>}</div>}
      {tab === "reports" && (!complaints.data?.length ? <Empty title="No reports" hint="User reports filed from messages or project teams appear here." /> : <div className="space-y-2">{complaints.data.map((c) => (
        <Card key={c.id}><CardBody className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm"><span className="font-medium">{c.reporter?.full_name}</span> reported <span className="font-medium">{c.reported?.full_name}</span> <span className="text-muted-foreground">· {ago(c.created_at)}</span></p><Badge tone={statusTone(c.status === "dismissed" ? "neutral" : c.status)}>{label(c.status)}</Badge></div>
          <p className="text-sm"><Badge>{label(c.reason)}</Badge> {c.details}</p>{c.resolution_note && <p className="text-xs text-muted-foreground">Note: {c.resolution_note}</p>}
          {(c.status === "open" || c.status === "reviewing") && <div className="flex gap-2">{c.status === "open" && <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: c.id, status: "reviewing" })}>Start review</Button>}<Button size="sm" onClick={() => resolve.mutate({ id: c.id, status: "resolved" })}>Resolve</Button><Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: c.id, status: "dismissed" })}>Dismiss</Button></div>}</CardBody></Card>))}</div>)}
      {tab === "projects" && (projects.isLoading ? <PageLoader /> : <Card className="divide-y">{projects.data?.map((p) => <a key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-accent/50"><span>{p.name}</span><span className="flex items-center gap-2 text-xs text-muted-foreground"><Badge tone={statusTone(p.status)}>{label(p.status)}</Badge>{p.due_date ? `Due ${fmtDate(p.due_date)}` : ""}</span></a>)}</Card>)}
      {tab === "universities" && <div className="max-w-xl space-y-3"><form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (uni.trim()) addUni.mutate(); }}><Input placeholder="University or unit name" value={uni} onChange={(e) => setUni(e.target.value)} /><Button type="submit" loading={addUni.isPending}><Plus className="h-4 w-4" />Add</Button></form>
        <Card className="divide-y">{!unis.data?.length ? <p className="p-4 text-xs text-muted-foreground">None yet.</p> : unis.data.map((u) => <div key={u.id} className="flex items-center justify-between px-4 py-2.5 text-sm"><span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{u.name}</span><Button variant="ghost" size="icon" aria-label="Delete" onClick={() => confirm(`Delete ${u.name}?`) && delUni.mutate(u.id)}><Trash2 className="h-4 w-4" /></Button></div>)}</Card></div>}
      {tab === "system" && (sys.isLoading || !sys.data ? <PageLoader /> : <div className="space-y-4"><Card><CardHeader><CardTitle>Health checks</CardTitle><Button size="sm" variant="outline" loading={deadlines.isPending} onClick={() => deadlines.mutate()}>Run deadline alerts</Button></CardHeader><CardBody className="grid gap-2 !pt-3 sm:grid-cols-2">{Object.entries(sys.data.checks).map(([k, v]) => <div key={k} className="flex justify-between rounded-md bg-muted px-3 py-2 text-sm"><span>{label(k)}</span><Badge tone={/ok|configured|resend|sendgrid/.test(v) ? "success" : /MISSING|error|unreachable/.test(v) ? "danger" : "warning"}>{v}</Badge></div>)}</CardBody></Card>
        <Card><CardHeader><CardTitle>Recent server errors</CardTitle></CardHeader><CardBody className="divide-y !py-1">{!sys.data.recent_logs.length ? <p className="py-3 text-xs text-muted-foreground">No errors logged.</p> : sys.data.recent_logs.map((l) => <div key={l.id} className="flex justify-between gap-3 py-2 text-xs"><span className="truncate font-mono">{l.message}</span><span className="shrink-0 text-muted-foreground">{ago(l.created_at)}</span></div>)}</CardBody></Card></div>)}
    </div>
  );
}
