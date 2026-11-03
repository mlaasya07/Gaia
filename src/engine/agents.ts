// LACD agents: objectives, learnable utility weights, trust, and proposal generation.
import { HORIZON, describeAction, type Action, type World } from "./twin";
import {
  correctSummary,
  forecast,
  rollout,
  type Forecast,
  type Summary,
  type WorldModel,
} from "./worldModel";

export type AgentId =
  "energy" | "carbon" | "maintenance" | "production" | "orchestration" | "quality" | "safety";
export const AGENT_IDS: AgentId[] = [
  "energy",
  "carbon",
  "maintenance",
  "production",
  "orchestration",
  "quality",
  "safety",
];
export const METRICS = [
  "kwh",
  "cost",
  "carbonKg",
  "downtime",
  "healthDeficit",
  "missed",
  "throughput",
  "latency",
  "defects",
  "safetyRisk",
] as const;
export type MetricKey = (typeof METRICS)[number];

export const METRIC_LABEL: Record<MetricKey, string> = {
  kwh: "energy",
  cost: "energy cost",
  carbonKg: "emissions",
  downtime: "downtime",
  healthDeficit: "machine wear",
  missed: "missed deadlines",
  throughput: "throughput",
  latency: "latency",
  defects: "quality risk",
  safetyRisk: "safety risk",
};

export interface Agent {
  id: AgentId;
  name: string;
  short: string;
  goal: string;
  primary: MetricKey[];
  weights: Record<MetricKey, number>;
  trust: Record<AgentId, number>;
  influence: number;
  rewardHistory: number[];
  accuracyHistory: number[];
}

function w(over: Partial<Record<MetricKey, number>>): Record<MetricKey, number> {
  const base = {} as Record<MetricKey, number>;
  for (const k of METRICS) base[k] = over[k] ?? 0.05;
  return base;
}

export function createAgents(): Agent[] {
  const defs: Omit<Agent, "trust" | "influence" | "rewardHistory" | "accuracyHistory">[] = [
    {
      id: "energy",
      name: "Energy Agent",
      short: "EN",
      goal: "Minimize kWh and cost",
      primary: ["kwh", "cost"],
      weights: w({ kwh: 1, cost: 0.8 }),
    },
    {
      id: "carbon",
      name: "Carbon Agent",
      short: "CO",
      goal: "Minimize emissions, shift flexible load to clean windows",
      primary: ["carbonKg"],
      weights: w({ carbonKg: 1.2 }),
    },
    {
      id: "maintenance",
      name: "Maintenance Agent",
      short: "MA",
      goal: "Maximize machine health, service before failure",
      primary: ["downtime", "healthDeficit"],
      weights: w({ downtime: 1, healthDeficit: 0.7 }),
    },
    {
      id: "production",
      name: "Production Agent",
      short: "PR",
      goal: "Maximize throughput and on-time jobs",
      primary: ["missed", "throughput"],
      weights: w({ missed: 1.2, throughput: 0.6 }),
    },
    {
      id: "orchestration",
      name: "Orchestration Agent",
      short: "OR",
      goal: "Place compute on edge or cloud for latency, energy, carbon",
      primary: ["latency"],
      weights: w({ latency: 1, kwh: 0.2, carbonKg: 0.2 }),
    },
    {
      id: "quality",
      name: "Quality Agent",
      short: "QA",
      goal: "Keep output in spec: watch wear, heat and rush boosts",
      primary: ["defects"],
      weights: w({ defects: 1.2, throughput: 0.25 }),
    },
    {
      id: "safety",
      name: "Safety Agent",
      short: "SF",
      goal: "Prevent thermal and failure hazards before they escalate",
      primary: ["safetyRisk", "healthDeficit"],
      weights: w({ safetyRisk: 1.2, healthDeficit: 0.5 }),
    },
  ];
  return defs.map((d) => {
    const trust = {} as Record<AgentId, number>;
    for (const id of AGENT_IDS) trust[id] = id === d.id ? 1 : 0.6;
    return { ...d, trust, influence: 0.6, rewardHistory: [], accuracyHistory: [] };
  });
}

