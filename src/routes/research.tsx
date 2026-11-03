import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import {
  AttentionPanel,
  BehaviourPanel,
  CaveatsPanel,
  ComparisonTable,
  EvidencePanel,
  FindingsPanel,
  PairedPanel,
  TrainingPanel,
} from "@/components/research/panels";
import { Button } from "@/components/ui/button";
import { deriveFindings, loadResearch, type ResearchData } from "@/lib/research";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Gaia - Research" },
      {
        name: "description",
        content:
          "How the learned four-agent LACD policy compares with baselines, what the agents attend to, and the real-dataset evidence behind them.",
      },
      { property: "og:title", content: "Gaia - Research" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ResearchPage,
});

function ResearchBody({ data }: { data: ResearchData }) {
  const keys = Object.keys(data.variants);
  const [key, setKey] = useState(keys.includes("real_data") ? "real_data" : (keys[0] ?? ""));
  const variant = data.variants[key];
  if (!variant)
    return <p className="text-sm text-muted-foreground">No trained variants were exported.</p>;
  return (
    <>
      <section className="gaia-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 className="text-sm font-semibold">Learned LACD policy</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Four role agents (scheduling, maintenance, energy, monitoring) pass learned attention
              messages and are trained together in the Python FactorySim. This is a research
              prototype evaluated offline. It is not the live twin on the Operations page, and real
              datasets only shape what each agent observes; they never supplied rewards.
            </p>
          </div>
          <div role="group" aria-label="Trained variant" className="flex gap-1">
            {keys.map((k) => (
              <Button
                key={k}
                size="sm"
                variant={k === key ? "default" : "outline"}
                aria-pressed={k === key}
                onClick={() => setKey(k)}
              >
                {data.variants[k]?.label ?? k}
              </Button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Checkpoint {variant.checkpoint.file}, {variant.checkpoint.training_episodes ?? "?"}{" "}
          training episodes, evaluated on seeds {data.meta.evaluation_seeds[0]} to{" "}
          {data.meta.evaluation_seeds[data.meta.evaluation_seeds.length - 1]}.
        </p>
      </section>
      <FindingsPanel findings={deriveFindings(variant)} />
      <ComparisonTable variant={variant} data={data} />
      <PairedPanel key={`paired-${key}`} variant={variant} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AttentionPanel key={`attn-${key}`} variant={variant} />
        <BehaviourPanel variant={variant} />
      </div>
      <TrainingPanel key={`train-${key}`} variant={variant} />
      <EvidencePanel data={data} />
      <CaveatsPanel data={data} />
    </>
  );
}

function ResearchPage() {
  const [data, setData] = useState<ResearchData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadResearch()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <AppShell subtitle="Research · learned agents vs baselines">
      <RoleGate need="research" what="The research dashboard">
        {error && (
          <p role="alert" className="gaia-panel p-4 text-sm">
            Could not load research data ({error}). Generate it with the backend:{" "}
            <code>cd backend && python -m gaia.export_research</code>
          </p>
        )}
        {!data && !error && <p className="text-sm text-muted-foreground">Loading research data</p>}
        {data && <ResearchBody data={data} />}
      </RoleGate>
    </AppShell>
  );
}
