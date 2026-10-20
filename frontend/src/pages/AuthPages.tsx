import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Brand } from "@/components/common/Layout";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/services/supabase";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4"><path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.8 0-5.3-1.9-6.1-4.5H2.3v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.9 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.3a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.1l3.6 2.8C6.7 7.3 9.2 5.4 12 5.4z"/></svg>
);

/** Starts Google OAuth through Supabase. `next` is where the user lands afterwards. */
export async function googleSignIn(next = "/dashboard") {
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}${next}` } });
  if (error) toast.error(error.message);
}
export { GoogleIcon };

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [params] = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const nav = useNavigate();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", email: params.get("email") ?? "", password: "" });
  const up = mode === "sign-up";
  if (session) return <Navigate to={next} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      if (up) {
        const { data, error } = await supabase.auth.signUp({ email: f.email, password: f.password, options: { data: { full_name: f.name }, emailRedirectTo: `${location.origin}${next}` } });
        if (error) throw error;
        if (!data.session) toast.success("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw error;
        nav(next, { replace: true });
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Authentication failed"); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <Card><CardBody className="space-y-4 p-6">
          <div><h1 className="text-lg font-semibold tracking-tight">{up ? "Create your account" : "Welcome back"}</h1>
            <p className="text-xs text-muted-foreground">{up ? "Use Google or your email address." : "Sign in to continue to your projects."}</p></div>
          <Button variant="outline" className="w-full" onClick={() => googleSignIn(next)}><GoogleIcon />Continue with Google</Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <form onSubmit={submit} className="space-y-3">
            {up && <Field label="Full name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>}
            <Field label="Email"><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
            <Field label="Password" hint={up ? "At least 6 characters." : undefined}><Input type="password" required minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={up ? "new-password" : "current-password"} /></Field>
            <Button type="submit" className="w-full" loading={busy}>{up ? "Create account" : "Sign in"}</Button>
          </form>
        </CardBody></Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {up ? "Already have an account?" : "New here?"}{" "}
          <Link className="font-medium text-foreground underline" to={`${up ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(next)}`}>{up ? "Sign in" : "Create an account"}</Link>
        </p>
      </div>
    </div>
  );
}
