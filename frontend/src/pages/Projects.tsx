import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, Dialog, Empty, ErrorState, Field, Input, PageLoader, Progress, Textarea, statusTone } from "@/components/ui";
import { api, errMsg, toastError } from "@/services/api";
import type { Project } from "@/types";
import { csvToList, fmtDate, label } from "@/utils/format";

function CreateProject({ onClose }: { onClose: () => void }) {
  const nav = useNavigate(); const qc = useQueryClient();
  const [f, setF] = useState({ name: "", description: "", course: "", skills: "", due_date: "", supervisor_email: "", visibility: "public" });
  const create = useMutation({
    mutationFn: async () => (await api.post<Project>("/projects", { name: f.name, description: f.description, course: f.course || null, required_skills: csvToList(f.skills),
      due_date: f.due_date || null, supervisor_email: f.supervisor_email || null, visibility: f.visibility })).data,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Project created. Invite your team next."); nav(`/projects/${p.id}?tab=team`); }, onError: toastError,
  });
  return (
    <Dialog open onClose={onClose} title="New project" description="You become the project owner and can invite teammates right after.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Name"><Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Course"><Input value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        <Field label="Skills you are looking for" hint="Comma separated. Drives team suggestions."><Input value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} /></Field>
        <Field label="Supervisor email (optional)" hint="Must belong to a registered supervisor."><Input type="email" value={f.supervisor_email} onChange={(e) => setF({ ...f, supervisor_email: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.visibility === "public"} onChange={(e) => setF({ ...f, visibility: e.target.checked ? "public" : "private" })} />Let students find this project and request to join</label>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending}>Create project</Button></div>
      </form>
    </Dialog>
  );
}

export default function Projects() {
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const nav = useNavigate(); const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["projects"], meta: { inline: true }, queryFn: async () => (await api.get<Project[]>("/projects")).data });
  const importer = useMutation({
    mutationFn: async (f: File) => (await api.post<Project>("/projects/import", JSON.parse(await f.text()))).data,
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Project imported"); nav(`/projects/${p.id}`); },
    onError: (e) => toast.error(e instanceof SyntaxError ? "That file is not valid JSON" : errMsg(e)),
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-semibold tracking-tight">Projects</h1><p className="text-xs text-muted-foreground">Everything you own, join or supervise.</p></div>
        <div className="flex gap-2">
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importer.mutate(f); e.target.value = ""; }} />
          <Button variant="outline" onClick={() => file.current?.click()} loading={importer.isPending}><Upload className="h-4 w-4" />Import JSON</Button>
          <Link to="/discover"><Button variant="outline"><Compass className="h-4 w-4" />Find projects</Button></Link>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New project</Button>
        </div>
      </div>
      {isLoading ? <PageLoader /> : error ? <ErrorState message={errMsg(error)} retry={refetch} /> : !data?.length ? (
        <Empty title="No projects yet" hint="Create one, or browse public projects and ask to join." action={<Button onClick={() => setOpen(true)}>Create a project</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}><Card className="h-full transition-colors hover:bg-accent/40"><CardBody className="space-y-3">
              <div className="flex items-start justify-between gap-2"><p className="font-medium leading-tight">{p.name}</p><Badge tone={statusTone(p.status)}>{label(p.status)}</Badge></div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{p.description || "No description"}</p>
              <div><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{label(p.my_role ?? "member")}</span><span>{p.progress ?? 0}%</span></div><Progress value={p.progress ?? 0} /></div>
              {p.due_date && <p className="text-xs text-muted-foreground">Due {fmtDate(p.due_date)}</p>}
            </CardBody></Card></Link>
          ))}
        </div>
      )}
      {open && <CreateProject onClose={() => setOpen(false)} />}
    </div>
  );
}
