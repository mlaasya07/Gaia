// Types and analysis for public/data/research.json, produced by
// backend/gaia/export_research.py. The page only reads that file (see ARCHITECTURE.md).

export interface MetricStat {
  mean: number;
  std: number;
}

export type MetricKey =
  "reward" | "energy" | "energy_cost" | "carbon" | "throughput" | "latency" | "health_risk_proxy";

export type PolicyStats = Record<MetricKey, MetricStat> & { n_episodes: number };

export interface PairedRow {
  baseline: string;
  metric: MetricKey;
  higher_is_better: boolean;
  mean_diff: number;
  std_diff: number;
  n: number;
  learned_better_in: number;
}

export interface TrainingPoint {
  episode: number;
  [column: string]: number;
}

export interface SampleStep {
  t: number;
  state: number[];
  reward: number;
  value: number;
  action: { production: number; maintenance: number; cloud: number; shift: number };
  safety_override: boolean;
  attention: number[][];
}

export interface AttentionData {
  agents: string[];
  layout: string;
  mean: number[][];
  per_head: number[][][];
  sample_episode: { seed: number; horizon: number; steps: SampleStep[] } | null;
}

export interface Behaviour {
  steps: number;
  production_mean: number;
  maintenance_rate: number;
  cloud_rate: number;
  shift_rate: number;
  safety_forced_maintenance_rate: number;
  safety_production_capped_rate: number;
}

export interface Variant {
  label: string;
  rerun_available: boolean;
  note: string | null;
  checkpoint: {
    file: string;
    algorithm: string | null;
    training_episodes: number | null;
    training_seed: number | null;
    input_design: string | null;
  };
  policies: Record<string, PolicyStats>;
  paired_vs_baselines: PairedRow[];
  training_curve: TrainingPoint[];
  attention: AttentionData | null;
  behaviour: Behaviour | null;
}

export interface EvidenceRow {
  dataset: string;
  agent: string;
  signal: string;
  value: string;
  unit: string;
  records: number | null;
  interpretation: string;
  limitation: string;
}

export interface ResearchData {
  meta: {
    generated_by: string;
    agents: string[];
    evaluation_seeds: number[];
    horizon: number;
    metrics: MetricKey[];
    higher_is_better: Record<MetricKey, boolean>;
    reproduction_check: Record<
      string,
      { episodes: number; max_abs_diff_vs_saved_csv: Record<string, number> }
    >;
  };
  variants: Record<string, Variant>;
  evidence: {
    rows: EvidenceRow[];
    policy_input_vectors: { layout: string; agents: string[]; values: number[][] };
    integration_boundary: string;
  };
  caveats: string[];
}

export const METRIC_LABEL: Record<MetricKey, string> = {
  reward: "Reward",
  energy: "Energy",
  energy_cost: "Energy cost",
  carbon: "Carbon",
  throughput: "Throughput",
  latency: "Latency",
  health_risk_proxy: "Health risk",
};

export const LEARNED = "LACD_learned";
export const BASELINE_LABEL: Record<string, string> = {
  B1_centralized: "Centralized",
  B2_independent: "Independent agents",
  B3_rule_based_coordination: "Rule-based coordination",
};

export type FindingLevel = "concern" | "note" | "positive";
export interface Finding {
  id: string;
  level: FindingLevel;
  title: string;
  detail: string;
}

/** A binary action counts as constant when it is on (or off) in at least this share of steps. */
export const CONSTANT_ACTION_SHARE = 0.98;
/** Attention within this distance of uniform everywhere is treated as "not selective". */
export const UNIFORM_ATTENTION_TOLERANCE = 0.05;