/** Normalized improvements of plan vs base. Positive means better. */
export function deltas(plan: Summary, base: Summary): Record<MetricKey, number> {
  const n = (v: number, floor: number) => Math.max(v, floor);
  const raw: Record<MetricKey, number> = {
    kwh: (base.kwh - plan.kwh) / n(base.kwh * 0.02, 1),
    cost: (base.cost - plan.cost) / n(base.cost * 0.02, 0.5),
    carbonKg: (base.carbonKg - plan.carbonKg) / n(base.carbonKg * 0.02, 0.5),
    downtime: (base.downtime - plan.downtime) / 2,
    healthDeficit: (base.healthDeficit - plan.healthDeficit) / 1.5,
    missed: (base.missed - plan.missed) / 0.5,
    throughput: (plan.throughput - base.throughput) / n(Math.abs(base.throughput) * 0.03, 0.5),
    latency: (base.latency - plan.latency) / n(base.latency * 0.05, 1),
    defects: (base.defects - plan.defects) / n(base.defects * 0.06, 0.15),
    safetyRisk: (base.safetyRisk - plan.safetyRisk) / n(base.safetyRisk * 0.06, 0.15),
  };
  for (const k of METRICS) raw[k] = Math.max(-5, Math.min(5, raw[k]));
  return raw;
}

export function utility(agent: Agent, d: Record<MetricKey, number>): number {
  let s = 0;
  let tot = 0;
  for (const k of METRICS) {
    s += agent.weights[k] * d[k];
    tot += agent.weights[k];
  }
  return s / tot;
}

export interface PlanContext {
  world: World;
  wm: WorldModel;
  base: Summary;
  forecast: Forecast;
  evalPlan: (actions: Action[], horizon?: number) => Summary;
}

export function makeContext(world: World, wm: WorldModel): PlanContext {
  const evalPlan = (actions: Action[], horizon = HORIZON) =>
    correctSummary(wm, rollout(world, actions, horizon).summary);
  return { world, wm, base: evalPlan([]), forecast: forecast(wm, world), evalPlan };
}

export interface Proposal {
  id: string;
  agentId: AgentId;
  action: Action;
  text: string;
  summary: Summary;
  ownGain: number;
  scores: Partial<Record<AgentId, number>>;
  objections: { from: AgentId; text: string }[];
  revisions: number;
  withdrawn: boolean;
}

