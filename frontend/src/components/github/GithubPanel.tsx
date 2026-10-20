import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitBranch, GitCommit, GitPullRequest, CircleDot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, ErrorState, Field, Input, PageLoader, Tabs } from "@/components/ui";
import { api, errMsg, toastError } from "@/services/api";
import type { Commit } from "@/types";
import { ago, fmtDateTime } from "@/utils/format";

interface Activity {
  connected: boolean; repository?: string; commits: Commit[]; branches: { name: string; sha: string; protected: boolean }[];
  pull_requests: { number: number; title: string; state: string; author: string; updated_at: string; url: string; branch: string }[];
  issues: { number: number; title: string; state: string; author: string; updated_at: string; url: string }[];
}

/** Connect a private repo (PAT or OAuth) and browse commits, PRs, issues, branches and webhook events. */
export default function GithubPanel({ pid, canManage, connected }: { pid: string; canManage: boolean; connected: boolean }) {
  const qc = useQueryClient(); const [tab, setTab] = useState("commits"); const [author, setAuthor] = useState("");
  const [f, setF] = useState({ owner: "", repo: "", token: "" }); const [manual, setManual] = useState<null | { payload_url: string; secret: string }>(null);
  const act = useQuery({ queryKey: ["github", pid, author], enabled: connected, retry: false, queryFn: async () => (await api.get<Activity>(`/projects/${pid}/github/activity`, { params: { author: author || undefined } })).data });
  const events = useQuery({ queryKey: ["github-events", pid], enabled: connected, queryFn: async () => (await api.get<{ id: string; title: string; author?: string; url?: string; occurred_at: string }[]>(`/projects/${pid}/github/events`)).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["project", pid] }); qc.invalidateQueries({ queryKey: ["github", pid] }); };
  const connect = useMutation({
    mutationFn: async () => (await api.put(`/projects/${pid}/github`, { owner: f.owner.trim(), repo: f.repo.trim(), token: f.token.trim(), auth_type: "pat" })).data,
    onSuccess: (d) => { toast.success(`Connected ${d.repository}${d.private ? " (private)" : ""}`); setF({ ...f, token: "" }); if (d.manual_webhook) setManual(d.manual_webhook); refresh(); }, onError: toastError,
  });
  const oauth = useMutation({ mutationFn: async () => (await api.get<{ url: string }>("/github/oauth/url", { params: { project_id: pid } })).data, onSuccess: (d) => { window.location.href = d.url; }, onError: toastError });
  const disconnect = useMutation({ mutationFn: () => api.delete(`/projects/${pid}/github`), onSuccess: () => { toast.success("Disconnected"); refresh(); }, onError: toastError });

  if (!connected) return !canManage ? <p className="text-sm text-muted-foreground">The project owner has not connected a GitHub repository yet.</p> : (
    <Card className="max-w-xl"><CardBody className="space-y-3">
      <div><h2 className="font-medium">Connect a GitHub repository</h2><p className="text-xs text-muted-foreground">Works with private repositories. Create a fine-grained or classic Personal Access Token with read access to contents, issues and pull requests (classic: the <code>repo</code> scope). It is stored encrypted and never shown again.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Owner"><Input placeholder="octocat" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} /></Field><Field label="Repository"><Input placeholder="my-project" value={f.repo} onChange={(e) => setF({ ...f, repo: e.target.value })} /></Field></div>
      <Field label="Personal access token"><Input type="password" autoComplete="off" placeholder="ghp_… or github_pat_…" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} /></Field>
      <div className="flex flex-wrap gap-2"><Button loading={connect.isPending} disabled={!f.owner || !f.repo || !f.token} onClick={() => connect.mutate()}>Connect with token</Button><Button variant="outline" loading={oauth.isPending} onClick={() => oauth.mutate()}>Connect with GitHub OAuth</Button></div>
    </CardBody></Card>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><GitBranch className="h-4 w-4" /><span className="font-medium">{act.data?.repository ?? "Repository"}</span><Badge tone="success">Connected</Badge></div>
        <div className="flex gap-2"><Input className="h-8 w-40" placeholder="Filter by author" value={author} onChange={(e) => setAuthor(e.target.value)} />{canManage && <Button variant="outline" size="sm" onClick={() => confirm("Disconnect this repository?") && disconnect.mutate()}>Disconnect</Button>}</div></div>
      {manual && <Card><CardBody className="space-y-1 text-xs"><p className="font-medium">Add this webhook manually for live events (Settings → Webhooks)</p><p>Payload URL: <code>{manual.payload_url}</code></p><p>Content type: application/json · Secret: <code>{manual.secret}</code> · Events: push, issues, pull requests</p><p className="text-muted-foreground">GitHub cannot reach localhost. For local testing the activity tabs below still work without a webhook.</p></CardBody></Card>}
      {act.isLoading ? <PageLoader /> : act.error ? <ErrorState message={errMsg(act.error)} retry={act.refetch} /> : act.data && <>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "commits", label: `Commits (${act.data.commits.length})`, icon: <GitCommit className="h-3.5 w-3.5" /> }, { id: "prs", label: `Pull requests (${act.data.pull_requests.length})`, icon: <GitPullRequest className="h-3.5 w-3.5" /> },
          { id: "issues", label: `Issues (${act.data.issues.length})`, icon: <CircleDot className="h-3.5 w-3.5" /> }, { id: "branches", label: `Branches (${act.data.branches.length})`, icon: <GitBranch className="h-3.5 w-3.5" /> }, { id: "events", label: "Live events" }]} />
        <Card><CardBody className="divide-y !py-1">
          {tab === "commits" && (act.data.commits.length ? act.data.commits.map((c) => <div key={c.sha} className="flex items-center gap-3 py-2.5 text-sm"><code className="rounded bg-muted px-1.5 text-xs">{c.short_sha}</code><span className="min-w-0 flex-1 truncate">{c.message}</span><span className="shrink-0 text-xs text-muted-foreground">{c.author} · {c.date ? ago(c.date) : ""}</span>{c.url && <a href={c.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>}</div>) : <p className="py-3 text-xs text-muted-foreground">No commits.</p>)}
          {tab === "prs" && act.data.pull_requests.map((p) => <div key={p.number} className="flex items-center gap-3 py-2.5 text-sm"><Badge tone={p.state === "merged" ? "success" : p.state === "open" ? "info" : "neutral"}>{p.state}</Badge><span className="min-w-0 flex-1 truncate">#{p.number} {p.title}</span><span className="text-xs text-muted-foreground">{p.author} · {p.branch}</span><a href={p.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a></div>)}
          {tab === "issues" && act.data.issues.map((i) => <div key={i.number} className="flex items-center gap-3 py-2.5 text-sm"><Badge tone={i.state === "open" ? "warning" : "success"}>{i.state}</Badge><span className="min-w-0 flex-1 truncate">#{i.number} {i.title}</span><span className="text-xs text-muted-foreground">{i.author} · {ago(i.updated_at)}</span><a href={i.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a></div>)}
          {tab === "branches" && act.data.branches.map((b) => <div key={b.name} className="flex items-center gap-3 py-2.5 text-sm"><GitBranch className="h-3.5 w-3.5" /><span className="flex-1">{b.name}</span><code className="text-xs text-muted-foreground">{b.sha}</code>{b.protected && <Badge>protected</Badge>}</div>)}
          {tab === "events" && (events.data?.length ? events.data.map((e) => <div key={e.id} className="flex items-center gap-3 py-2.5 text-sm"><span className="min-w-0 flex-1 truncate">{e.title}</span><span className="text-xs text-muted-foreground">{e.author} · {fmtDateTime(e.occurred_at)}</span></div>) : <p className="py-3 text-xs text-muted-foreground">No webhook events received yet. They appear here as teammates push or open PRs.</p>)}
        </CardBody></Card></>}
    </div>
  );
}
