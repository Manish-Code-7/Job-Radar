import { router } from "../trpc";
import { adminRouter } from "./admin";
import { meRouter } from "./me";
export const appRouter = router({ admin: adminRouter, me: meRouter });
export type AppRouter = typeof appRouter;
