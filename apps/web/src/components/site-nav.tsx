"use client";
import { LayoutList, LogOut, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/feed", label: "Matches", icon: LayoutList },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavLinks({ admin }: { admin: boolean }) {
  const path = usePathname();
  return (
    <div className="hidden items-center gap-1 sm:flex">
      {[...LINKS, ...(admin ? [{ href: "/admin", label: "Admin", icon: Shield }] : [])].map(({ href, label }) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("inline-flex h-10 items-center rounded-lg px-3 text-sm transition-colors", active ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}

export function AccountMenu({ user }: { user: { email: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const initial = (user.name || user.email).trim()[0]?.toUpperCase() ?? "?";
  return (
    <div ref={ref} className="relative ml-1">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(!open)} className="grid size-11 cursor-pointer place-items-center rounded-full">
        <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{initial}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border bg-card p-1.5 shadow-lg shadow-black/5">
          <div className="px-3 py-2">
            {user.name && <p className="truncate text-sm font-medium">{user.name}</p>}
            <p className="truncate text-[13px] text-muted-foreground">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-muted"><Settings className="size-4" aria-hidden="true" />Settings</Link>
          <button
            role="menuitem"
            type="button"
            className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-muted"
            onClick={async () => {
              await authClient.signOut().catch(() => {});
              window.location.assign("/");
            }}
          >
            <LogOut className="size-4" aria-hidden="true" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Bottom tab bar on phones (thumb reach), hidden from sm up. */
export function MobileTabs() {
  const path = usePathname();
  if (path.startsWith("/onboarding")) return null; // no matches yet: keep the setup flow focused
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden">
      <div className="grid grid-cols-2">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = path === href || path.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs", active ? "font-medium text-primary" : "text-muted-foreground")}>
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
