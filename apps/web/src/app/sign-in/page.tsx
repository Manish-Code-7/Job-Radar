"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const VERIFIER = "neon_auth_session_verifier";

/** Only allow same-site relative redirects (no //host or absolute URLs). */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/admin";
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
      <main className="mx-auto max-w-sm px-4 py-20">
        <Card className="p-6"><p role="status">Finishing Google sign-in…</p></Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-20">
      <Card className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {!sent ? (
          <form onSubmit={send} className="space-y-3">
            <label className="block text-sm" htmlFor="email">Email</label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Sending…" : "Email me a code"}</Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-sm text-muted-foreground">We sent a 6-digit code to {email}. Use the newest email if you asked more than once.</p>
            <label className="block text-sm" htmlFor="otp">Code</label>
            <Input id="otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            <Button type="submit" disabled={busy || otp.length !== 6} className="w-full">{busy ? "Checking…" : "Sign in"}</Button>
            <button type="button" className="w-full text-sm text-muted-foreground underline" onClick={() => { setSent(false); setErr(null); }}>
              Use a different email or get a new code
            </button>
          </form>
        )}
        <Button variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      </Card>
    </main>
  );
}

export default function Page() {
  return <Suspense><SignIn /></Suspense>;
}
