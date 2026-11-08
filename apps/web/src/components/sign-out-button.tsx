"use client";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="inline-flex h-11 cursor-pointer items-center rounded-lg px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        await authClient.signOut().catch(() => {});
        window.location.assign("/");
      }}
    >
      Sign out
    </button>
  );
}