export function attentionDeviation(mean: number[][]): { max: number; uniform: number } {
  const n = mean[0]?.length ?? 0; // columns: how many agents each row's weights are spread over
  const uniform = n ? 1 / n : 0;
  let max = 0;
  for (const row of mean) for (const v of row) max = Math.max(max, Math.abs(v - uniform));
  return { max, uniform };
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/**
 * Plain-language findings computed from the exported numbers. Nothing here is hard-coded
 * to a particular result: re-export after retraining and the findings change with the data.
 */
export function deriveFindings(v: Variant): Finding[] {
  const out: Finding[] = [];
  const vs = (baseline: string, metric: MetricKey) =>
    v.paired_vs_baselines.find((r) => r.baseline === baseline && r.metric === metric);

  // 1. Reward against the centralized baseline.
  const reward = vs("B1_centralized", "reward");
  if (reward) {
    const share = reward.learned_better_in / reward.n;
    if (share < 0.5) {
      out.push({
        id: "reward-behind",
        level: "concern",
        title: "Does not beat the centralized baseline on reward",
        detail: `Higher reward in ${reward.learned_better_in} of ${reward.n} paired seeds (mean difference ${reward.mean_diff.toFixed(3)}). Reward is the quantity the policy was trained on.`,
      });
    } else {
      out.push({
        id: "reward-ahead",
        level: "positive",
        title: "Beats the centralized baseline on reward",
        detail: `Higher reward in ${reward.learned_better_in} of ${reward.n} paired seeds.`,
      });
    }
  }

  // 2. Metrics where it is consistently better or worse than the centralized baseline.
  const b1 = v.paired_vs_baselines.filter(
    (r) => r.baseline === "B1_centralized" && r.metric !== "reward",
  );
  const better = b1
    .filter((r) => r.learned_better_in / r.n >= 0.9)
    .map((r) => METRIC_LABEL[r.metric].toLowerCase());
  const worse = b1
    .filter((r) => r.learned_better_in === 0)
    .map((r) => METRIC_LABEL[r.metric].toLowerCase());
  if (better.length) {
    out.push({
      id: "consistent-wins",
      level: "positive",
      title: `Consistently better on ${better.join(", ")}`,
      detail:
        "Better than the centralized baseline in at least 90% of paired seeds on each of these. These are simulator proxies, not measurements.",
    });
  }
  if (worse.length) {
    out.push({
      id: "consistent-losses",
      level: "concern",
      title: `Consistently worse on ${worse.join(", ")}`,
      detail: "Worse than the centralized baseline in every paired seed on each of these.",
    });
  }

  // 3. Is the policy actually making varied decisions?
  const b = v.behaviour;
  if (b) {
    const constants: string[] = [];
    const rates: [string, number][] = [
      ["maintenance", b.maintenance_rate],
      ["cloud offload", b.cloud_rate],
      ["shift", b.shift_rate],
    ];
    for (const [name, rate] of rates) {
      if (rate >= CONSTANT_ACTION_SHARE) constants.push(`${name} always on`);
      else if (rate <= 1 - CONSTANT_ACTION_SHARE) constants.push(`${name} always off`);
    }
    if (constants.length >= 2) {
      out.push({
        id: "near-constant-policy",
        level: "concern",
        title: "The learned policy is nearly constant",
        detail: `Across ${b.steps} steps it chose: ${constants.join(", ")}. Only the production level varies (mean ${b.production_mean.toFixed(2)}). Its low health risk follows from always maintaining, not from adapting to conditions.`,
      });
    }
    if (b.safety_forced_maintenance_rate === 0 && b.safety_production_capped_rate === 0) {
      out.push({
        id: "safety-idle",
        level: "note",
        title: "The safety layer never had to step in",
        detail:
          "The projection that forces maintenance at low health was never triggered in this evaluation.",
      });
    }
  }

  // 4. Do the agents attend to each other selectively?
  const a = v.attention;
  if (a) {
    const { max, uniform } = attentionDeviation(a.mean);
    if (max < UNIFORM_ATTENTION_TOLERANCE) {
      out.push({
        id: "uniform-attention",
        level: "concern",
        title: "Attention between agents is close to uniform",
        detail: `Every attention weight is within ${max.toFixed(3)} of ${uniform.toFixed(2)}, so there is no evidence the agents listen to some teammates more than others.`,
      });
    } else {
      out.push({
        id: "selective-attention",
        level: "positive",
        title: "Agents attend to teammates selectively",
        detail: `The largest weight differs from uniform (${uniform.toFixed(2)}) by ${max.toFixed(3)}.`,
      });
    }
  }

  if (!v.rerun_available) {
    out.push({
      id: "no-rerun",
      level: "note",
      title: "Attention and behaviour are unavailable for this checkpoint",
      detail: v.note ?? "The checkpoint could not be re-run with the current policy code.",
    });
  }
  return out;
}

/** Index of the best (lowest or highest, per metric) policy for a metric. */
export function bestPolicy(
  policies: Record<string, PolicyStats>,
  metric: MetricKey,
  higherIsBetter: boolean,
): string | null {
  const names = Object.keys(policies);
  if (!names.length) return null;
  return names.reduce((best, n) => {
    const a = policies[n]![metric].mean;
    const b = policies[best]![metric].mean;
    return (higherIsBetter ? a > b : a < b) ? n : best;
  }, names[0]!);
}

export function formatShare(better: number, n: number): string {
  return `${better}/${n} (${pct(n ? better / n : 0)})`;
}

/** Loads /data/research.json. Kept separate so tests can inject a fetch. */
export async function loadResearch(fetchImpl: typeof fetch = fetch): Promise<ResearchData> {
  const res = await fetchImpl("/data/research.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ResearchData;
}
