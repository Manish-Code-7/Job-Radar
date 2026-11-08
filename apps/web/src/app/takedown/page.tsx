import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";

export default async function Takedown({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-semibold">Employer takedown request</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We list openings from public careers pages, show only a short summary in our own words, and send applicants to your page to apply.
        If you would like us to stop listing your company or a specific job, tell us here. We act on requests within 2 working days.
      </p>
      {sent ? (
        <Card className="mt-6"><p>Thanks. We have your request and will reply by email.</p></Card>
      ) : (
        <form action="/api/takedown" method="post" className="mt-6 space-y-3">
          <Input name="requesterName" placeholder="Your name" required />
          <Input name="requesterEmail" type="email" placeholder="Work email" required />
          <Input name="company" placeholder="Company" required />
          <select name="scope" className="h-9 w-full rounded-lg border bg-card px-3 text-sm" defaultValue="company">
            <option value="company">Stop listing all our jobs</option>
            <option value="job">Remove one job</option>
          </select>
          <Input name="jobUrl" type="url" placeholder="Job URL (if removing one job)" />
          <Textarea name="message" placeholder="Anything else we should know" />
          <Button type="submit">Send request</Button>
        </form>
      )}
    </main>
  );
}
