import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/env";

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Health"],
  ["/admin/companies", "Companies"],
  ["/admin/jobs", "Jobs"],
  ["/admin/takedowns", "Takedowns"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession().catch(() => null);
  if (!s) redirect("/sign-in?next=/admin");
  if (!isAdminEmail(s.user.email)) {
    return <main className="mx-auto max-w-md px-4 py-20 text-center"><h1 className="text-xl font-semibold">Not an admin</h1><p className="mt-2 text-sm text-muted-foreground">{s.user.email} is not in ADMIN_EMAILS.</p></main>;
  }
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2 text-sm">
          <span className="mr-3 font-semibold">Job Radar · Admin</span>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-md px-3 py-1.5 hover:bg-muted">{label}</Link>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{s.user.email}</span>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
