import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Job Radar</h1>
      <p className="mt-3 text-muted-foreground">
        Openings for freshers and people with 0–2 years&apos; experience in India, taken only from each company&apos;s own careers
        page and checked every day so you never apply to a dead link.
      </p>
      <p className="mt-6 text-sm text-muted-foreground">The job feed arrives in Phase 2. Phase 1 is the data pipeline and admin console.</p>
      <div className="mt-8 flex gap-3">
        <Button asChild><Link href="/admin">Admin console</Link></Button>
        <Button asChild variant="outline"><Link href="/takedown">Employer takedown request</Link></Button>
      </div>
    </main>
  );
}
