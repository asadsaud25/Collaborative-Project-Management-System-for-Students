import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitCommit, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, Dialog, Empty, Field, Input, PageLoader, Progress, Select, Textarea, statusTone } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useMembers, useMilestones } from "@/hooks/useProject";
import { api, toastError } from "@/services/api";
import type { Commit, Milestone } from "@/types";
import { fmtDate, fmtDateTime, label } from "@/utils/format";
import { cn } from "@/utils/cn";

interface Evidence { connected: boolean; attached: Commit[]; assignee_commits: Commit[] }

function CommitRow({ c, mark }: { c: Commit; mark?: React.ReactNode }) {
  return <div className="flex items-center gap-2 py-1.5 text-xs">{mark}<GitCommit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><code className="rounded bg-muted px-1">{c.short_sha}</code><span className="min-w-0 flex-1 truncate">{c.message}</span><span className="text-muted-foreground">{c.author}{c.date ? ` · ${fmtDateTime(c.date)}` : ""}</span>{c.url && <a href={c.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /></a>}</div>;
}

/** Reviewer view: commit hashes attached by the student plus the assignee's commits in the milestone window. */
function ReviewDialog({ m, pid, onClose }: { m: Milestone; pid: string; onClose: () => void }) {
  const qc = useQueryClient(); const [note, setNote] = useState("");
  const ev = useQuery({ queryKey: ["evidence", m.id], queryFn: async () => (await api.get<Evidence>(`/milestones/${m.id}/evidence`)).data });
  const review = useMutation({
    mutationFn: (approve: boolean) => api.post(`/milestones/${m.id}/review`, { approve, note: note || null }),
    onSuccess: (_d, approve) => { toast.success(approve ? "Approved. Progress updated." : "Sent back with your note."); ["milestones", "overview", "dashboard-supervisor", "calendar"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
    onError: toastError,
  });
  return (
    <Dialog open onClose={onClose} wide title={`Review: ${m.title}`} description={`${m.weight}% of project weight · submitted ${fmtDateTime(m.submitted_at)}`}>
      <div className="space-y-4">
        <div><p className="mb-1 text-xs font-medium text-muted-foreground">Student note</p><p className="rounded-md bg-muted p-3 text-sm">{m.submission_note || "No note provided."}</p></div>
        {m.completion_criteria && <div><p className="mb-1 text-xs font-medium text-muted-foreground">Completion criteria</p><p className="text-sm">{m.completion_criteria}</p></div>}
        <div><p className="mb-1 text-xs font-medium text-muted-foreground">GitHub evidence</p>
          {ev.isLoading ? <PageLoader /> : !ev.data?.connected ? <p className="text-xs text-muted-foreground">No repository is connected to this project.</p> : <>
            <p className="text-xs font-medium">Attached by the student ({ev.data.attached.length})</p>
            <div className="divide-y">{ev.data.attached.length ? ev.data.attached.map((c) => <CommitRow key={c.sha} c={c} />) : <p className="py-1.5 text-xs text-muted-foreground">No commits attached.</p>}</div>
            <p className="mt-2 text-xs font-medium">Assignee's commits in this window ({ev.data.assignee_commits.length})</p>
            <div className="divide-y">{ev.data.assignee_commits.length ? ev.data.assignee_commits.map((c) => <CommitRow key={c.sha} c={c} />) : <p className="py-1.5 text-xs text-muted-foreground">None found. The assignee may not have set a GitHub username.</p>}</div></>}
        </div>
        <Field label="Review note (required when requesting changes)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" loading={review.isPending} onClick={() => review.mutate(false)}>Request changes</Button><Button loading={review.isPending} onClick={() => review.mutate(true)}>Approve</Button></div>
      </div>
    </Dialog>
  );
}

function SubmitDialog({ m, pid, onClose }: { m: Milestone; pid: string; onClose: () => void }) {
  const qc = useQueryClient(); const [note, setNote] = useState(""); const [shas, setShas] = useState<string[]>([]);
  const gh = useQuery({ queryKey: ["github", pid], queryFn: async () => (await api.get(`/projects/${pid}/github/activity`)).data as { connected: boolean; commits?: Commit[] }, retry: false });
  const submit = useMutation({
    mutationFn: () => api.post(`/milestones/${m.id}/submit`, { note: note || null, commit_shas: shas }),
    onSuccess: () => { toast.success("Submitted for review"); qc.invalidateQueries({ queryKey: ["milestones", pid] }); onClose(); }, onError: toastError,
  });
  return (
    <Dialog open onClose={onClose} wide title={`Mark complete: ${m.title}`} description="Your lead or supervisor will review it. Progress changes only after approval.">
      <div className="space-y-3">
        <Field label="What did you deliver?"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Summary, links, anything the reviewer should check" /></Field>
        {gh.data?.connected && <Field label="Attach commits as evidence"><div className="max-h-44 divide-y overflow-y-auto rounded-md border px-2 scroll-thin">
          {gh.data.commits?.map((c) => <CommitRow key={c.sha} c={c} mark={<input type="checkbox" checked={shas.includes(c.sha)} onChange={() => setShas((s) => s.includes(c.sha) ? s.filter((x) => x !== c.sha) : [...s, c.sha])} />} />)}</div></Field>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={submit.isPending} onClick={() => submit.mutate()}>Submit for review</Button></div>
      </div>
    </Dialog>
  );
}

function EditDialog({ pid, m, remaining, onClose }: { pid: string; m: Milestone | null; remaining: number; onClose: () => void }) {
  const qc = useQueryClient(); const members = useMembers(pid).data ?? [];
  const [f, setF] = useState({ title: m?.title ?? "", description: m?.description ?? "", completion_criteria: m?.completion_criteria ?? "", weight: m?.weight ?? (Math.min(remaining, 10) || 1),
    start_date: m?.start_date ?? "", end_date: m?.end_date ?? "", assignee_id: m?.assignee_id ?? "", reviewer_id: m?.reviewer_id ?? "" });
  const save = useMutation({
    mutationFn: () => { const b = { ...f, weight: Number(f.weight), start_date: f.start_date || null, end_date: f.end_date || null, assignee_id: f.assignee_id || null, reviewer_id: f.reviewer_id || null };
      return m ? api.patch(`/milestones/${m.id}`, b) : api.post(`/projects/${pid}/milestones`, b); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["milestones", pid] }); qc.invalidateQueries({ queryKey: ["overview", pid] }); onClose(); }, onError: toastError,
  });
  const del = useMutation({ mutationFn: () => api.delete(`/milestones/${m!.id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["milestones", pid] }); onClose(); }, onError: toastError });
  const people = members.filter((x) => x.role !== "supervisor");
  return (
    <Dialog open onClose={onClose} wide title={m ? "Edit milestone" : "New milestone"} description={`${m ? remaining + m.weight : remaining}% of weight is still unallocated.`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]"><Field label="Title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Weight %"><Input type="number" min={1} max={100} required value={f.weight} onChange={(e) => setF({ ...f, weight: Number(e.target.value) })} disabled={m?.status === "approved"} /></Field></div>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Completion criteria"><Textarea value={f.completion_criteria} onChange={(e) => setF({ ...f, completion_criteria: e.target.value })} placeholder="What must be true for this to count as done?" /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Start"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field><Field label="Target date"><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          <Field label="Assignee"><Select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}><option value="">Unassigned</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.profile?.full_name}</option>)}</Select></Field>
          <Field label="Designated reviewer"><Select value={f.reviewer_id} onChange={(e) => setF({ ...f, reviewer_id: e.target.value })}><option value="">Owner / supervisor</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.profile?.full_name}</option>)}</Select></Field></div>
        <div className="flex items-center justify-between">{m ? <Button type="button" variant="ghost" className="text-danger" onClick={() => confirm("Delete this milestone?") && del.mutate()}>Delete</Button> : <span />}
          <div className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div></div>
      </form>
    </Dialog>
  );
}

/** Weighted milestones with the submission → review → approval flow. */
export default function Milestones({ pid, canManage, canReview }: { pid: string; canManage: boolean; canReview: boolean }) {
  const { profile } = useAuth(); const { data, isLoading } = useMilestones(pid); const members = useMembers(pid).data ?? [];
  const [edit, setEdit] = useState<Milestone | null | "new">(); const [review, setReview] = useState<Milestone>(); const [submit, setSubmit] = useState<Milestone>();
  if (isLoading || !data) return <PageLoader />;
  const { milestones, progress } = data; const name = (id?: string | null) => members.find((m) => m.user_id === id)?.profile?.full_name;
  return (
    <div className="space-y-4">
      <Card><CardBody className="space-y-4">
        <div><div className="mb-1 flex justify-between text-sm"><span className="font-medium">Overall project progress</span><span>{progress.overall_percent}%</span></div><Progress value={progress.overall_percent} tone="bg-success" />
          <p className="mt-1 text-xs text-muted-foreground">{progress.planned_weight}% of weight is planned{progress.unallocated_weight > 0 ? `, ${progress.unallocated_weight}% unallocated` : ""}. Only approved milestones count.</p></div>
        {Object.keys(progress.per_user).length > 0 && <div className="grid gap-3 sm:grid-cols-2">{Object.entries(progress.per_user).map(([uid, p]) => (
          <div key={uid}><div className="mb-1 flex justify-between text-xs"><span>{name(uid) ?? "Member"}{uid === profile?.id && " (you)"}</span><span className="text-muted-foreground">{p.completed_weight}/{p.assigned_weight}% weight</span></div><Progress value={p.percent} /></div>))}</div>}
      </CardBody></Card>
      <div className="flex items-center justify-between"><h2 className="font-medium">Milestones</h2>{canManage && <Button size="sm" onClick={() => setEdit("new")} disabled={progress.unallocated_weight <= 0}><Plus className="h-4 w-4" />New milestone</Button>}</div>
      {!milestones.length ? <Empty title="No milestones yet" hint="Split the project into phases and give each milestone a weight. Weights can total at most 100%." /> : (
        <div className="space-y-2">{milestones.map((m) => {
          const mine = m.assignee_id === profile?.id;
          return <Card key={m.id}><CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1"><div className="flex items-center gap-2"><p className="font-medium">{m.title}</p><Badge tone={statusTone(m.status)}>{label(m.status)}</Badge><Badge>{m.weight}%</Badge></div>
              <p className="text-xs text-muted-foreground">{name(m.assignee_id) ?? "Unassigned"} · {fmtDate(m.start_date)} → {fmtDate(m.end_date)}</p>
              {m.status === "changes_requested" && m.review_note && <p className="text-xs text-danger">Reviewer: {m.review_note}</p>}
              {m.status === "approved" && m.review_note && <p className="text-xs text-muted-foreground">Reviewer: {m.review_note}</p>}</div>
            <div className="flex gap-2">
              {canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(m)}>Edit</Button>}
              {(mine || canManage) && ["planned", "in_progress", "changes_requested"].includes(m.status) && <Button size="sm" variant="outline" onClick={() => setSubmit(m)}>Mark complete</Button>}
              {canReview && m.status === "in_review" && <Button size="sm" onClick={() => setReview(m)}>Review</Button>}
            </div></CardBody></Card>; })}</div>)}
      {edit && <EditDialog pid={pid} m={edit === "new" ? null : edit} remaining={progress.unallocated_weight} onClose={() => setEdit(undefined)} />}
      {review && <ReviewDialog m={review} pid={pid} onClose={() => setReview(undefined)} />}
      {submit && <SubmitDialog m={submit} pid={pid} onClose={() => setSubmit(undefined)} />}
    </div>
  );
}
