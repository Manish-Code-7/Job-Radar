import { neonAuth } from "@/lib/auth";

// Proxies /api/auth/* to Neon Auth (Managed Better Auth) for this branch.
type Handler = ReturnType<ReturnType<typeof neonAuth>["handler"]>;
const h = (m: keyof Handler) => (req: Request, ctx: { params: Promise<{ path: string[] }> }) =>
  (neonAuth().handler()[m] as (r: Request, c: unknown) => Promise<Response>)(req, ctx);

export const GET = h("GET");
export const POST = h("POST");
export const PUT = h("PUT");
export const DELETE = h("DELETE");
export const PATCH = h("PATCH");
