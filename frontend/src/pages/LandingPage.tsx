import { ArrowRight, GitBranch, KanbanSquare, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Brand, useTheme } from "@/components/common/Layout";
import { Badge, Button, Card, CardBody, Progress } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { Moon, Sun } from "lucide-react";

/** Small interactive demo: approving a milestone moves weighted progress, exactly like the real product. */
function Demo() {
  const [ms, setMs] = useState([
    { t: "Requirements & ERD", w: 20, s: "approved" }, { t: "REST API", w: 30, s: "in_review" },
    { t: "Frontend MVP", w: 30, s: "planned" }, { t: "Testing & report", w: 20, s: "planned" },
  ]);
  const total = ms.filter((m) => m.s === "approved").reduce((a, m) => a + m.w, 0);
  const step = (i: number) => setMs((arr) => arr.map((m, j) => j !== i ? m : { ...m, s: m.s === "planned" ? "in_review" : m.s === "in_review" ? "approved" : "planned" }));
  return (
    <Card className="mx-auto w-full max-w-xl text-left shadow-xl"><CardBody className="space-y-4">
      <div className="flex items-center justify-between"><p className="font-medium">Capstone: Library Portal</p><Badge tone="info">Live demo</Badge></div>
      <div><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Overall progress (approved weight)</span><span className="font-medium text-foreground">{total}%</span></div><Progress value={total} /></div>
      <ul className="divide-y">
        {ms.map((m, i) => (
          <li key={m.t} className="flex items-center justify-between py-2">
            <div><p className="text-sm">{m.t}</p><p className="text-xs text-muted-foreground">{m.w}% weight</p></div>
            <Button size="sm" variant={m.s === "in_review" ? "default" : "outline"} onClick={() => step(i)}>
              {m.s === "planned" ? "Submit" : m.s === "in_review" ? "Approve" : "Approved ✓"}
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Try it: a student submits, the lead approves, and progress updates automatically.</p>
    </CardBody></Card>
  );
}

export default function LandingPage() {
  const { session } = useAuth();
  const { dark, toggle } = useTheme();
  const features = [
    { i: KanbanSquare, t: "Plan visibly", d: "Kanban, Gantt and a shared calendar with task dependencies." },
    { i: ShieldCheck, t: "Weighted, approved milestones", d: "Weights add up to 100%. Progress moves only after the project lead approves." },
    { i: GitBranch, t: "Private GitHub repos", d: "Commits, PRs and issues next to each submission, so reviews rest on evidence." },
    { i: Users, t: "Built for supervised teams", d: "Invites, join requests, DMs, idea board, meetings and role dashboards." },
  ];
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Brand />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
          {session ? <Link to="/dashboard"><Button size="sm">Open app</Button></Link> : <><Link to="/sign-in"><Button variant="ghost" size="sm">Sign in</Button></Link><Link to="/sign-up"><Button size="sm">Get started</Button></Link></>}
        </div>
      </header>
      <section className="mx-auto max-w-4xl px-4 pb-16 pt-16 text-center">
        <Badge className="mb-4">For CS students and faculty</Badge>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Group projects your supervisor can actually follow.</h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">Plan work, split it into weighted milestones, connect your GitHub repo and get every submission reviewed in one place.</p>
        <div className="mt-6 flex justify-center gap-2"><Link to="/sign-up"><Button size="lg">Start a project <ArrowRight className="h-4 w-4" /></Button></Link><Link to="/sign-in"><Button size="lg" variant="outline">Sign in</Button></Link></div>
        <div className="mt-12"><Demo /></div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-3 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => <Card key={f.t}><CardBody><f.i className="mb-3 h-5 w-5" /><p className="font-medium">{f.t}</p><p className="mt-1 text-xs text-muted-foreground">{f.d}</p></CardBody></Card>)}
      </section>
    </div>
  );
}
