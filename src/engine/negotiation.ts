// Negotiation: agents cross-evaluate proposals via world-model rollouts and revise for up to 3 rounds.
import { describeAction, type Action } from "./twin";
import type { Summary } from "./worldModel";
import {
  METRICS,
  METRIC_LABEL,
  deltas,
  evaluateProposal,
  propose,
  utility,
  type Agent,
  type AgentId,
  type MetricKey,
  type PlanContext,
  type Proposal,
} from "./agents";

export type MessageKind =
  "propose" | "hold" | "object" | "support" | "revise" | "withdraw" | "consensus" | "veto";
export interface Message {
  id: string;
  round: number;
  from: AgentId | "resolver";
  kind: MessageKind;
  text: string;
}

const UNITS: Record<MetricKey, (v: number) => string> = {
  kwh: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} kWh`,
  cost: (v) => `${v > 0 ? "+" : ""}$${v.toFixed(2)}`,
  carbonKg: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} kg CO2`,
  downtime: (v) => `${v > 0 ? "+" : ""}${(v / 6).toFixed(2)} h downtime`,
  healthDeficit: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts wear`,
  missed: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} missed jobs`,
  throughput: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} units`,
  latency: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} ms`,
  defects: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} defect risk units`,
  safetyRisk: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} hazard points`,
};

export function formatMetricDiff(k: MetricKey, plan: Summary, base: Summary): string {
  return UNITS[k](plan[k] - base[k]);
}

export function worstMetric(agent: Agent, plan: Summary, base: Summary): MetricKey {
  const d = deltas(plan, base);
  let worst: MetricKey = agent.primary[0]!;
  let v = Infinity;
  for (const k of METRICS) {
    const s = agent.weights[k] * d[k];
    if (s < v) {
      v = s;
      worst = k;
    }
  }
  return worst;
}

export function bestMetric(agent: Agent, plan: Summary, base: Summary): MetricKey {
  const d = deltas(plan, base);
  let best: MetricKey = agent.primary[0]!;
  let v = -Infinity;
  for (const k of METRICS) {
    const s = agent.weights[k] * d[k];
    if (s > v) {
      v = s;
      best = k;
    }
  }
  return best;
}

function soften(a: Action, ctx: PlanContext): Action | null {
  const t = ctx.world.tick;
  if (a.kind === "throttle") {
    const speed = a.speed + (1 - a.speed) / 2;
    return speed > 0.95 ? null : { ...a, speed: Math.round(speed * 100) / 100 };
  }
  if (a.kind === "defer") {
    const until = t + Math.floor((a.until - t) / 2);
    return until - t < 2 ? null : { ...a, until };
  }
  if (a.kind === "service") return a.at <= t ? { ...a, at: t + 6 } : null;
  if (a.kind === "expedite") return a.boost > 1.1 ? { ...a, boost: 1.07 } : null;
  return null;
}

let msgCounter = 0;
const msg = (round: number, from: Message["from"], kind: MessageKind, text: string): Message => {
  msgCounter += 1;
  return { id: `M${msgCounter}`, round, from, kind, text };
};

export function negotiate(agents: Agent[], ctx: PlanContext) {
  const byId = (id: AgentId) => agents.find((a) => a.id === id)!;
  const messages: Message[] = [];
  const proposals: Proposal[] = [];
  for (const a of agents) {
    const p = propose(a, ctx);
    if (p) {
      proposals.push(p);
      messages.push(
        msg(
          1,
          a.id,
          "propose",
          `${p.text} - expect ${formatMetricDiff(bestMetric(a, p.summary, ctx.base), p.summary, ctx.base)} over 6h`,
        ),
      );
    } else messages.push(msg(1, a.id, "hold", "no action improves my objective right now"));
  }
  let rounds = 0;
  for (let round = 1; round <= 3; round++) {
    rounds = round;
    let anyObjection = false;
    for (const p of proposals) {
      if (p.withdrawn) continue;
      p.objections = [];
      for (const b of agents) {
        if (b.id === p.agentId) continue;
        const s = utility(b, deltas(p.summary, ctx.base));
        p.scores[b.id] = s;
        if (s < -0.08) {
          const k = worstMetric(b, p.summary, ctx.base);
          const text = `objects to "${p.text}": ${formatMetricDiff(k, p.summary, ctx.base)} (${METRIC_LABEL[k]})`;
          p.objections.push({ from: b.id, text });
          messages.push(msg(round, b.id, "object", text));
          anyObjection = true;
        } else if (s > 0.1 && round === 1) {
          messages.push(
            msg(round, b.id, "support", `supports "${p.text}" (score +${s.toFixed(2)})`),
          );
        }
      }
    }
    if (!anyObjection || round === 3) break;
    for (const p of proposals) {
      if (p.withdrawn || p.objections.length === 0) continue;
      const owner = byId(p.agentId);
      const pressure = p.objections.reduce(
        (s, o) => s + owner.trust[o.from] * Math.abs(p.scores[o.from] ?? 0),
        0,
      );
      if (pressure < p.ownGain * 0.6) continue;
      const next = soften(p.action, ctx);
      if (!next) {
        p.withdrawn = true;
        messages.push(
          msg(round + 1, p.agentId, "withdraw", `withdraws "${p.text}" to avoid conflict`),
        );
        continue;
      }
      const { summary, gain } = evaluateProposal(owner, ctx, next);
      const old = p.text;
      p.action = next;
      p.text = describeAction(ctx.world, next);
      p.summary = summary;
      p.ownGain = gain;
      p.revisions += 1;
      if (gain <= 0.01) {
        p.withdrawn = true;
        messages.push(
          msg(round + 1, p.agentId, "withdraw", `softened "${old}" no longer helps; withdraws`),
        );
      } else messages.push(msg(round + 1, p.agentId, "revise", `revises "${old}" → "${p.text}"`));
    }
  }
  return { proposals, messages, rounds };
}

export function resolverMessage(kind: "consensus" | "veto", text: string, round: number): Message {
  return msg(round, "resolver", kind, text);
}
