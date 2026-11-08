import { SiteHeader } from "@/components/site-header";

export const metadata = { title: "Privacy notice · Job Radar" };
export const dynamic = "force-dynamic"; // header shows your session

export default function Privacy() {
  const grievance = process.env.GRIEVANCE_EMAIL || "privacy@jobradar.example";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 text-[15px] leading-relaxed">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy notice</h1>
        <p className="mt-1 text-sm text-muted-foreground">Version 2026-11-08. Written for the Digital Personal Data Protection Act, 2023 (India).</p>
        <h2 className="mt-8 text-lg font-semibold">What we collect</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Account: your email address and, if you use Google sign-in, your name.</li>
          <li>Resume: the PDF you upload, stored encrypted.</li>
          <li>Profile details read from it and checked by you: skills, work experience, education, graduation year and projects.</li>
          <li>Preferences: cities, remote, roles, minimum pay and company types to hide.</li>
          <li>Activity: jobs you hide, open, or report as broken.</li>
        </ul>
        <h2 className="mt-8 text-lg font-semibold">Why</h2>
        <p className="mt-2">Only to match you with verified job openings, to keep those links working, and to send alerts you turn on. We don&apos;t sell your data, show ads, or share your resume with employers.</p>
        <h2 className="mt-8 text-lg font-semibold">How we process it</h2>
        <p className="mt-2">Your resume is read and matched on our own servers. It is never sent to an outside AI service. Job postings are public and may be summarised with an AI service; your data is not part of that.</p>
        <h2 className="mt-8 text-lg font-semibold">How long we keep it</h2>
        <p className="mt-2">Until you withdraw consent or delete your account. Withdrawing consent deletes your resume and derived profile details. Deleting your account removes your resume, profile and matches immediately and your login within 7 days. Encrypted backups roll over within 14 days.</p>
        <h2 className="mt-8 text-lg font-semibold">Your rights</h2>
        <p className="mt-2">In Settings you can download your data, correct it, withdraw consent and delete your account at any time.</p>
        <h2 className="mt-8 text-lg font-semibold">Grievances</h2>
        <p className="mt-2">Write to our grievance officer at <a className="text-primary underline" href={`mailto:${grievance}`}>{grievance}</a>. We reply within 7 days. You may also approach the Data Protection Board of India.</p>
      </main>
    </>
  );
}
