import Link from "next/link";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/env";
import { SignOutButton } from "./sign-out-button";

export async function SiteHeader() {
  const s = await getSession().catch(() => null);
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-4 text-sm">
        <Link href={s ? "/feed" : "/"} className="mr-auto flex items-center gap-2 font-semibold">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-primary" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 12 19 5" /></svg>
          Job Radar
        </Link>
        {s ? (
          <>
            <Link href="/feed" className="inline-flex h-11 items-center rounded-lg px-3 hover:bg-muted">Feed</Link>
            <Link href="/settings" className="inline-flex h-11 items-center rounded-lg px-3 hover:bg-muted">Settings</Link>
            {isAdminEmail(s.user.email) && <Link href="/admin" className="hidden h-11 items-center rounded-lg px-3 hover:bg-muted sm:inline-flex">Admin</Link>}
            <SignOutButton />
          </>
        ) : (
          <Link href="/sign-in" className="inline-flex h-11 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:opacity-90">Sign in</Link>
        )}
      </nav>
    </header>
  );
}
