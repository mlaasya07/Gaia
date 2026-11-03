import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
});

describe("App routes", () => {
  const router = () => createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it.each(["/", "/scenarios", "/research", "/evidence"])("matches a page for %s", (pathname) => {
    expect(router().matchRoutes(pathname).at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("keeps the old /operator address as a redirect to the scenario desk", async () => {
    const r = router();
    await r.navigate({ to: "/operator" });
    expect(r.state.location.pathname).toBe("/scenarios");
  });
});
