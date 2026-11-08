import * as React from "react";
import { cn } from "@/lib/utils";
export function Card({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-lg border bg-card p-4 shadow-sm", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-sm font-medium text-muted-foreground", className)} {...p} />;
}
