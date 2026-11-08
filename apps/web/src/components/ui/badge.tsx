import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";
const badge = cva("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      ok: "bg-ok/15 text-ok",
      warn: "bg-warn/20 text-warn",
      bad: "bg-bad/15 text-bad",
      primary: "bg-primary/15 text-primary",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ className, tone, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
