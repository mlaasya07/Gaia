import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import {
  AgentPanel,
  DecisionLog,
  ForecastPanel,
  KpiRow,
  LearningFeed,
  MachineGrid,
  NegotiationFeed,
  OverrideLog,
} from "@/components/dashboard/panels";
import { useSim } from "@/lib/SimProvider";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gaia - Operations" },
      {
        name: "description",
        content:
          "Live operations view of the Gaia factory twin: alerts, machine overrides, seven negotiating agents, their decisions and what they learned.",
      },
      { property: "og:title", content: "Gaia - Operations" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Operations,
});

function Operations() {
  const sim = useSim();
  const { world, latest } = sim;
  return (
    <AppShell subtitle="Operations · Factory 01 · live">
      <KpiRow latest={latest} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <MachineGrid />
          <ForecastPanel forecast={sim.latestForecast} history={world.history} />
          <NegotiationFeed decision={sim.decisions[0]} />
        </section>
        <section className="space-y-4">
          <AgentPanel agents={sim.agents} />
          <OverrideLog log={sim.eventLog} />
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DecisionLog decisions={sim.decisions} />
        <LearningFeed lessons={sim.learningLog} />
      </div>
    </AppShell>
  );
}
