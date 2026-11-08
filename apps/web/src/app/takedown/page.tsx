import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { SiteHeader } from "@/components/site-header";

export default async function Takedown({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <>
    <SiteHeader />
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-[26px] font-semibold tracking-tight">Employer takedown request</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We list openings from public careers pages, show only a short summary in our own words, and send applicants to your page to apply.
        If you would like us to stop listing your company or a specific job, tell us here. We act on requests within 2 working days.
      </p>
      {sent ? (
        <Card className="mt-6"><p>Thanks. We have your request and will reply by email.</p></Card>
      ) : (
        <form action="/api/takedown" method="post" className="mt-6 space-y-3">
          <div><Label htmlFor="n">Your name</Label><Input id="n" name="requesterName" required autoComplete="name" /></div>
          <div><Label htmlFor="e">Work email</Label><Input id="e" name="requesterEmail" type="email" required autoComplete="email" /></div>
          <div><Label htmlFor="c">Company</Label><Input id="c" name="company" required autoComplete="organization" /></div>
          <Label htmlFor="scope">Request</Label>
          <select id="scope" name="scope" className="h-11 w-full rounded-lg border bg-card px-3 text-sm" defaultValue="company">
            <option value="company">Stop listing all our jobs</option>
            <option value="job">Remove one job</option>
          </select>
          <div><Label htmlFor="u">Job URL <span className="font-normal text-muted-foreground">(if removing one job)</span></Label><Input id="u" name="jobUrl" type="url" /></div>
          <div><Label htmlFor="m">Anything else we should know</Label><Textarea id="m" name="message" /></div>
          <Button type="submit" size="lg">Send request</Button>
        </form>
      )}
    </main>
    </>
  );
}
