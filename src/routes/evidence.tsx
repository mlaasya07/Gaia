import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/evidence")({
  head: () => ({
    meta: [
      { title: "Gaia - Evaluation Evidence" },
      {
        name: "description",
        content:
          "Held-out evaluation of LACD agents against baselines, exported from the Gaia Python backend.",
      },
    ],
  }),
  component: EvidencePage,
});

interface PolicyRow {
  condition: string;
  policy: string;
  reward_mean: number;
  reward_std: number;
  throughput_mean: number;
  peak_step_energy_mean: number;
  max_step_carbon_mean: number;
  downtime_mean: number;
}
interface Paired {
  condition: string;
  a: string;
  b: string;
  metric: string;
  mean_diff: number;
  ci95_lo: number;
  ci95_hi: number;
  significant: boolean;
}
interface AgentWeights {
  id: string;
  weights: Record<string, number>;
  influence: number;
}
interface Evidence {
  meta: {
    episodes: number;
    pretrain_episodes: number;
    horizon: number;
    eval_seeds: number[];
    pretrain_seeds: number[];
  };
  policies: PolicyRow[];
  paired: Paired[];
  pretrained_agents: AgentWeights[];
  zema_health_prior: { n_cycles: number; mean: number; p05: number; p50: number; p95: number };
  zema_classifier_test: Record<string, { accuracy: number; macro_f1: number }>;
  caveats: string[];
}

const f = (v: number, d = 3) => v.toFixed(d);
const FOCUS: [string, string][] = [
  ["LACD_pretrained_online", "B1_centralized"],
  ["LACD_pretrained_online", "Centralized_MPC_safe"],
  ["LACD_pretrained_online", "LACD_static"],
];

function EvidencePage() {
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/evidence.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Evidence) => setData(j))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <AppShell subtitle="Evidence · held-out evaluation of the LACD agents">
      <div className="mx-auto max-w-[1100px] space-y-6">
        {error && (
          <p className="rounded-md border border-border bg-card p-4 text-sm">
            Could not load evidence ({error}). Generate it with the backend:{" "}
            <code>
              cd backend && python -m gaia.lacd.experiment --export-frontend
              ../public/data/evidence.json
            </code>
          </p>
        )}
        {!data && !error && <p className="text-sm text-muted-foreground">Loading evidence</p>}
        {data && <EvidenceBody d={data} />}
      </div>
    </AppShell>
  );
}

function EvidenceBody({ d }: { d: Evidence }) {
  const conditions = Array.from(new Set(d.policies.map((p) => p.condition)));
  return (
    <>
      <section className="rounded-md border border-border bg-card p-4 text-sm">
        <p>
          {d.meta.episodes} held-out episodes per policy (seeds {d.meta.eval_seeds[0]} to{" "}
          {d.meta.eval_seeds[1]}), horizon {d.meta.horizon} steps, identical environments across
          policies. Agents pretrained on {d.meta.pretrain_episodes} separate episodes.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {d.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      {conditions.map((cond) => (
        <section key={cond} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Condition: {cond}</h2>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Policy</th>
                  <th className="p-2">Reward (mean, std)</th>
                  <th className="p-2">Throughput</th>
                  <th className="p-2">Peak energy per step</th>
                  <th className="p-2">Max carbon per step</th>
                </tr>
              </thead>
              <tbody>
                {d.policies
                  .filter((p) => p.condition === cond)
                  .map((p) => (
                    <tr key={p.policy} className="border-t border-border">
                      <td className="p-2 font-medium">{p.policy}</td>
                      <td className="p-2 tabular-nums">
                        {f(p.reward_mean)} ({f(p.reward_std)})
                      </td>
                      <td className="p-2 tabular-nums">{f(p.throughput_mean)}</td>
                      <td className="p-2 tabular-nums">{f(p.peak_step_energy_mean)}</td>
                      <td className="p-2 tabular-nums">{f(p.max_step_carbon_mean)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Paired difference (a minus b)</th>
                  <th className="p-2">Metric</th>
                  <th className="p-2">Mean diff</th>
                  <th className="p-2">95% bootstrap CI</th>
                </tr>
              </thead>
              <tbody>
                {d.paired
                  .filter(
                    (p) =>
                      p.condition === cond &&
                      ["reward", "peak_step_energy", "max_step_carbon"].includes(p.metric),
                  )
                  .filter((p) => FOCUS.some(([a, b]) => a === p.a && b === p.b))
                  .map((p) => (
                    <tr key={`${p.a}-${p.b}-${p.metric}`} className="border-t border-border">
                      <td className="p-2">
                        {p.a} vs {p.b}
                      </td>
                      <td className="p-2">{p.metric}</td>
                      <td className="p-2 tabular-nums">{f(p.mean_diff, 4)}</td>
                      <td className="p-2 tabular-nums">
                        [{f(p.ci95_lo, 4)}, {f(p.ci95_hi, 4)}] {p.significant ? "" : "(includes 0)"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Real-data grounding (ZeMA hydraulic rig)
        </h2>
        <p className="text-sm text-muted-foreground">
          Maintenance classifiers are trained on the real ZeMA dataset. The zema_prior condition
          samples starting machine health from its labels ({d.zema_health_prior.n_cycles} cycles,
          mean composite health {f(d.zema_health_prior.mean, 2)}).
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(d.zema_classifier_test).map(([t, m]) => (
            <div key={t} className="rounded-md border border-border bg-card p-3 text-sm">
              <div className="font-medium">{t}</div>
              <div className="tabular-nums text-muted-foreground">
                test accuracy {f(m.accuracy)}, macro F1 {f(m.macro_f1)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Pretrained agent weights (largest three per agent)
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.pretrained_agents.map((a) => (
            <div key={a.id} className="rounded-md border border-border bg-card p-3 text-sm">
              <div className="font-medium">
                {a.id} <span className="text-muted-foreground">influence {f(a.influence, 2)}</span>
              </div>
              <div className="tabular-nums text-muted-foreground">
                {Object.entries(a.weights)
                  .sort((x, y) => y[1] - x[1])
                  .slice(0, 3)
                  .map(([k, v]) => `${k} ${f(v, 2)}`)
                  .join(", ")}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
