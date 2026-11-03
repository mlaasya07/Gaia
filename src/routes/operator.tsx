import { createFileRoute, redirect } from "@tanstack/react-router";

// The scenario desk moved to /scenarios. Keep the old address working.
export const Route = createFileRoute("/operator")({
  beforeLoad: () => {
    throw redirect({ to: "/scenarios" });
  },
});
