import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Brand } from "@/components/common/Layout";
import { Button, Card, CardBody, Field, Input, PageLoader } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/services/supabase";

/** Supabase reports a bad or expired recovery link in the URL fragment (#error_description=...). */
function linkError(): string | null {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const q = new URLSearchParams(location.search);
  const desc = h.get("error_description") ?? q.get("error_description");
  return desc ? desc.replace(/\+/g, " ") : null;
}

/** Step 2 of password recovery. Opening the emailed link signs the user in with a recovery session
 *  (the Supabase client picks the token up from the URL); here they choose the new password. */
export default function ResetPassword() {
  const { session, loading, refreshProfile } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 6) return void toast.error("Use at least 6 characters.");
    if (pw.next !== pw.confirm) return void toast.error("The two passwords do not match.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
      await refreshProfile();
      toast.success("Password updated. You're signed in.");
      nav("/dashboard", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the password. Request a new link and try again.");
    } finally { setBusy(false); }
  };

  if (loading) return <div className="grid min-h-screen place-items-center"><PageLoader /></div>;

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <Card><CardBody className="space-y-4 p-6">
          {session ? (
            <>
              <div><h1 className="text-lg font-semibold tracking-tight">Choose a new password</h1>
                <p className="text-xs text-muted-foreground">You'll be signed in once it's saved.</p></div>
              <form onSubmit={submit} className="space-y-3">
                <Field label="New password" hint="At least 6 characters."><Input type="password" required minLength={6} autoFocus value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
                <Field label="Confirm new password"><Input type="password" required minLength={6} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></Field>
                <Button type="submit" className="w-full" loading={busy}>Update password</Button>
              </form>
            </>
          ) : (
            <div className="space-y-3 text-center">
              <h1 className="text-lg font-semibold tracking-tight">This reset link can't be used</h1>
              <p className="text-sm text-muted-foreground">{linkError() ?? "The link is invalid or has expired."} Request a new one and open it in the same browser.</p>
              <Link to="/forgot-password"><Button className="w-full">Request a new link</Button></Link>
            </div>
          )}
        </CardBody></Card>
      </div>
    </div>
  );
}
