// Learning: bandit-style updates of agent weights and inter-agent trust from
// realized vs predicted reward, plus short human-readable lessons for the
// research dashboard.
import { TICKS_PER_HOUR, type TickMetrics, type World } from "./twin";
import type { Summary } from "./worldModel";
import {
  AGENT_IDS,
  METRICS,
  METRIC_LABEL,
  deltas,
  utility,
  type Agent,
  type AgentId,
  type MetricKey,
} from "./agents";
import type { Decision } from "./consensus";

export const OUTCOME_WINDOW = TICKS_PER_HOUR;

export function realizedSummary(world: World, fromTick: number, toTick: number): Summary {
  const rows: TickMetrics[] = world.history.filter((h) => h.tick >= fromTick && h.tick < toTick);
  const sum = (k: keyof TickMetrics) => rows.reduce((s, r) => s + r[k], 0);
  return {
    kwh: sum("kwh"),
    carbonKg: sum("carbonKg"),
    cost: sum("cost"),
    downtime: sum("downtime"),
    missed: sum("missed"),
    throughput: sum("throughput"),
    latency: rows.length ? sum("latency") / rows.length : 0,
    healthDeficit: world.machines.reduce((s, m) => s + (100 - m.health), 0) / world.machines.length,
    minHealth: Math.min(...world.machines.map((m) => m.health)),
    maxTemp: Math.max(...world.machines.map((m) => m.temp)),
    defects: sum("defects"),
    safetyRisk: sum("safetyRisk"),
  };
}

/** Called once a decision's outcome window has played out. Mutates agents, returns lessons. */
export function learnFromOutcome(agents: Agent[], decision: Decision, realized: Summary): string[] {
  const lessons: string[] = [];
  const perAgent = {} as Record<AgentId, { pred: number; real: number; acc: number }>;
  const dPred = deltas(decision.predicted6, decision.base6);
  const dReal = deltas(realized, decision.base6);
  for (const a of agents) {
    const pred = utility(a, dPred);
    const real = utility(a, dReal);
    const acc = 1 - Math.min(1, Math.abs(pred - real) / (Math.abs(pred) + Math.abs(real) + 0.25));
    perAgent[a.id] = { pred, real, acc };
    a.rewardHistory.push(real);
    a.accuracyHistory.push(acc);
    if (a.rewardHistory.length > 120) a.rewardHistory.shift();
    if (a.accuracyHistory.length > 120) a.accuracyHistory.shift();
    // Weight update: attend more to metrics where the world was worse than predicted,
    // reinforce primary objectives when realized reward was positive.
    const lr = 0.04;
    const before = { ...a.weights };
    for (const k of METRICS) {
      const surprise = Math.max(-2, Math.min(2, dPred[k] - dReal[k]));
      const isPrimary = a.primary.includes(k);
      let next = a.weights[k] + lr * surprise * (isPrimary ? 0.5 : 0.15);
      if (isPrimary && real > 0) next += lr * 0.2;
      a.weights[k] = Math.max(isPrimary ? 0.4 : 0.02, Math.min(2, next));
    }
    let bestK: MetricKey = a.primary[0]!;
    let bestDelta = 0;
    for (const k of METRICS) {
      const d = a.weights[k] - before[k];
      if (Math.abs(d) > Math.abs(bestDelta)) {
        bestDelta = d;
        bestK = k;
      }
    }
    if (Math.abs(bestDelta) > 0.03) {
      lessons.push(
        `${a.name}: ${bestDelta > 0 ? "raised" : "lowered"} weight on ${METRIC_LABEL[bestK]} after it came in ${dReal[bestK] < dPred[bestK] ? "worse" : "better"} than predicted.`,
      );
    } else if (acc < 0.5) {
      lessons.push(
        `${a.name}: prediction missed badly (accuracy ${(acc * 100).toFixed(0)}%), widening attention across metrics.`,
      );
    }
  }
  const inPlan = new Set(decision.adopted.map((p) => p.agentId));
  for (const a of agents) {
    for (const b of AGENT_IDS) {
      if (b === a.id) continue;
      if (inPlan.has(b)) a.trust[b] += 0.2 * (perAgent[b].acc - a.trust[b]);
      else a.trust[b] += 0.02 * (0.6 - a.trust[b]);
      a.trust[b] = Math.max(0.05, Math.min(1, a.trust[b]));
    }
  }
  for (const a of agents) {
    const others = agents.filter((x) => x.id !== a.id);
    a.influence = others.reduce((s, x) => s + x.trust[a.id], 0) / others.length;
  }
  const star = decision.adopted.map((p) => p.agentId).find((id) => perAgent[id]!.acc >= 0.75);
  if (star)
    lessons.push(
      `${agents.find((a) => a.id === star)!.name} earned trust: its adopted plan delivered within the prediction band.`,
    );
  decision.outcome = { realized, perAgent };
  return lessons.slice(0, 4);
}
