import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/env";

export async function createContext() {
  const session = await getSession().catch(() => null);
  return { db, session };
}
type Ctx = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Ctx>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
/** Any signed-in user. */
export const userProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !isAdminEmail(ctx.session.user.email)) throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});
