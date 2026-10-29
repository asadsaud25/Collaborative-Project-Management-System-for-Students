import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Send, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ReportUserModal } from "@/components/common/ReportUserModal";
import { Avatar, Button, Card, Empty, Input, PageLoader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, toastError } from "@/services/api";
import type { DM, MiniProfile } from "@/types";
import { ago, fmtDateTime } from "@/utils/format";
import { cn } from "@/utils/cn";

interface Convo { user_id: string; last_message: string; last_at: string; unread: number; profile: MiniProfile | null }

/** Direct messages: conversation list + thread. New messages arrive live over the WebSocket.
 *  You can only start or continue a conversation with people who share a project with you, or with your
 *  project supervisor / students; the server enforces this and this page only offers those people. */
export default function Messages() {
  const { profile } = useAuth(); const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const active = params.get("with");
  const [text, setText] = useState(""); const [q, setQ] = useState(""); const [report, setReport] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const convos = useQuery({ queryKey: ["conversations"], queryFn: async () => (await api.get<Convo[]>("/dm/conversations")).data, refetchInterval: 30000 });
  const thread = useQuery({ queryKey: ["dm", active], enabled: !!active, queryFn: async () => (await api.get<DM[]>(`/dm/${active}`)).data, refetchInterval: 15000 });
  const contacts = useQuery({ queryKey: ["dm-contacts"], staleTime: 60_000, queryFn: async () => (await api.get<MiniProfile[]>("/dm/contacts")).data });
  const term = q.trim().toLowerCase();
  const matches = (contacts.data ?? []).filter((u) => !term || u.full_name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
  const canSend = contacts.isSuccess ? contacts.data.some((u) => u.id === active) : true;
  const send = useMutation({
    mutationFn: () => api.post("/dm", { recipient_id: active, body: text }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["dm", active] }); qc.invalidateQueries({ queryKey: ["conversations"] }); }, onError: toastError,
  });
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [thread.data?.length]);
  useEffect(() => {
    if (!active) return;
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });      // opening a thread clears its DM notifications
  }, [thread.dataUpdatedAt]);                                    // eslint-disable-line react-hooks/exhaustive-deps
  const other = convos.data?.find((c) => c.user_id === active)?.profile ?? contacts.data?.find((u) => u.id === active) ?? null;

  return (
    <div className="grid h-[calc(100vh-8rem)] gap-3 md:grid-cols-[280px_1fr]">
      <Card className="flex flex-col overflow-hidden">
        <div className="border-b p-2"><Input placeholder="Find a teammate or supervisor…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="flex-1 overflow-y-auto scroll-thin">
          {term ? (matches.length === 0 ? <p className="p-4 text-xs text-muted-foreground">No one matches. You can message people who share a project with you, and your project supervisor or students.</p> : matches.map((u) => (
            <button key={u.id} onClick={() => { setParams({ with: u.id }); setQ(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"><Avatar name={u.full_name} /><div className="min-w-0"><p className="truncate text-sm">{u.full_name}</p><p className="truncate text-xs text-muted-foreground">{u.email}</p></div></button>
          ))) : convos.isLoading ? <PageLoader /> : !convos.data?.length ? <p className="p-4 text-xs text-muted-foreground">{contacts.isSuccess && contacts.data.length === 0 ? "You'll be able to message people once you share a project with them." : "No conversations yet. Search for a teammate above."}</p> : convos.data.map((c) => (
            <button key={c.user_id} onClick={() => setParams({ with: c.user_id })} className={cn("flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent", active === c.user_id && "bg-accent")}>
              <Avatar name={c.profile?.full_name} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-sm font-medium">{c.profile?.full_name}</p><span className="shrink-0 text-[10px] text-muted-foreground">{ago(c.last_at)}</span></div>
                <p className="truncate text-xs text-muted-foreground">{c.last_message.split("\n")[0]}</p></div>
              {c.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{c.unread}</span>}
            </button>
          ))}
        </div>
      </Card>
      <Card className="flex flex-col overflow-hidden">
        {!active ? <div className="grid flex-1 place-items-center"><Empty title="Select a conversation" hint="Messages here are private between you and the other person." /></div> : <>
          <div className="flex items-center justify-between border-b px-4 py-2.5"><div className="flex items-center gap-2"><Avatar name={other?.full_name} /><p className="font-medium">{other?.full_name ?? "Conversation"}</p></div>
            <Button variant="ghost" size="sm" onClick={() => setReport(true)}><Flag className="h-3.5 w-3.5" />Report</Button></div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4 scroll-thin">
            {thread.isLoading ? <PageLoader /> : thread.isError ? <p className="text-center text-sm text-muted-foreground">This conversation could not be loaded.</p> : thread.data?.map((m) => {
              const mine = m.sender_id === profile?.id;
              return <div key={m.id} className={cn("flex", mine && "justify-end")}><div className={cn("max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {m.kind === "meeting" && <Video className="mb-1 h-3.5 w-3.5" />}
                {m.body.split(/(https?:\/\/\S+)/g).map((part, i) => /^https?:/.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline">{part}</a> : part)}
                <p className="mt-1 text-[10px] opacity-60">{fmtDateTime(m.created_at)}</p></div></div>;
            })}
            <div ref={end} />
          </div>
          {canSend ? (
            <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" maxLength={4000} />
              <Button type="submit" loading={send.isPending} aria-label="Send"><Send className="h-4 w-4" /></Button>
            </form>
          ) : <p className="border-t p-3 text-center text-xs text-muted-foreground">You no longer share an active project with this person, so new messages can't be sent.</p>}
        </>}
      </Card>
      {report && active && <ReportUserModal userId={active} userName={other?.full_name ?? "this user"} onClose={() => setReport(false)} />}
    </div>
  );
}
