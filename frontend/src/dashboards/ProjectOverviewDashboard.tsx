import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarDays, FileText, GanttChartSquare, GitBranch, KanbanSquare, LayoutGrid, Lightbulb, Milestone as MilestoneIcon, Users, Video } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ContributionCharts, ExportButtons, LogsPanel, ProgressPanel, RiskPanel } from "@/components/analytics/Analytics";
import CalendarView from "@/components/common/CalendarView";
import Files from "@/components/files/Files";
import GanttChart from "@/components/gantt/GanttChart";
import GithubPanel from "@/components/github/GithubPanel";
import IdeaBoard from "@/components/ideaboard/IdeaBoard";
import Kanban from "@/components/kanban/Kanban";
import Meetings from "@/components/meetings/Meetings";
import Milestones from "@/components/milestones/Milestones";
import Team from "@/components/team/Team";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageLoader, Stat, Tabs, statusTone } from "@/components/ui";
import { api, errMsg } from "@/services/api";
import type { Progress, Project, Risk, Task } from "@/types";
import { fmtDate, label } from "@/utils/format";

interface Overview { progress: Progress; risks: Risk[]; health: string; task_counts: Record<string, number>; task_total: number; member_count: number; upcoming_deadlines: Task[] }

/** Project hub: summary, Kanban, Gantt, calendar, milestones, team, GitHub, ideas, meetings, files and logs. */
export default function ProjectOverviewDashboard() {
  const { id = "" } = useParams(); const nav = useNavigate(); const [params, setParams] = useSearchParams(); const tab = params.get("tab") ?? "overview";
  const project = useQuery({ queryKey: ["project", id], queryFn: async () => (await api.get<Project>(`/projects/${id}`)).data, retry: false });
  const ov = useQuery({ queryKey: ["overview", id], enabled: !!project.data, queryFn: async () => (await api.get<Overview>(`/projects/${id}/overview`)).data });
  if (project.isLoading) return <PageLoader />;
  if (project.error || !project.data) return <ErrorState message={errMsg(project.error)} retry={() => nav("/projects")} />;
  const p = project.data; const role = p.my_role ?? "member";
  const canManage = ["owner", "supervisor", "admin"].includes(role); const canReview = canManage || role === "reviewer";
  const tabs = [
    { id: "overview", label: "Overview", icon: <LayoutGrid className="h-3.5 w-3.5" /> }, { id: "board", label: "Board", icon: <KanbanSquare className="h-3.5 w-3.5" /> },
    { id: "gantt", label: "Gantt", icon: <GanttChartSquare className="h-3.5 w-3.5" /> }, { id: "calendar", label: "Calendar", icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { id: "milestones", label: "Milestones", icon: <MilestoneIcon className="h-3.5 w-3.5" /> }, { id: "team", label: "Team", icon: <Users className="h-3.5 w-3.5" /> },
    { id: "github", label: "GitHub", icon: <GitBranch className="h-3.5 w-3.5" /> }, { id: "ideas", label: "Ideas", icon: <Lightbulb className="h-3.5 w-3.5" /> },
    { id: "meetings", label: "Meetings", icon: <Video className="h-3.5 w-3.5" /> }, { id: "files", label: "Files", icon: <FileText className="h-3.5 w-3.5" /> }, { id: "logs", label: "Logs", icon: <Activity className="h-3.5 w-3.5" /> },
  ];
  const o = ov.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold tracking-tight">{p.name}</h1><Badge tone={statusTone(p.status)}>{label(p.status)}</Badge>{o && <Badge tone={statusTone(o.health)}>{label(o.health)}</Badge>}</div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{p.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">Owner {p.owner?.full_name}{p.supervisor ? ` · Supervisor ${p.supervisor.full_name}` : ""}{p.due_date ? ` · Due ${fmtDate(p.due_date)}` : ""}</p></div>
        {canManage && <ExportButtons pid={id} name={p.name} />}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === "overview" && (!o ? <PageLoader /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Overall progress" value={`${o.progress.overall_percent}%`} /><Stat label="Tasks" value={o.task_total} hint={`${o.task_counts.completed ?? 0} completed`} /><Stat label="Members" value={o.member_count} /><Stat label="Open risks" value={o.risks.length} /></div>
          <div className="grid gap-4 lg:grid-cols-2"><ProgressPanel pid={id} progress={o.progress} /><RiskPanel risks={o.risks} /></div>
          <ContributionCharts pid={id} taskCounts={o.task_counts} />
          <Card><CardHeader><CardTitle>Upcoming deadlines</CardTitle></CardHeader><CardBody className="space-y-1.5 !pt-3">{!o.upcoming_deadlines.length ? <p className="text-xs text-muted-foreground">Nothing due soon.</p> : o.upcoming_deadlines.map((t) => <div key={t.id} className="flex justify-between text-sm"><span>{t.title}</span><span className="text-xs text-muted-foreground">{fmtDate(t.deadline)}</span></div>)}</CardBody></Card>
        </div>))}
      {tab === "board" && <Kanban pid={id} />}
      {tab === "gantt" && <GanttChart pid={id} />}
      {tab === "calendar" && <CalendarView pid={id} />}
      {tab === "milestones" && <Milestones pid={id} canManage={canManage} canReview={canReview} />}
      {tab === "team" && <Team pid={id} canManage={canManage} />}
      {tab === "github" && <GithubPanel pid={id} canManage={canManage} connected={p.github_connected} />}
      {tab === "ideas" && <IdeaBoard pid={id} canManage={canManage} />}
      {tab === "meetings" && <Meetings pid={id} canManage={canManage} />}
      {tab === "files" && <Files pid={id} />}
      {tab === "logs" && <LogsPanel pid={id} />}
    </div>
  );
}
