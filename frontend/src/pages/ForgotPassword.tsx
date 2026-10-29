import { ArrowLeft, MailCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Brand } from "@/components/common/Layout";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";
import { supabase } from "@/services/supabase";

/** Step 1 of password recovery: asks Supabase to email a reset link that lands on /reset-password. */
export default function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${location.origin}/reset-password` });
      if (error) throw error;
      // Same message whether or not the address has an account, so this form cannot be used to discover who is registered.
      setSentTo(address);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(/rate limit|too many/i.test(msg) ? "Too many reset emails requested. Please wait a few minutes and try again." : msg || "Could not send the reset email. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <Card><CardBody className="space-y-4 p-6">
          {sentTo ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent"><MailCheck className="h-5 w-5" /></div>
              <h1 className="text-lg font-semibold tracking-tight">Check your email</h1>
              <p className="text-sm text-muted-foreground">If an account exists for <b className="text-foreground">{sentTo}</b>, a link to reset your password is on its way. It expires after a short time.</p>
              <Button variant="outline" className="w-full" onClick={() => setSentTo(null)}>Use a different email</Button>
            </div>
          ) : (
            <>
              <div><h1 className="text-lg font-semibold tracking-tight">Forgot your password?</h1>
                <p className="text-xs text-muted-foreground">Enter your email and we'll send you a link to choose a new one.</p></div>
              <form onSubmit={submit} className="space-y-3">
                <Field label="Email"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
                <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
              </form>
            </>
          )}
        </CardBody></Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link className="inline-flex items-center gap-1 font-medium text-foreground underline" to="/sign-in"><ArrowLeft className="h-3 w-3" />Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
