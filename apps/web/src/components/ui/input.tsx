import * as React from "react";
import { cn } from "@/lib/utils";
export function Input({ className, ...p }: React.ComponentProps<"input">) {
  return <input className={cn("h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("min-h-24 w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary", className)} {...p} />;
}
