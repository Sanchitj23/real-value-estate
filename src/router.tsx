import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Results change only when staff run jobs, so a page revisited within a minute reuses what it already has.
  const queryClient = new QueryClient({ defaultOptions: { queries: { throwOnError: true, retry: 1, staleTime: 60_000 } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
