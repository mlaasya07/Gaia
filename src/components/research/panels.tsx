import { useMemo, useState } from "react";

import {
  BASELINE_LABEL,
  LEARNED,
  METRIC_LABEL,
  attentionDeviation,
  bestPolicy,
  formatShare,
  type EvidenceRow,
  type Finding,
  type FindingLevel,
  type MetricKey,
  type ResearchData,
  type Variant,
} from "@/lib/research";

const LEVEL_STYLE: Record<FindingLevel, { box: string; tag: string; label: string }> = {
  concern: { box: "border-chart-4/70 bg-chart-4/10", tag: "text-chart-4", label: "Concern" },
  note: { box: "border-border bg-background", tag: "text-muted-foreground", label: "Note" },
  positive: { box: "border-primary/50 bg-primary/5", tag: "text-primary", label: "In its favour" },
};

export function FindingsPanel({ findings }: { findings: Finding[] }) {
  return (
    <section aria-label="Findings" className="gaia-panel p-4">
      <h2 className="text-sm font-semibold">What the data says</h2>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Computed from the exported numbers below, so they update if the policy is retrained and
        re-exported.
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {findings.map((f) => {
          const s = LEVEL_STYLE[f.level];
          return (
            <li
              key={f.id}
              data-testid={`finding-${f.id}`}
              className={`rounded-md border-l-4 px-3 py-2 text-xs ${s.box}`}
            >
              <p className={`text-[10px] font-semibold uppercase ${s.tag}`}>{s.label}</p>
              <p className="mt-0.5 font-medium text-foreground">{f.title}</p>
              <p className="mt-0.5 text-muted-foreground">{f.detail}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const POLICY_ORDER = ["B1_centralized", "B2_independent", "B3_rule_based_coordination", LEARNED];
const POLICY_LABEL: Record<string, string> = { ...BASELINE_LABEL, [LEARNED]: "Learned LACD" };

export function ComparisonTable({ variant, data }: { variant: Variant; data: ResearchData }) {
  const metrics = data.meta.metrics;
  const names = POLICY_ORDER.filter((n) => variant.policies[n]);
  const best = useMemo(
    () =>
      Object.fromEntries(
        metrics.map((m) => [m, bestPolicy(variant.policies, m, data.meta.higher_is_better[m])]),
      ),
    [variant, data, metrics],
  );
  const n = variant.policies[LEARNED]?.n_episodes ?? 0;
  return (
    <section className="gaia-panel p-4">
      <h2 className="text-sm font-semibold">Policy comparison</h2>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Mean ± standard deviation over {n} evaluation episodes on identical seeds. The best policy
        per column is highlighted. Lower is better for every metric except reward and throughput.
      </p>
      <div className="overflow-x-auto">
        <table data-testid="comparison-table" className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Policy</th>
              {metrics.map((m) => (
                <th key={m} className="py-2 pr-3 font-medium">
                  {METRIC_LABEL[m]} {data.meta.higher_is_better[m] ? "↑" : "↓"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((name) => (
              <tr
                key={name}
                className={`border-b border-border/60 ${name === LEARNED ? "bg-primary/5" : ""}`}
              >
                <td className="py-2 pr-3 font-medium">{POLICY_LABEL[name] ?? name}</td>
                {metrics.map((m) => {
                  const s = variant.policies[name]![m];
                  return (
                    <td
                      key={m}
                      className={`py-2 pr-3 tabular-nums ${best[m] === name ? "font-semibold text-primary" : ""}`}
                    >
                      {s.mean.toFixed(3)}{" "}
                      <span className="text-muted-foreground">±{s.std.toFixed(3)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PairedPanel({ variant }: { variant: Variant }) {
  const baselines = Array.from(new Set(variant.paired_vs_baselines.map((r) => r.baseline)));
  const [baseline, setBaseline] = useState(baselines[0] ?? "");
  const rows = variant.paired_vs_baselines.filter((r) => r.baseline === baseline);
  return (
    <section className="gaia-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Seed-by-seed: where the learned policy wins</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            For each metric, the share of paired seeds where the learned policy did better than the
            chosen baseline. The line marks 50%.
          </p>
        </div>
        <select
          aria-label="Compare against"
          value={baseline}
          onChange={(e) => setBaseline(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          {baselines.map((b) => (
            <option key={b} value={b}>
              vs {BASELINE_LABEL[b] ?? b}
            </option>
          ))}
        </select>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const share = r.n ? r.learned_better_in / r.n : 0;
          return (
            <li
              key={r.metric}
              data-testid={`paired-${r.metric}`}
              className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-xs"
            >
              <span>{METRIC_LABEL[r.metric]}</span>
              <div
                className="relative h-3 overflow-hidden rounded bg-muted"
                role="img"
                aria-label={`${METRIC_LABEL[r.metric]}: learned policy better in ${r.learned_better_in} of ${r.n} seeds`}
              >
                <div className="h-full bg-primary" style={{ width: `${share * 100}%` }} />
                <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/60" />
              </div>
              <span className="w-44 text-right tabular-nums text-muted-foreground">
                {formatShare(r.learned_better_in, r.n)} · Δ {r.mean_diff >= 0 ? "+" : ""}
                {r.mean_diff.toFixed(3)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TrainingPanel({ variant }: { variant: Variant }) {
  const curve = variant.training_curve;
  const columns = curve.length ? Object.keys(curve[0]!).filter((k) => k !== "episode") : [];
  const [col, setCol] = useState(
    columns.includes("mean_reward") ? "mean_reward" : (columns[0] ?? ""),
  );
  const values = curve.map((p) => p[col] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const W = 100;
  const H = 120;
  const pts = values
    .map(
      (v, i) =>
        `${(i / Math.max(1, values.length - 1)) * W},${H - 6 - ((v - min) / span) * (H - 12)}`,
    )
    .join(" ");
  const last = curve[curve.length - 1]?.episode ?? 0;
  return (
    <section className="gaia-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Training curve</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Averaged into {curve.length} points over {last} training episodes (
            {variant.checkpoint.training_episodes ?? "?"} configured).
          </p>
        </div>
        <select
          aria-label="Training series"
          value={col}
          onChange={(e) => setCol(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          {columns.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      {values.length > 1 ? (
        <>
          <svg
            role="img"
            aria-label={`Training curve for ${col.replace(/_/g, " ")}`}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="mt-3 w-full"
            style={{ height: H }}
          >
            <polyline
              points={pts}
              fill="none"
              className="stroke-primary"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <p className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>start {values[0]!.toFixed(3)}</span>
            <span>
              min {min.toFixed(3)} · max {max.toFixed(3)}
            </span>
            <span>end {values[values.length - 1]!.toFixed(3)}</span>
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No training log available.</p>
      )}
    </section>
  );
}

export function AttentionPanel({ variant }: { variant: Variant }) {
  const a = variant.attention;
  const [head, setHead] = useState<number | "mean">("mean");
  if (!a) {
    return (
      <section className="gaia-panel p-4">
        <h2 className="text-sm font-semibold">Who listens to whom</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          {variant.note ?? "Attention is unavailable for this checkpoint."}
        </p>
      </section>
    );
  }
  const matrix = head === "mean" ? a.mean : (a.per_head[head] ?? a.mean);
  const { max, uniform } = attentionDeviation(a.mean);
  return (
    <section className="gaia-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Who listens to whom</h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Attention each agent (row) gives to each teammate (column), averaged over every step of
            every evaluation episode. Shading is on a fixed 0 to 1 scale, so uniform attention (
            {uniform.toFixed(2)} everywhere) looks flat.
          </p>
        </div>
        <select
          aria-label="Attention head"
          value={String(head)}
          onChange={(e) => setHead(e.target.value === "mean" ? "mean" : Number(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="mean">All heads (mean)</option>
          {a.per_head.map((_, i) => (
            <option key={i} value={i}>
              Head {i + 1}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table data-testid="attention-heatmap" className="text-xs">
          <thead>
            <tr>
              <th />
              {a.agents.map((name) => (
                <th key={name} className="px-2 pb-1 text-left font-medium text-muted-foreground">
                  {name.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={a.agents[i]}>
                <th className="pr-2 text-left font-medium text-muted-foreground">
                  {a.agents[i]?.replace(/_/g, " ")}
                </th>
                {row.map((v, j) => (
                  <td key={j} className="p-0.5">
                    <div
                      className="flex h-12 w-24 items-center justify-center rounded tabular-nums"
                      style={{
                        backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(v * 100)}%, transparent)`,
                      }}
                    >
                      {v.toFixed(3)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p data-testid="attention-summary" className="mt-2 text-[11px] text-muted-foreground">
        Largest deviation from uniform across the mean matrix: {max.toFixed(3)}.
      </p>
    </section>
  );
}

function RateBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <li className="grid grid-cols-[170px_1fr_52px] items-center gap-3 text-xs" title={hint}>
      <span>{label}</span>
      <div className="h-2.5 overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        />
      </div>
      <span className="text-right tabular-nums text-muted-foreground">
        {(value * 100).toFixed(0)}%
      </span>
    </li>
  );
}

export function BehaviourPanel({ variant }: { variant: Variant }) {
  const b = variant.behaviour;
  const steps = variant.attention?.sample_episode?.steps ?? [];
  if (!b) return null;
  const rows: { label: string; get: (s: (typeof steps)[number]) => number }[] = [
    { label: "Maintenance", get: (s) => s.action.maintenance },
    { label: "Cloud offload", get: (s) => s.action.cloud },
    { label: "Shift", get: (s) => s.action.shift },
  ];
  return (
    <section className="gaia-panel p-4">
      <h2 className="text-sm font-semibold">What the policy actually does</h2>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        How often each action was chosen across {b.steps} evaluation steps, after the safety layer.
      </p>
      <ul className="space-y-2" data-testid="behaviour-rates">
        <RateBar label="Maintenance on" value={b.maintenance_rate} />
        <RateBar label="Cloud offload on" value={b.cloud_rate} />
        <RateBar label="Shift on" value={b.shift_rate} />
        <RateBar label="Mean production level" value={b.production_mean} />
        <RateBar
          label="Safety forced maintenance"
          value={b.safety_forced_maintenance_rate}
          hint="Share of steps where the safety layer switched maintenance on"
        />
        <RateBar
          label="Safety capped production"
          value={b.safety_production_capped_rate}
          hint="Share of steps where the safety layer lowered production"
        />
      </ul>
      {steps.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[11px] text-muted-foreground">
            One episode (seed {variant.attention?.sample_episode?.seed}), one cell per step. Filled
            means on.
          </p>
          <div className="space-y-1">
            {rows.map((r) => (
              <div
                key={r.label}
                className="grid grid-cols-[100px_1fr] items-center gap-2 text-[10px] text-muted-foreground"
              >
                <span>{r.label}</span>
                <div className="flex gap-px">
                  {steps.map((s) => (
                    <span
                      key={s.t}
                      className={`h-3 flex-1 ${r.get(s) >= 0.5 ? "bg-primary" : "bg-muted"}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function shorten(v: string, n = 70) {
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

export function EvidencePanel({ data }: { data: ResearchData }) {
  const byAgent = useMemo(() => {
    const map = new Map<string, EvidenceRow[]>();
    for (const r of data.evidence.rows) map.set(r.agent, [...(map.get(r.agent) ?? []), r]);
    return [...map.entries()];
  }, [data]);
  return (
    <section className="gaia-panel p-4">
      <h2 className="text-sm font-semibold">Real-dataset evidence given to each agent</h2>
      <p className="mb-3 mt-1 max-w-3xl text-xs text-muted-foreground">
        {data.evidence.integration_boundary}
      </p>
      <div className="space-y-4">
        {byAgent.map(([agent, rows]) => (
          <div key={agent}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide">
              {agent.replace(/_/g, " ")} agent
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-3 font-medium">Dataset</th>
                    <th className="py-1.5 pr-3 font-medium">Signal</th>
                    <th className="py-1.5 pr-3 font-medium">Value</th>
                    <th className="py-1.5 pr-3 font-medium">Records</th>
                    <th className="py-1.5 font-medium">Limitation</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.dataset}-${r.signal}`}
                      className="border-b border-border/60 align-top"
                    >
                      <td className="py-1.5 pr-3">{r.dataset}</td>
                      <td className="py-1.5 pr-3">{r.signal.replace(/_/g, " ")}</td>
                      <td className="py-1.5 pr-3 tabular-nums" title={r.value}>
                        {shorten(r.value)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{r.records ?? "n/a"}</td>
                      <td className="py-1.5 text-muted-foreground">{r.limitation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CaveatsPanel({ data }: { data: ResearchData }) {
  const checks = Object.entries(data.meta.reproduction_check);
  return (
    <section className="gaia-panel p-4">
      <h2 className="text-sm font-semibold">Limits and reproducibility</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {data.caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {checks.map(([key, c]) => (
        <p
          key={key}
          data-testid="reproduction-check"
          className="mt-3 text-[11px] text-muted-foreground"
        >
          Reproduction check ({data.variants[key]?.label ?? key}): re-running the checkpoint on{" "}
          {c.episodes} saved seeds differs from the saved evaluation by at most{" "}
          {c.max_abs_diff_vs_saved_csv["reward"]?.toFixed(6)} reward.
        </p>
      ))}
    </section>
  );
}

export type { MetricKey };
