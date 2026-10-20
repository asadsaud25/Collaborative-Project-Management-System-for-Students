import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Flag, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ReportUserModal } from "@/components/common/ReportUserModal";
import { Avatar, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, PageLoader, Select } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useMembers } from "@/hooks/useProject";
import { api, toastError } from "@/services/api";
import type { MiniProfile } from "@/types";
import { label } from "@/utils/format";

interface InviteResult { email: string; status: string; link?: string; email_sent?: boolean }

/** Members, email invitations, join-request approvals and evidence-based teammate suggestions. */
export default function Team({ pid, canManage }: { pid: string; canManage: boolean }) {
  const qc = useQueryClient(); const { profile } = useAuth(); const members = useMembers(pid);
  const [rows, setRows] = useState([{ email: "", name: "" }]); const [results, setResults] = useState<InviteResult[]>([]); const [report, setReport] = useState<MiniProfile | null>(null);
  const refresh = () => ["members", "invites", "join-requests", "matching"].forEach((k) => qc.invalidateQueries({ queryKey: [k, pid] }));
  const invites = useQuery({ queryKey: ["invites", pid], enabled: canManage, queryFn: async () => (await api.get<{ id: string; email: string; link: string }[]>(`/projects/${pid}/invites`)).data });
  const reqs = useQuery({ queryKey: ["join-requests", pid], enabled: canManage, queryFn: async () => (await api.get<{ id: string; message?: string; profile: MiniProfile & { skills: string[] } }[]>(`/projects/${pid}/join-requests`)).data });
  const match = useQuery({ queryKey: ["matching", pid], enabled: canManage, queryFn: async () => (await api.get<{ profile: MiniProfile & { skills: string[] }; score: number; evidence: string[] }[]>(`/projects/${pid}/matching`)).data });
  const invite = useMutation({
    mutationFn: async () => (await api.post<InviteResult[]>(`/projects/${pid}/invites`, { invites: rows.filter((r) => r.email.trim()).map((r) => ({ email: r.email.trim(), name: r.name.trim() || null })) })).data,
    onSuccess: (r) => { setResults(r); setRows([{ email: "", name: "" }]); refresh(); const sent = r.filter((x) => x.email_sent).length; toast.success(sent ? `${sent} invitation email(s) sent` : "Invites created. Email is not configured, so copy the links below."); }, onError: toastError,
  });
  const decide = useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api.post(`/join-requests/${id}/decide`, { approve }), onSuccess: () => { refresh(); toast.success("Done"); }, onError: toastError });
  const setRole = useMutation({ mutationFn: ({ uid, role }: { uid: string; role: string }) => api.patch(`/projects/${pid}/members/${uid}`, { role }), onSuccess: refresh, onError: toastError });
  const remove = useMutation({ mutationFn: (uid: string) => api.delete(`/projects/${pid}/members/${uid}`), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["tasks", pid] }); }, onError: toastError });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/projects/${pid}/invites/${id}`), onSuccess: refresh });
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Link copied"));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>Members</CardTitle></CardHeader><CardBody className="divide-y !pt-2">
          {members.isLoading ? <PageLoader /> : members.data?.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 py-2">
              <div className="flex min-w-0 items-center gap-2"><Avatar name={m.profile?.full_name} /><div className="min-w-0"><p className="truncate text-sm">{m.profile?.full_name}</p><p className="truncate text-xs text-muted-foreground">{m.profile?.email}{m.profile?.github_username ? ` · @${m.profile.github_username}` : ""}</p></div></div>
              <div className="flex items-center gap-1">
                {canManage && m.role !== "supervisor" && m.user_id !== profile?.id ? <Select className="h-8 w-28 text-xs" value={m.role} onChange={(e) => setRole.mutate({ uid: m.user_id, role: e.target.value })}>{["owner", "member", "reviewer"].map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select> : <Badge>{label(m.role)}</Badge>}
                {m.user_id !== profile?.id && <Button variant="ghost" size="icon" aria-label="Report user" onClick={() => m.profile && setReport(m.profile)}><Flag className="h-3.5 w-3.5" /></Button>}
                {m.role !== "supervisor" && (canManage || m.user_id === profile?.id) && m.role !== "owner" && <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => confirm(m.user_id === profile?.id ? "Leave this project?" : "Remove this member?") && remove.mutate(m.user_id)}><X className="h-4 w-4" /></Button>}
              </div></div>))}
        </CardBody></Card>
        {canManage && <Card><CardHeader><CardTitle>Suggested teammates</CardTitle></CardHeader><CardBody className="space-y-2 !pt-2">
          {!match.data?.length ? <p className="text-xs text-muted-foreground">Add required skills to the project and ask students to fill in their profiles to see suggestions here.</p> : match.data.map((s) => (
            <div key={s.profile.id} className="flex items-start justify-between gap-2 rounded-md border p-2.5"><div className="min-w-0"><p className="text-sm font-medium">{s.profile.full_name}</p><div className="mt-1 flex flex-wrap gap-1">{s.evidence.map((e) => <Badge key={e} tone="info">{e}</Badge>)}</div></div>
              <Button size="sm" variant="outline" onClick={() => setRows([...rows.filter((r) => r.email), { email: s.profile.email, name: s.profile.full_name }])}>Add to invite</Button></div>))}
        </CardBody></Card>}
      </div>
      {canManage && <div className="space-y-4">
        <Card><CardHeader><CardTitle>Invite by email</CardTitle></CardHeader><CardBody className="space-y-2 !pt-2">
          {rows.map((r, i) => <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2"><Input type="email" placeholder="email@uni.edu" value={r.email} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} /><Input placeholder="Name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <Button variant="ghost" size="icon" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button></div>)}
          <div className="flex justify-between"><Button variant="ghost" size="sm" onClick={() => setRows([...rows, { email: "", name: "" }])}><Plus className="h-4 w-4" />Another</Button><Button size="sm" loading={invite.isPending} disabled={!rows.some((r) => r.email.trim())} onClick={() => invite.mutate()}>Send invites</Button></div>
          {results.map((r) => <div key={r.email} className="flex items-center justify-between gap-2 rounded-md bg-muted p-2 text-xs"><span className="truncate">{r.email}: {r.status === "already_member" ? "already a member" : r.email_sent ? "email sent" : "link ready"}</span>{r.link && <Button variant="ghost" size="sm" onClick={() => copy(r.link!)}><Copy className="h-3.5 w-3.5" />Copy</Button>}</div>)}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Join requests</CardTitle></CardHeader><CardBody className="space-y-2 !pt-2">
          {!reqs.data?.length ? <p className="text-xs text-muted-foreground">No pending requests.</p> : reqs.data.map((r) => (
            <div key={r.id} className="space-y-2 rounded-md border p-2.5"><div><p className="text-sm font-medium">{r.profile.full_name}</p><p className="text-xs text-muted-foreground">{r.profile.course ?? ""} {r.profile.skills?.length ? `· ${r.profile.skills.join(", ")}` : ""}</p>{r.message && <p className="mt-1 text-xs">“{r.message}”</p>}</div>
              <div className="flex gap-2"><Button size="sm" onClick={() => decide.mutate({ id: r.id, approve: true })}><Check className="h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, approve: false })}>Decline</Button></div></div>))}
        </CardBody></Card>
        {!!invites.data?.length && <Card><CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader><CardBody className="space-y-1 !pt-2">{invites.data.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{i.email}</span><span className="flex"><Button variant="ghost" size="icon" aria-label="Copy link" onClick={() => copy(i.link)}><Copy className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" aria-label="Revoke" onClick={() => revoke.mutate(i.id)}><X className="h-3.5 w-3.5" /></Button></span></div>))}</CardBody></Card>}
      </div>}
      {report && <ReportUserModal userId={report.id} userName={report.full_name} projectId={pid} onClose={() => setReport(null)} />}
    </div>
  );
}
