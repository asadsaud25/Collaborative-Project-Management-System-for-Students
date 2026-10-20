import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Lightbulb, MessageSquare, Plus, Rocket, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button, Card, CardBody, Dialog, Empty, Field, Input, PageLoader, Select, Textarea, statusTone } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, toastError } from "@/services/api";
import type { MiniProfile } from "@/types";
import { cn } from "@/utils/cn";
import { ago, label } from "@/utils/format";

interface Idea { id: string; title: string; body: string; status: string; author_id: string; author: MiniProfile | null; reactions: Record<string, number>; my_reactions: string[]; comment_count: number; created_at: string }
const REACTIONS = [{ id: "up", Icon: ThumbsUp }, { id: "heart", Icon: Heart }, { id: "rocket", Icon: Rocket }, { id: "think", Icon: Lightbulb }];

function Comments({ id }: { id: string }) {
  const qc = useQueryClient(); const [t, setT] = useState("");
  const { data } = useQuery({ queryKey: ["comments", id], queryFn: async () => (await api.get<{ id: string; body: string; created_at: string; author: MiniProfile | null }[]>(`/ideas/${id}/comments`)).data });
  const add = useMutation({ mutationFn: () => api.post(`/ideas/${id}/comments`, { body: t }), onSuccess: () => { setT(""); qc.invalidateQueries({ queryKey: ["comments", id] }); qc.invalidateQueries({ queryKey: ["ideas"] }); }, onError: toastError });
  return <div className="space-y-2 border-t pt-2">
    {data?.map((c) => <div key={c.id} className="flex gap-2 text-xs"><Avatar name={c.author?.full_name} className="h-5 w-5" /><div><span className="font-medium">{c.author?.full_name}</span> <span className="text-muted-foreground">{ago(c.created_at)}</span><p>{c.body}</p></div></div>)}
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (t.trim()) add.mutate(); }}><Input className="h-8" placeholder="Add a comment…" value={t} onChange={(e) => setT(e.target.value)} /><Button size="sm" type="submit" loading={add.isPending}>Post</Button></form></div>;
}

/** Shared idea board: post ideas, react, comment, and mark them planned/done. */
export default function IdeaBoard({ pid, canManage }: { pid: string; canManage: boolean }) {
  const qc = useQueryClient(); const { profile } = useAuth(); const [creating, setCreating] = useState(false); const [f, setF] = useState({ title: "", body: "" }); const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["ideas", pid], queryFn: async () => (await api.get<Idea[]>(`/projects/${pid}/ideas`)).data });
  const inv = () => qc.invalidateQueries({ queryKey: ["ideas", pid] });
  const create = useMutation({ mutationFn: () => api.post(`/projects/${pid}/ideas`, f), onSuccess: () => { setCreating(false); setF({ title: "", body: "" }); inv(); }, onError: toastError });
  const vote = useMutation({ mutationFn: ({ id, reaction }: { id: string; reaction: string }) => api.post(`/ideas/${id}/vote`, { reaction }), onSuccess: inv, onError: toastError });
  const status = useMutation({ mutationFn: ({ id, s }: { id: string; s: string }) => api.patch(`/ideas/${id}`, { status: s }), onSuccess: inv, onError: toastError });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/ideas/${id}`), onSuccess: inv, onError: toastError });
  if (isLoading) return <PageLoader />;
  return (
    <div className="space-y-3">
      <div className="flex justify-between"><p className="text-xs text-muted-foreground">Ideas are ranked by reactions.</p><Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New idea</Button></div>
      {!data?.length ? <Empty title="No ideas yet" hint="Drop the first one. Anyone on the project can react and comment." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...data].sort((a, b) => Object.values(b.reactions).reduce((x, y) => x + y, 0) - Object.values(a.reactions).reduce((x, y) => x + y, 0)).map((i) => (
          <Card key={i.id}><CardBody className="space-y-2.5">
            <div className="flex items-start justify-between gap-2"><p className="font-medium leading-snug">{i.title}</p><Badge tone={statusTone(i.status === "planned" ? "in_progress" : i.status)}>{label(i.status)}</Badge></div>
            {i.body && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{i.body}</p>}
            <p className="text-[11px] text-muted-foreground">{i.author?.full_name} · {ago(i.created_at)}</p>
            <div className="flex flex-wrap items-center gap-1">{REACTIONS.map(({ id, Icon }) => <button key={id} onClick={() => vote.mutate({ id: i.id, reaction: id })} className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", i.my_reactions.includes(id) ? "bg-primary text-primary-foreground" : "hover:bg-accent")}><Icon className="h-3 w-3" />{i.reactions[id] ?? 0}</button>)}
              <button onClick={() => setOpen(open === i.id ? null : i.id)} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><MessageSquare className="h-3.5 w-3.5" />{i.comment_count}</button></div>
            {(canManage || i.author_id === profile?.id) && <div className="flex items-center justify-between"><Select className="h-7 w-28 text-xs" value={i.status} onChange={(e) => status.mutate({ id: i.id, s: e.target.value })}>{["open", "planned", "done", "dropped"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
              <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => confirm("Delete this idea?") && del.mutate(i.id)}><Trash2 className="h-3.5 w-3.5" /></Button></div>}
            {open === i.id && <Comments id={i.id} />}
          </CardBody></Card>))}</div>)}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New idea">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}><Field label="Title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label="Details"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Post idea</Button></div></form>
      </Dialog>
    </div>
  );
}
