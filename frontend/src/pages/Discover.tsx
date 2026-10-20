import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, Dialog, Empty, Field, Input, PageLoader, Textarea } from "@/components/ui";
import { api, toastError } from "@/services/api";

interface Found { id: string; name: string; description: string; course?: string; required_skills: string[]; owner_name?: string; request_pending: boolean }

/** Public projects a student can ask to join. The owner or supervisor approves or declines. */
export default function Discover() {
  const [q, setQ] = useState(""); const [target, setTarget] = useState<Found | null>(null); const [msg, setMsg] = useState("");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["discover", q], queryFn: async () => (await api.get<Found[]>("/projects/discover", { params: { q } })).data });
  const send = useMutation({
    mutationFn: () => api.post(`/projects/${target!.id}/join-requests`, { message: msg || null }),
    onSuccess: () => { toast.success("Request sent. You will be notified when it is decided."); setTarget(null); setMsg(""); qc.invalidateQueries({ queryKey: ["discover"] }); }, onError: toastError,
  });
  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-semibold tracking-tight">Find a project</h1><p className="text-xs text-muted-foreground">Public projects that are looking for teammates.</p></div>
      <Input placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {isLoading ? <PageLoader /> : !data?.length ? <Empty title="Nothing to show" hint="No public projects match right now." /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((p) => (
            <Card key={p.id}><CardBody className="space-y-2">
              <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">by {p.owner_name ?? "unknown"}{p.course ? ` · ${p.course}` : ""}</p></div>
                <Button size="sm" disabled={p.request_pending} onClick={() => setTarget(p)}>{p.request_pending ? "Requested" : "Request to join"}</Button></div>
              <p className="line-clamp-3 text-xs text-muted-foreground">{p.description}</p>
              <div className="flex flex-wrap gap-1">{p.required_skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>
            </CardBody></Card>
          ))}
        </div>
      )}
      <Dialog open={!!target} onClose={() => setTarget(null)} title={`Join ${target?.name}`} description="Tell the owner why you would be a good fit.">
        <div className="space-y-3"><Field label="Message (optional)"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button><Button loading={send.isPending} onClick={() => send.mutate()}>Send request</Button></div></div>
      </Dialog>
    </div>
  );
}
