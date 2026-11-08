import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/trpc/client";

export const metadata: Metadata = {
  title: "Job Radar",
  description: "Verified openings from company careers pages, for freshers and 0–2 years in India.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