function candidates(id: AgentId, ctx: PlanContext): Action[] {
  const w = ctx.world;
  const fc = ctx.forecast;
  const out: Action[] = [];
  const prod = w.machines.filter((m) => !m.support && m.downTicks === 0);
  if (id === "energy") {
    prod
      .filter((m) => m.load > 0.5)
      .sort((a, b) => b.power - a.power)
      .slice(0, 2)
      .forEach((m) => out.push({ kind: "throttle", machineId: m.id, speed: 0.8 }));
    const cloud = w.nodes.find((n) => n.kind === "cloud")!;
    const big = w.workloads
      .filter((x) => x.nodeId !== "cloud")
      .sort((a, b) => b.demand - a.demand)[0];
    if (cloud.online && big) out.push({ kind: "offload", workloadId: big.id, nodeId: "cloud" });
  } else if (id === "carbon") {
    const flex = w.jobs
      .filter((j) => j.flexible && !j.done && !j.missed && j.deferredUntil <= w.tick)
      .sort((a, b) => b.energy - a.energy)
      .slice(0, 2);
    const nowC = fc.frames[0]?.m.gridCarbon ?? 0;
    for (const j of flex) {
      let best = -1;
      let bestC = nowC * 0.85;
      fc.frames.forEach((f, i) => {
        if (i < 3) return;
        if (f.tick + j.remaining + 2 > j.deadline) return;
        if (f.m.gridCarbon < bestC) {
          bestC = f.m.gridCarbon;
          best = f.tick;
        }
      });
      if (best > 0) out.push({ kind: "defer", jobId: j.id, until: best });
    }
    const meanC = fc.frames.reduce((s, f) => s + f.m.gridCarbon, 0) / Math.max(1, fc.frames.length);
    const furnace = prod.find((m) => m.kind === "furnace");
    if (furnace && nowC > meanC * 1.05 && furnace.load > 0.5)
      out.push({ kind: "throttle", machineId: "furnace", speed: 0.85 });
  } else if (id === "maintenance") {
    const risky = fc.machineRisk
      .filter((r) => w.machines.find((m) => m.id === r.id)!.downTicks === 0)
      .sort((a, b) => b.maxFailProb - a.maxFailProb)[0];
    if (risky && risky.maxFailProb > 0.004) {
      out.push({ kind: "service", machineId: risky.id, at: w.tick });
      let bestI = 0;
      let bestL = Infinity;
      fc.frames.slice(0, 12).forEach((f, i) => {
        const l = f.machines.find((x) => x.id === risky.id)!.load;
        if (l < bestL) {
          bestL = l;
          bestI = i;
        }
      });
      if (bestI > 0) out.push({ kind: "service", machineId: risky.id, at: w.tick + bestI });
    }
    const worn = prod.filter((m) => m.load > 0.5).sort((a, b) => a.health - b.health)[0];
    if (worn && worn.health < 70) out.push({ kind: "throttle", machineId: worn.id, speed: 0.85 });
  } else if (id === "production") {
    const open = w.jobs
      .filter((j) => !j.done && !j.missed)
      .map((j) => ({ j, slack: j.deadline - Math.max(w.tick, j.deferredUntil) - j.remaining }))
      .sort((a, b) => a.slack - b.slack)
      .slice(0, 2);
    for (const { j } of open) out.push({ kind: "expedite", jobId: j.id, boost: 1.15 });
  } else if (id === "quality") {
    prod
      .filter((m) => m.health < 75 && m.load > 0.4 && m.speed <= 1.05)
      .sort((a, b) => a.health - b.health)
      .slice(0, 2)
      .forEach((m) => out.push({ kind: "throttle", machineId: m.id, speed: 0.9 }));
    prod
      .filter((m) => m.speed > 1.05)
      .forEach((m) => out.push({ kind: "throttle", machineId: m.id, speed: 1 }));
    const qa = w.workloads.find((x) => x.id === "quality");
    if (qa) {
      const bestEdge = w.nodes
        .filter((n) => n.kind === "edge" && n.online)
        .sort((a, b) => a.used - b.used)[0];
      if (bestEdge && qa.nodeId !== bestEdge.id)
        out.push({ kind: "offload", workloadId: qa.id, nodeId: bestEdge.id });
    }
  } else if (id === "safety") {
    const hot = prod.filter((m) => m.temp > 92).sort((a, b) => b.temp - a.temp)[0];
    if (hot) out.push({ kind: "throttle", machineId: hot.id, speed: 0.8 });
    const fragile = w.machines
      .filter((m) => m.downTicks === 0 && m.health < 45)
      .sort((a, b) => a.health - b.health)[0];
    if (fragile) {
      let bestI = 0;
      let bestL = Infinity;
      fc.frames.slice(0, 12).forEach((f, i) => {
        const l = f.machines.find((x) => x.id === fragile.id)!.load;
        if (l < bestL) {
          bestL = l;
          bestI = i;
        }
      });
      out.push({ kind: "service", machineId: fragile.id, at: w.tick + bestI });
    }
    const strained = prod.filter((m) => m.load > 0.9 && m.vibration > 7.5)[0];
    if (strained) out.push({ kind: "throttle", machineId: strained.id, speed: 0.85 });
  } else {
    const cloud = w.nodes.find((n) => n.kind === "cloud")!;
    const sensitiveOnCloud = w.workloads
      .filter((x) => x.nodeId === "cloud")
      .sort((a, b) => b.sensitivity - a.sensitivity)[0];
    const edges = w.nodes
      .filter((n) => n.kind === "edge")
      .sort((a, b) => a.used - a.capacity - (b.used - b.capacity));
    if (sensitiveOnCloud && edges[0])
      out.push({ kind: "offload", workloadId: sensitiveOnCloud.id, nodeId: edges[0].id });
    const tolerant = w.workloads
      .filter((x) => x.nodeId !== "cloud")
      .sort((a, b) => a.sensitivity - b.sensitivity)[0];
    if (tolerant && cloud.online)
      out.push({ kind: "offload", workloadId: tolerant.id, nodeId: "cloud" });
    const over = w.nodes.find((n) => n.kind === "edge" && n.used > n.capacity);
    if (over) {
      const mv = w.workloads
        .filter((x) => x.nodeId === over.id)
        .sort((a, b) => a.demand - b.demand)[0];
      if (mv && edges[0] && edges[0].id !== over.id)
        out.push({ kind: "offload", workloadId: mv.id, nodeId: edges[0].id });
    }
  }
  return out;
}

let proposalCounter = 0;

export function evaluateProposal(agent: Agent, ctx: PlanContext, action: Action) {
  const summary = ctx.evalPlan([action]);
  return { summary, gain: utility(agent, deltas(summary, ctx.base)) };
}

export function propose(agent: Agent, ctx: PlanContext): Proposal | null {
  let best: Proposal | null = null;
  for (const a of candidates(agent.id, ctx)) {
    const { summary, gain } = evaluateProposal(agent, ctx, a);
    if (gain > 0.02 && (!best || gain > best.ownGain)) {
      proposalCounter += 1;
      best = {
        id: `P${proposalCounter}`,
        agentId: agent.id,
        action: a,
        text: describeAction(ctx.world, a),
        summary,
        ownGain: gain,
        scores: {},
        objections: [],
        revisions: 0,
        withdrawn: false,
      };
    }
  }
  return best;
}
