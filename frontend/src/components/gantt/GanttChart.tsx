import Gantt from "frappe-gantt";
import { useEffect, useRef, useState } from "react";
import { Empty, PageLoader, Select } from "@/components/ui";
import { useMilestones, useTasks } from "@/hooks/useProject";
import { addDays, format, parseISO } from "date-fns";

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

/** Timeline of tasks and milestones. Arrows show task dependencies. Items need a start and/or end date to appear. */
export default function GanttChart({ pid }: { pid: string }) {
  const tasks = useTasks(pid); const ms = useMilestones(pid);
  const ref = useRef<HTMLDivElement>(null); const [mode, setMode] = useState("Week");
  const rows: any[] = [];
  (ms.data?.milestones ?? []).forEach((m) => {
    const end = m.end_date ?? m.start_date; if (!end) return;
    rows.push({ id: `m-${m.id}`, name: `◆ ${m.title} (${m.weight}%)`, start: m.start_date ?? end, end, progress: m.status === "approved" ? 100 : m.status === "in_review" ? 60 : 0, custom_class: "gantt-milestone" });
  });
  (tasks.data ?? []).forEach((t) => {
    const end = t.deadline ?? t.start_date; if (!end) return;
    const start = t.start_date ?? fmt(addDays(parseISO(end), -1));
    rows.push({ id: t.id, name: t.title, start, end: end < start ? start : end, progress: t.status === "completed" ? 100 : t.status === "in_review" ? 75 : t.status === "in_progress" ? 40 : 0,
      dependencies: t.depends_on.join(",") });
  });
  const ids = new Set(rows.map((r) => r.id));
  rows.forEach((r) => { if (r.dependencies) r.dependencies = r.dependencies.split(",").filter((d: string) => ids.has(d)).join(","); });
  const key = JSON.stringify(rows);
  useEffect(() => {
    if (!ref.current || !rows.length) return;
    ref.current.innerHTML = "";
    const g = new Gantt(ref.current, rows, { view_mode: mode, bar_height: 22, padding: 16, custom_popup_html: (t: any) => `<div style="padding:8px 10px;font-size:12px"><b>${String(t.name).replace(/</g, "&lt;")}</b><br/>${t._start.toLocaleDateString()} → ${t._end.toLocaleDateString()}<br/>${t.progress}% done</div>` });
    return () => { g?.clear?.(); };
  }, [key, mode]);
  if (tasks.isLoading || ms.isLoading) return <PageLoader />;
  if (!rows.length) return <Empty title="Nothing to plot yet" hint="Give tasks a start date or deadline, or set milestone dates, and they appear here with their dependencies." />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">◆ Amber bars are milestones. Arrows are task dependencies.</p>
        <Select className="w-32" value={mode} onChange={(e) => setMode(e.target.value)}>{["Day", "Week", "Month"].map((m) => <option key={m}>{m}</option>)}</Select></div>
      <div className="gantt-container overflow-x-auto rounded-lg border scroll-thin"><div ref={ref} /></div>
    </div>
  );
}
