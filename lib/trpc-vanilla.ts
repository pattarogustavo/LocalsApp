/**
 * Vanilla tRPC client — usable outside React components (e.g. Zustand stores).
 *
 * This creates a plain HTTP client that does NOT depend on React Query.
 * Use `trpcVanilla.cloudTrips.list.query()` etc. from anywhere.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/api";
import * as Auth from "@/lib/_core/auth";

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getApiBaseUrl()}/api/trpc`,
      transformer: superjson,
      async headers() {
        const token = await Auth.getSessionToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});
