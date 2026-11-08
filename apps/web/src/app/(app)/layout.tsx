import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession().catch(() => null);
  if (!s) redirect("/sign-in?next=/feed");
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">{children}</main>
    </>
  );
}
