import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, Dialog, Empty, Field, Input, PageLoader } from "@/components/ui";
import { useMembers } from "@/hooks/useProject";
import { api, toastError } from "@/services/api";
import type { Meeting } from "@/types";
import { cn } from "@/utils/cn";
import { fmtDateTime } from "@/utils/format";

/** Schedule instant or planned meetings. Participants get the link by email, in-app DM and notification. */
export default function Meetings({ pid, canManage }: { pid: string; canManage: boolean }) {
  const qc = useQueryClient(); const members = useMembers(pid).data ?? []; const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", instant: false, starts_at: "", duration_min: 30, all: true, ids: [] as string[] });
  const { data, isLoading } = useQuery({ queryKey: ["meetings", pid], queryFn: async () => (await api.get<Meeting[]>(`/projects/${pid}/meetings`)).data });
  const create = useMutation({
    mutationFn: async () => (await api.post(`/projects/${pid}/meetings`, { title: f.title, instant: f.instant, starts_at: f.instant || !f.starts_at ? null : new Date(f.starts_at).toISOString(), duration_min: f.duration_min, participant_ids: f.all ? null : f.ids })).data,
    onSuccess: (m) => { toast.success(`Meeting created (${m.link_provider === "google_meet" ? "Google Meet" : "Jitsi"} link). ${m.emails_sent} email(s) sent, DMs delivered.`); setOpen(false); qc.invalidateQueries({ queryKey: ["meetings", pid] }); qc.invalidateQueries({ queryKey: ["calendar", pid] }); if (f.instant && m.meet_link) window.open(m.meet_link, "_blank"); }, onError: toastError,
  });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/meetings/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", pid] }), onError: toastError });
  if (isLoading) return <PageLoader />;
  const now = Date.now(); const upcoming = (data ?? []).filter((m) => new Date(m.starts_at).getTime() + m.duration_min * 60000 >= now); const past = (data ?? []).filter((m) => !upcoming.includes(m)).reverse();
  const row = (m: Meeting) => <Card key={m.id}><CardBody className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="font-medium">{m.title}</p><p className="text-xs text-muted-foreground">{m.is_instant ? "Instant · " : ""}{fmtDateTime(m.starts_at)} · {m.duration_min} min · {m.participant_ids.length} people</p></div>
    <div className="flex items-center gap-1">{m.meet_link && <a href={m.meet_link} target="_blank" rel="noreferrer"><Button size="sm"><Video className="h-3.5 w-3.5" />Join</Button></a>}{canManage && <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => del.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button>}</div></CardBody></Card>;
  return (
    <div className="space-y-4">
      {canManage && <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Schedule meeting</Button></div>}
      {!data?.length ? <Empty title="No meetings yet" hint={canManage ? "Schedule one and everyone gets the link by email and direct message." : "Meetings scheduled by the project lead show up here."} /> : <>
        <div className="space-y-2">{upcoming.map(row)}</div>{!!past.length && <><p className="pt-2 text-xs font-medium text-muted-foreground">Past</p><div className="space-y-2 opacity-70">{past.map(row)}</div></>}</>}
      <Dialog open={open} onClose={() => setOpen(false)} title="Schedule meeting" description="A meeting link is generated automatically.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.instant} onChange={(e) => setF({ ...f, instant: e.target.checked })} />Start now (instant meeting)</label>
          {!f.instant && <div className="grid gap-3 sm:grid-cols-2"><Field label="Starts"><Input type="datetime-local" required value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field><Field label="Duration (min)"><Input type="number" min={5} max={480} value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: Number(e.target.value) })} /></Field></div>}
          <Field label="Participants"><label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} />Everyone on the project</label>
            {!f.all && <div className="flex flex-wrap gap-1.5">{members.map((m) => <button type="button" key={m.user_id} onClick={() => setF({ ...f, ids: f.ids.includes(m.user_id) ? f.ids.filter((x) => x !== m.user_id) : [...f.ids, m.user_id] })} className={cn("rounded-full border px-2.5 py-1 text-xs", f.ids.includes(m.user_id) ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>{m.profile?.full_name}</button>)}</div>}</Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>{f.instant ? "Start meeting" : "Schedule"}</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
