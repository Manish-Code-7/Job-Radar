"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers/_app";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } }));
  const [trpcClient] = useState(() => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })] }));
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
