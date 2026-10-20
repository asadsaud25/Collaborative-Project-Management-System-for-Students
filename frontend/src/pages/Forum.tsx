import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, Badge, Button, Card, CardBody, Dialog, Empty, Field, Input, PageLoader, Select, Textarea } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, toastError } from "@/services/api";
import type { MiniProfile } from "@/types";
import { ago } from "@/utils/format";

interface Thread { id: string; title: string; body: string; category: string; created_at: string; author: MiniProfile | null; author_id: string; reply_count: number }
interface Full extends Thread { posts: { id: string; body: string; created_at: string; author: MiniProfile | null }[] }
const CATS = ["general", "help", "career", "tools", "showcase"];

/** Community forum: open discussion threads for all signed-in users. */
export default function Forum() {
  const { profile } = useAuth(); const qc = useQueryClient();
  const [cat, setCat] = useState(""); const [q, setQ] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false); const [f, setF] = useState({ title: "", body: "", category: "general" }); const [reply, setReply] = useState("");
  const list = useQuery({ queryKey: ["forum", cat, q], queryFn: async () => (await api.get<Thread[]>("/forum/threads", { params: { category: cat || undefined, q: q || undefined } })).data });
  const one = useQuery({ queryKey: ["thread", open], enabled: !!open, queryFn: async () => (await api.get<Full>(`/forum/threads/${open}`)).data });
  const create = useMutation({ mutationFn: () => api.post("/forum/threads", f), onSuccess: () => { setCreating(false); setF({ title: "", body: "", category: "general" }); qc.invalidateQueries({ queryKey: ["forum"] }); toast.success("Thread posted"); }, onError: toastError });
  const post = useMutation({ mutationFn: () => api.post(`/forum/threads/${open}/posts`, { body: reply }), onSuccess: () => { setReply(""); qc.invalidateQueries({ queryKey: ["thread", open] }); qc.invalidateQueries({ queryKey: ["forum"] }); }, onError: toastError });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/forum/threads/${id}`), onSuccess: () => { setOpen(null); qc.invalidateQueries({ queryKey: ["forum"] }); }, onError: toastError });

  if (open) return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>← All threads</Button>
      {one.isLoading || !one.data ? <PageLoader /> : <>
        <Card><CardBody className="space-y-2">
          <div className="flex items-start justify-between gap-2"><h1 className="text-lg font-semibold tracking-tight">{one.data.title}</h1>
            {(one.data.author_id === profile?.id || profile?.role === "admin") && <Button variant="ghost" size="icon" aria-label="Delete thread" onClick={() => del.mutate(one.data!.id)}><Trash2 className="h-4 w-4" /></Button>}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Avatar name={one.data.author?.full_name} className="h-5 w-5" />{one.data.author?.full_name} · {ago(one.data.created_at)}<Badge>{one.data.category}</Badge></div>
          <p className="whitespace-pre-wrap">{one.data.body}</p>
        </CardBody></Card>
        {one.data.posts.map((p) => <Card key={p.id}><CardBody><div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Avatar name={p.author?.full_name} className="h-5 w-5" />{p.author?.full_name} · {ago(p.created_at)}</div><p className="whitespace-pre-wrap">{p.body}</p></CardBody></Card>)}
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) post.mutate(); }}><Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" /><div className="flex justify-end"><Button type="submit" loading={post.isPending}>Reply</Button></div></form>
      </>}
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-semibold tracking-tight">Community</h1><p className="text-xs text-muted-foreground">Ask questions and share what you have learned.</p></div><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New thread</Button></div>
      <div className="flex gap-2"><Input className="max-w-xs" placeholder="Search threads…" value={q} onChange={(e) => setQ(e.target.value)} /><Select className="w-40" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{CATS.map((c) => <option key={c}>{c}</option>)}</Select></div>
      {list.isLoading ? <PageLoader /> : !list.data?.length ? <Empty title="No threads yet" hint="Start the first discussion." /> : (
        <div className="space-y-2">{list.data.map((t) => (
          <button key={t.id} className="w-full text-left" onClick={() => setOpen(t.id)}><Card className="transition-colors hover:bg-accent/40"><CardBody className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="truncate font-medium">{t.title}</p><p className="text-xs text-muted-foreground">{t.author?.full_name} · {ago(t.created_at)}</p></div>
            <div className="flex shrink-0 items-center gap-2"><Badge>{t.category}</Badge><span className="flex items-center gap-1 text-xs text-muted-foreground"><MessageCircle className="h-3.5 w-3.5" />{t.reply_count}</span></div>
          </CardBody></Card></button>
        ))}</div>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New thread">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Title"><Input required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Details"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Post</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
