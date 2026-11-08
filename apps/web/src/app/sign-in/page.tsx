"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Check } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Hint, Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const VERIFIER = "neon_auth_session_verifier";

/** Only allow same-site relative redirects (no //host or absolute URLs). */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/feed";
}

function message(e: unknown, fallback: string): string {
  const m = (e as { message?: string; error?: { message?: string } })?.error?.message ?? (e as Error)?.message;
  if (m && /invalid otp|invalid code/i.test(m)) return "That code is wrong or was already used. Each code works once. Request a new one.";
  if (m && /expired/i.test(m)) return "That code has expired. Request a new one.";
  return m || fallback;
}

function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next") ?? params.get("redirectTo"));
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(params.has(VERIFIER));

  const go = () => {
    // Full navigation, so the server sees the fresh session cookie.
    window.location.assign(next);
  };

  // Returning from Google: Neon appends a one-time verifier. getSession() exchanges it for the session cookie.
  useEffect(() => {
    if (!params.has(VERIFIER)) return;
    authClient
      .getSession()
      .then(({ data }) => {
        if (data?.user) go();
        else {
          setFinishing(false);
          setErr("Google sign-in didn't complete. Please try again.");
        }
      })
      .catch((e) => {
        setFinishing(false);
        setErr(message(e, "Google sign-in didn't complete. Please try again."));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await authClient.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: "sign-in" });
      if (r.error) throw r.error;
      setSent(true);
      setOtp("");
    } catch (e2) {
      setErr(message(e2, "Could not send the code"));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return; // a code can be used once: never submit it twice
    setBusy(true);
    setErr(null);
    try {
      const r = await authClient.signIn.emailOtp({ email: email.trim().toLowerCase(), otp: otp.trim() });
      if (r.error) throw r.error;
      // Make sure the browser actually kept the session cookie before leaving this page.
      const { data } = await authClient.getSession();
      if (!data?.user) {
        setErr(
          location.protocol === "http:"
            ? "Signed in, but this browser refused the secure session cookie on http://localhost (Safari does this). Use Chrome/Firefox, or run the app with `pnpm dev:web:https`."
            : "Signed in, but the session cookie was not stored. Check that cookies are allowed for this site.",
        );
        setBusy(false);
        return;
      }
      go();
    } catch (e2) {
      setErr(message(e2, "Wrong or expired code"));
      setBusy(false);
    }
  }

  async function google() {
    setErr(null);
    try {
      // Absolute URL so Neon returns the browser to our app, onto a page the auth proxy handles.
      await authClient.signIn.social({ provider: "google", callbackURL: new URL(next, window.location.origin).toString() });
    } catch (e) {
      setErr(message(e, "Could not start Google sign-in"));
    }
  }

  if (finishing) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <p role="status" className="flex items-center gap-3 text-muted-foreground"><span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />Finishing Google sign-in…</p>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <Link href="/" className="flex items-center gap-2.5 font-semibold"><Logo className="size-8 [&_rect]:fill-primary-foreground/15" />Job Radar</Link>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">Every job here was open when we checked it today.</h2>
          <ul className="mt-8 space-y-3 text-[15px] opacity-90">
            {["Straight from company career pages", "Only roles for 0–2 years' experience", "Matched to your resume, privately"].map((t) => (
              <li key={t} className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-primary-foreground/15"><Check className="size-3.5" aria-hidden="true" /></span>{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm opacity-70">Free for job seekers.</p>
      </aside>

      <section className="flex flex-col px-4 py-8 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-semibold lg:hidden"><Logo />Job Radar</Link>
        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <h1 className="text-[26px] font-semibold tracking-tight">{sent ? "Check your email" : "Sign in or create an account"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {sent ? <>We sent a 6-digit code to <b className="font-medium text-foreground">{email}</b>. It expires in 10 minutes.</> : "No password needed. We'll email you a one-time code."}
          </p>

          {!sent ? (
            <>
              <Button type="button" variant="outline" className="mt-8 h-12 w-full text-[15px]" onClick={google}>
                <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" /></svg>
                Continue with Google
              </Button>
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or with email<span className="h-px flex-1 bg-border" /></div>
              <form onSubmit={send} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" className="h-12" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" disabled={busy} className="h-12 w-full text-[15px]">{busy ? "Sending code…" : "Email me a code"}</Button>
              </form>
            </>
          ) : (
            <form onSubmit={verify} className="mt-8 space-y-4">
              <div>
                <Label htmlFor="otp">6-digit code</Label>
                <Input id="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus autoComplete="one-time-code" placeholder="••••••" className="h-14 text-center text-2xl font-semibold tracking-[0.5em] tabular-nums" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
                <Hint>Use the newest email if you asked more than once.</Hint>
              </div>
              <Button type="submit" disabled={busy || otp.length !== 6} className="h-12 w-full text-[15px]">{busy ? "Checking…" : "Sign in"}</Button>
              <button type="button" className="h-11 w-full cursor-pointer text-sm text-primary hover:underline" onClick={() => { setSent(false); setErr(null); }}>
                Use a different email or resend
              </button>
            </form>
          )}
          {err && <p role="alert" className="mt-4 rounded-lg bg-bad-soft p-3 text-sm text-bad">{err}</p>}
          <p className="mt-8 text-[13px] leading-relaxed text-muted-foreground">
            By continuing you agree to our <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">privacy notice</Link>. We&apos;ll ask before using your resume.
          </p>
        </div>
      </section>
    </main>
  );
}

export default function Page() {
  return <Suspense><SignIn /></Suspense>;
}
