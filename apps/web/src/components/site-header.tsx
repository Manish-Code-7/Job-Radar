import Link from "next/link";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/env";
import { Logo } from "./logo";
import { AccountMenu, MobileTabs, NavLinks } from "./site-nav";

export async function SiteHeader() {
  const s = await getSession().catch(() => null);
  const user = s ? { email: s.user.email, name: s.user.name ?? "", admin: isAdminEmail(s.user.email) } : null;
  return (
    <>
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <Link href={user ? "/feed" : "/"} className="mr-auto flex items-center gap-2.5 rounded-lg font-semibold tracking-tight">
            <Logo />
            <span className="text-[17px]">Job Radar</span>
          </Link>
          {user ? (
            <>
              <NavLinks admin={user.admin} />
              <AccountMenu user={user} />
            </>
          ) : (
            <>
              <Link href="/privacy" className="hidden h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground sm:inline-flex">Privacy</Link>
              <Link href="/sign-in" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Sign in</Link>
            </>
          )}
        </nav>
      </header>
      {user && <MobileTabs />}
    </>
  );
}
