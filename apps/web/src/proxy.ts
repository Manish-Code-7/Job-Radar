import type { NextRequest } from "next/server";
import { neonAuth } from "@/lib/auth";

// Next 16 proxy (formerly middleware): signed-out visitors to /admin go to sign-in.
// The admin layout and every admin API still check the session and ADMIN_EMAILS themselves.
let mw: ((request: NextRequest) => ReturnType<ReturnType<ReturnType<typeof neonAuth>["middleware"]>>) | undefined;

export default function proxy(req: NextRequest) {
  mw ??= neonAuth().middleware({ loginUrl: "/sign-in" });
  return mw(req);
}

export const config = { matcher: ["/admin/:path*"] };
