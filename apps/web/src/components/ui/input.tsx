import * as React from "react";
import { cn } from "@/lib/utils";
const base = "w-full rounded-lg border bg-card px-3 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/30";
export function Input({ className, ...p }: React.ComponentProps<"input">) {
  return <input className={cn(base, "h-11", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(base, "min-h-24 py-2.5", className)} {...p} />;
}
export function Label({ className, ...p }: React.ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-sm font-medium", className)} {...p} />;
}
export function Hint({ className, ...p }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1.5 text-[13px] text-muted-foreground", className)} {...p} />;
}
