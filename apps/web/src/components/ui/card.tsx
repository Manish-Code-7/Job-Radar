import * as React from "react";
import { cn } from "@/lib/utils";
export function Card({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border bg-card p-5", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-sm font-medium text-muted-foreground", className)} {...p} />;
}
