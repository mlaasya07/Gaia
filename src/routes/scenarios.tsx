import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { ScenarioAnalyst } from "@/components/ScenarioAnalyst";
import { EventsPanel, WhatIfPanel } from "@/components/scenario/panels";
import { ScenarioLabPanel } from "@/components/scenario/ScenarioLabPanel";
import { SubmissionDesk } from "@/components/scenario/SubmissionDesk";
import { useSim } from "@/lib/SimProvider";

export const Route = createFileRoute("/scenarios")({
  head: () => ({
    meta: [
      { title: "Gaia - Scenario Desk" },
      {
        name: "description",
        content:
          "Inject disruptions, run what-if comparisons and sweep the agent collective across eight scenarios on the live Gaia factory twin.",
      },
      { property: "og:title", content: "Gaia - Scenario Desk" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ScenariosPage,
});

function ScenariosPage() {
  const sim = useSim();
  return (
    <AppShell subtitle="Scenario desk · test disruptions without touching the floor">
      <RoleGate need="scenarioDesk" what="The scenario desk">
        <ScenarioLabPanel />
        <div className="grid gap-4 lg:grid-cols-2">
          <EventsPanel />
          <WhatIfPanel />
        </div>
        <ScenarioAnalyst sim={sim} />
        <SubmissionDesk />
      </RoleGate>
    </AppShell>
  );
}
