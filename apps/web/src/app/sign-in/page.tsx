"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function SignIn() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/admin";
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setBusy(false);
    if (r.error) return setErr(r.error.message ?? "Could not send the code");
    setSent(true);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await authClient.signIn.emailOtp({ email, otp });
    setBusy(false);
    if (r.error) return setErr(r.error.message ?? "Wrong or expired code");
    router.push(next);
    router.refresh();
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
            <p className="text-sm text-muted-foreground">We sent a 6-digit code to {email}.</p>
            <label className="block text-sm" htmlFor="otp">Code</label>
            <Input id="otp" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value)} />
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Checking…" : "Sign in"}</Button>
          </form>
        )}
        <Button variant="outline" className="w-full" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}>Continue with Google</Button>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      </Card>
    </main>
  );
}

export default function Page() {
  return <Suspense><SignIn /></Suspense>;
}
