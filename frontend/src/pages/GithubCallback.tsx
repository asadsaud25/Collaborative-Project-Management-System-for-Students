import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, CardBody, ErrorState, PageLoader } from "@/components/ui";
import { api, errMsg } from "@/services/api";

interface Repo { owner: string; name: string; full_name: string; private: boolean }

/** GitHub OAuth redirect target: exchanges the code, then lets the owner pick which repository to connect. */
export default function GithubCallback() {
  const [params] = useSearchParams(); const nav = useNavigate(); const ran = useRef(false);
  const [state, setState] = useState<{ project_id: string; repos: Repo[] } | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    const code = params.get("code"), st = params.get("state");
    if (!code || !st) return setError("GitHub did not return an authorisation code.");
    api.post("/github/oauth/exchange", { code, state: st }).then((r) => setState(r.data)).catch((e) => setError(errMsg(e)));
  }, [params]);
  const connect = useMutation({
    mutationFn: (r: Repo) => api.put(`/projects/${state!.project_id}/github`, { owner: r.owner, repo: r.name, auth_type: "oauth" }),
    onSuccess: () => { toast.success("Repository connected"); nav(`/projects/${state!.project_id}?tab=github`); }, onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="mx-auto max-w-lg py-10">
      {error ? <ErrorState message={error} /> : !state ? <PageLoader /> : (
        <Card><CardBody className="space-y-3"><h1 className="text-lg font-semibold">Choose a repository</h1>
          <div className="max-h-96 divide-y overflow-y-auto scroll-thin rounded-md border">{state.repos.map((r) => (
            <div key={r.full_name} className="flex items-center justify-between px-3 py-2"><span className="text-sm">{r.full_name}{r.private && <span className="ml-2 text-xs text-muted-foreground">private</span>}</span>
              <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate(r)}>Connect</Button></div>))}</div></CardBody></Card>
      )}
    </div>
  );
}
