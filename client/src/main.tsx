import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

// No Manus login required — this app is fully public.
// All tRPC routes use publicProcedure; no auth redirects.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition(op) {
        // Mutations and the authentication bootstrap use a dedicated request.
        // `mobileAuth.me` must never wait behind slow broker/account/quote calls
        // in the dashboard's normal query batch.
        return op.type === "mutation" || op.path === "mobileAuth.me";
      },
      true: httpLink({
        url: "/api/trpc",
        transformer: superjson,
        headers() {
          const token = localStorage.getItem("scalpbot_auth_token");
          return token ? { authorization: `Bearer ${token}` } : {};
        },
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
      false: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        // Prevent large mount-time batches from creating head-of-line blocking.
        // Four procedures keeps request count bounded without coupling the full
        // dashboard to the slowest upstream broker call.
        maxItems: 4,
        headers() {
          const token = localStorage.getItem("scalpbot_auth_token");
          return token ? { authorization: `Bearer ${token}` } : {};
        },
        fetch(input, init) {
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
