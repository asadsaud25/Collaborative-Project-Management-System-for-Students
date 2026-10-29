import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Brand } from "@/components/common/Layout";
import { Button, Card, CardBody, ErrorState, PageLoader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, errMsg, toastError } from "@/services/api";
import { GoogleIcon, googleSignIn } from "./AuthPages";

/** Landing page for emailed invite links: shows the project, then asks the user to sign in / up and joins them. */
export default function AcceptInvite() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { session } = useAuth();
  const preview = useQuery({ queryKey: ["invite", token], meta: { inline: true }, queryFn: async () => (await api.get(`/invites/${token}`)).data as { project_name: string; email: string; invited_by?: string }, retry: false });
  const accept = useMutation({
    mutationFn: async () => (await api.post(`/invites/${token}/accept`)).data as { project_id: string },
    onSuccess: (d) => { toast.success("You joined the project"); nav(`/projects/${d.project_id}`, { replace: true }); },
    onError: toastError,
  });
  const next = `/invite/${token}`;
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Brand /></div>
        {preview.isLoading ? <PageLoader /> : preview.isError ? <ErrorState message={errMsg(preview.error)} /> : (
          <Card><CardBody className="space-y-4 p-6">
            <div><h1 className="text-lg font-semibold tracking-tight">Join {preview.data!.project_name}</h1>
              <p className="text-sm text-muted-foreground">{preview.data!.invited_by ? `${preview.data!.invited_by} invited` : "You were invited"} <span className="font-medium text-foreground">{preview.data!.email}</span>.</p></div>
            {session ? <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>Accept invitation</Button> : (
              <div className="space-y-2">
                <Button variant="outline" className="w-full" onClick={() => googleSignIn(next)}><GoogleIcon />Continue with Google</Button>
                <Button className="w-full" onClick={() => nav(`/sign-up?next=${encodeURIComponent(next)}&email=${encodeURIComponent(preview.data!.email)}`)}>Create account with email</Button>
                <Button variant="ghost" className="w-full" onClick={() => nav(`/sign-in?next=${encodeURIComponent(next)}`)}>I already have an account</Button>
                <p className="text-center text-xs text-muted-foreground">Sign in with {preview.data!.email} and you are added automatically.</p>
              </div>
            )}
          </CardBody></Card>
        )}
      </div>
    </div>
  );
}
