import { useQuery } from "@tanstack/react-query";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { api } from "@/services/api";
import { cn } from "@/utils/cn";

interface Ev { id: string; type: "task" | "milestone" | "meeting"; title: string; date: string; status?: string; link?: string }
const dot = { task: "bg-blue-500", milestone: "bg-amber-500", meeting: "bg-emerald-500" };

/** Month calendar of task deadlines, milestone targets and meetings. */
export default function CalendarView({ pid }: { pid: string }) {
  const [cursor, setCursor] = useState(new Date()); const [sel, setSel] = useState(format(new Date(), "yyyy-MM-dd"));
  const { data } = useQuery({ queryKey: ["calendar", pid], queryFn: async () => (await api.get<Ev[]>(`/projects/${pid}/calendar`)).data });
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) });
  const by = (d: string) => (data ?? []).filter((e) => e.date === d);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between"><p className="font-medium">{format(cursor, "MMMM yyyy")}</p>
          <div className="flex gap-1"><Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>Today</Button><Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button></div></div>
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border text-xs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b bg-muted/50 px-2 py-1.5 text-center text-muted-foreground">{d}</div>)}
          {days.map((d) => { const k = format(d, "yyyy-MM-dd"); const ev = by(k);
            return <button key={k} onClick={() => setSel(k)} className={cn("min-h-[72px] border-b border-r p-1.5 text-left hover:bg-accent/50", !isSameMonth(d, cursor) && "text-muted-foreground/50", sel === k && "bg-accent")}>
              <span className={cn("inline-grid h-5 w-5 place-items-center rounded-full", isToday(d) && "bg-primary text-primary-foreground")}>{format(d, "d")}</span>
              <div className="mt-1 flex flex-wrap gap-0.5">{ev.slice(0, 6).map((e) => <span key={e.type + e.id} className={cn("h-1.5 w-1.5 rounded-full", dot[e.type])} />)}</div></button>; })}
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">{(["task", "milestone", "meeting"] as const).map((t) => <span key={t} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", dot[t])} />{t}</span>)}</div>
      </div>
      <Card><CardBody className="space-y-2"><p className="text-sm font-medium">{format(new Date(sel + "T00:00:00"), "EEE d MMM")}</p>
        {!by(sel).length ? <p className="text-xs text-muted-foreground">Nothing scheduled.</p> : by(sel).map((e) => (
          <div key={e.type + e.id} className="flex items-start gap-2 text-sm"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot[e.type])} /><div className="min-w-0 flex-1"><p className="truncate">{e.title}</p>
            <div className="flex gap-1"><Badge>{e.type}</Badge>{e.status && <Badge>{e.status.replace("_", " ")}</Badge>}</div></div>{e.link && <a href={e.link} target="_blank" rel="noreferrer" aria-label="Join"><ExternalLink className="h-4 w-4" /></a>}</div>))}
      </CardBody></Card>
    </div>
  );
}
