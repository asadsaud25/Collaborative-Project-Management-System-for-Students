import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, Badge, Button, Dialog, Empty, Field, Input, PageLoader, Select, Textarea, statusTone } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useMembers, useMilestones, useTasks } from "@/hooks/useProject";
import { api, toastError } from "@/services/api";
import { cn } from "@/utils/cn";
import { fmtDate, isOverdue, label } from "@/utils/format";
import type { Task, TaskStatus } from "@/types";

const COLS: { id: TaskStatus; title: string }[] = [{ id: "todo", title: "To do" }, { id: "in_progress", title: "In progress" }, { id: "in_review", title: "In review" }, { id: "completed", title: "Completed" }];

function TaskDialog({ pid, task, tasks, onClose }: { pid: string; task: Task | null; tasks: Task[]; onClose: () => void }) {
  const qc = useQueryClient(); const members = useMembers(pid).data ?? []; const ms = useMilestones(pid).data?.milestones ?? [];
  const [f, setF] = useState({ title: task?.title ?? "", description: task?.description ?? "", status: task?.status ?? "todo", priority: task?.priority ?? "medium",
    start_date: task?.start_date ?? "", deadline: task?.deadline ?? "", milestone_id: task?.milestone_id ?? "", assignee_ids: task?.assignee_ids ?? [], depends_on: task?.depends_on ?? [] });
  const toggle = (k: "assignee_ids" | "depends_on", id: string) => setF((s) => ({ ...s, [k]: s[k].includes(id) ? s[k].filter((x) => x !== id) : [...s[k], id] }));
  const done = () => { qc.invalidateQueries({ queryKey: ["tasks", pid] }); qc.invalidateQueries({ queryKey: ["overview", pid] }); onClose(); };
  const save = useMutation({
    mutationFn: () => { const body = { ...f, start_date: f.start_date || null, deadline: f.deadline || null, milestone_id: f.milestone_id || null };
      return task ? api.patch(`/tasks/${task.id}`, body) : api.post(`/projects/${pid}/tasks`, body); },
    onSuccess: () => { toast.success(task ? "Task updated" : "Task created"); done(); }, onError: toastError,
  });
  const del = useMutation({ mutationFn: () => api.delete(`/tasks/${task!.id}`), onSuccess: () => { toast.success("Task deleted"); done(); }, onError: toastError });
  return (
    <Dialog open onClose={onClose} wide title={task ? "Edit task" : "New task"}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TaskStatus })}>{COLS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task["priority"] })}>{["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></Field>
          <Field label="Start"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="Deadline"><Input type="date" value={f.deadline} min={f.start_date || undefined} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        </div>
        <Field label="Milestone"><Select value={f.milestone_id} onChange={(e) => setF({ ...f, milestone_id: e.target.value })}><option value="">None</option>{ms.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select></Field>
        <Field label="Assignees (changing this reassigns the task)"><div className="flex flex-wrap gap-1.5">{members.filter((m) => m.role !== "supervisor").map((m) => (
          <button type="button" key={m.user_id} onClick={() => toggle("assignee_ids", m.user_id)} className={cn("rounded-full border px-2.5 py-1 text-xs", f.assignee_ids.includes(m.user_id) ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>{m.profile?.full_name}</button>))}</div></Field>
        <Field label="Depends on (must finish first)"><div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto scroll-thin">{tasks.filter((t) => t.id !== task?.id).map((t) => (
          <button type="button" key={t.id} onClick={() => toggle("depends_on", t.id)} className={cn("rounded-full border px-2.5 py-1 text-xs", f.depends_on.includes(t.id) ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>{t.title}</button>))}{!tasks.length && <span className="text-xs text-muted-foreground">No other tasks yet.</span>}</div></Field>
        <div className="flex items-center justify-between pt-1">
          {task ? <Button type="button" variant="ghost" className="text-danger" loading={del.isPending} onClick={() => confirm("Delete this task?") && del.mutate()}>Delete</Button> : <span />}
          <div className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>{task ? "Save" : "Create task"}</Button></div>
        </div>
      </form>
    </Dialog>
  );
}

function Card({ task, onOpen, nameOf }: { task: Task; onOpen: () => void; nameOf: (id: string) => string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen} style={{ transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined }}
      className={cn("cursor-grab space-y-2 rounded-md border bg-card p-3 text-left shadow-sm active:cursor-grabbing", isDragging && "z-20 opacity-80 shadow-lg")}>
      <p className="text-sm font-medium leading-snug">{task.title}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={statusTone(task.priority)}>{label(task.priority)}</Badge>
        {task.deadline && <Badge tone={task.status !== "completed" && isOverdue(task.deadline) ? "danger" : "neutral"}>{fmtDate(task.deadline)}</Badge>}
        {task.depends_on.length > 0 && <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground"><Link2 className="h-3 w-3" />{task.depends_on.length}</span>}
      </div>
      <div className="flex -space-x-1">{task.assignee_ids.map((id) => <Avatar key={id} name={nameOf(id)} className="h-5 w-5 ring-2 ring-card" />)}</div>
    </div>
  );
}

function Column({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("flex min-h-[260px] flex-col gap-2 rounded-lg bg-muted/50 p-2 transition-colors", isOver && "bg-accent")}>
      <div className="flex items-center justify-between px-1 text-xs font-medium"><span>{title}</span><span className="text-muted-foreground">{count}</span></div>{children}
    </div>
  );
}

/** Drag-and-drop Kanban. Dropping a card changes its status; unfinished dependencies block the move (server-enforced). */
export default function Kanban({ pid }: { pid: string }) {
  const qc = useQueryClient(); const tasks = useTasks(pid); const members = useMembers(pid);
  const [edit, setEdit] = useState<Task | null | "new">(); const [mine, setMine] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const nameOf = (id: string) => members.data?.find((m) => m.user_id === id)?.profile?.full_name ?? "?";
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch(`/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => { await qc.cancelQueries({ queryKey: ["tasks", pid] }); const prev = qc.getQueryData<Task[]>(["tasks", pid]);
      qc.setQueryData<Task[]>(["tasks", pid], (t) => t?.map((x) => x.id === id ? { ...x, status } : x)); return { prev }; },
    onError: (e, _v, ctx) => { qc.setQueryData(["tasks", pid], ctx?.prev); toastError(e); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["tasks", pid] }); qc.invalidateQueries({ queryKey: ["overview", pid] }); },
  });
  const onDragEnd = (e: DragEndEvent) => { const t = tasks.data?.find((x) => x.id === e.active.id); const to = e.over?.id as TaskStatus | undefined; if (t && to && t.status !== to) move.mutate({ id: t.id, status: to }); };
  if (tasks.isLoading) return <PageLoader />;
  const uid = useAuth.getState().profile?.id;
  const visible = (tasks.data ?? []).filter((t) => !mine || (uid && t.assignee_ids.includes(uid)));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only my tasks</label>
        <Button size="sm" onClick={() => setEdit("new")}><Plus className="h-4 w-4" />New task</Button></div>
      {!tasks.data?.length ? <Empty title="No tasks yet" hint="Create the first task, assign it, set a deadline and drag it across the board as work moves." action={<Button onClick={() => setEdit("new")}>Create task</Button>} /> : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{COLS.map((c) => { const items = visible.filter((t) => t.status === c.id);
            return <Column key={c.id} id={c.id} title={c.title} count={items.length}>{items.map((t) => <Card key={t.id} task={t} nameOf={nameOf} onOpen={() => setEdit(t)} />)}</Column>; })}</div>
        </DndContext>
      )}
      {edit && <TaskDialog pid={pid} task={edit === "new" ? null : edit} tasks={tasks.data ?? []} onClose={() => setEdit(undefined)} />}
    </div>
  );
}
