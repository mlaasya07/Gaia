// Consensus resolver: weighted global utility, Pareto check, safety floors and hard vetoes.
import { actionTarget, applyAction, resetTransient, type Action, type World } from "./twin";
import type { Summary, WorldModel } from "./worldModel";
import {
  AGENT_IDS,
  METRIC_LABEL,
  deltas,
  makeContext,
  propose,
  utility,
  type Agent,
  type AgentId,
  type PlanContext,
  type Proposal,
} from "./agents";
import {
  bestMetric,
  formatMetricDiff,
  negotiate,
  resolverMessage,
  worstMetric,
  type Message,
} from "./negotiation";

export const SAFETY_FLOOR = -0.6;

export interface Decision {
  id: string;
  tick: number;
  proposals: Proposal[];
  adopted: Proposal[];
  actions: Action[];
  summary: Summary;
  base: Summary;
  utilities: Record<AgentId, number>;
  global: number;
  vetoes: string[];
  messages: Message[];
  explanation: string;
  rounds: number;
  predicted6: Summary;
  base6: Summary;
  outcome?: {
    realized: Summary;
    perAgent: Record<AgentId, { pred: number; real: number; acc: number }>;
  };
}

function hardVeto(plan: Summary, base: Summary): string | null {
  if (plan.missed > base.missed + 0.01)
    return `deadline floor: +${(plan.missed - base.missed).toFixed(1)} missed jobs`;
  if (plan.minHealth < 20 && plan.minHealth < base.minHealth - 0.5)
    return `health floor: a machine drops to ${plan.minHealth.toFixed(0)}%`;
  if (plan.maxTemp > 118 && plan.maxTemp > base.maxTemp)
    return `thermal limit: ${plan.maxTemp.toFixed(0)}°C`;
  if (plan.safetyRisk > base.safetyRisk + 1.5)
    return `safety floor: hazard index rises to ${plan.safetyRisk.toFixed(1)}`;
  return null;
}

export function resolve(agents: Agent[], ctx: PlanContext, proposals: Proposal[]) {
  const live = proposals.filter((p) => !p.withdrawn).slice(0, 5);
  const vetoes: string[] = [];
  type Cand = { set: Proposal[]; summary: Summary; u: Record<AgentId, number>; global: number };
  const cands: Cand[] = [];
  for (let mask = 0; mask < 1 << live.length; mask++) {
    const set = live.filter((_, i) => mask & (1 << i));
    const targets = new Set(set.map((p) => actionTarget(p.action)));
    if (targets.size !== set.length) continue;
    const summary =
      set.length === 0
        ? ctx.base
        : set.length === 1
          ? set[0]!.summary
          : ctx.evalPlan(set.map((p) => p.action));
    const veto = set.length ? hardVeto(summary, ctx.base) : null;
    if (veto) {
      if (set.length === 1) vetoes.push(`safety veto on "${set[0]!.text}": ${veto}`);
      continue;
    }
    const d = deltas(summary, ctx.base);
    const u = {} as Record<AgentId, number>;
    let global = 0;
    let floorBroken = false;
    for (const a of agents) {
      u[a.id] = utility(a, d);
      if (u[a.id] < SAFETY_FLOOR) floorBroken = true;
      global += a.influence * u[a.id];
    }
    if (floorBroken) continue;
    cands.push({ set, summary, u, global });
  }
  const pareto = cands.filter(
    (c) =>
      !cands.some(
        (o) =>
          o !== c &&
          AGENT_IDS.every((id) => o.u[id] >= c.u[id]) &&
          AGENT_IDS.some((id) => o.u[id] > c.u[id] + 1e-9),
      ),
  );
  pareto.sort((a, b) => b.global - a.global || a.set.length - b.set.length);
  const chosen = pareto[0] ?? cands.find((c) => c.set.length === 0)!;
  return { chosen, vetoes, considered: cands.length, paretoCount: pareto.length };
}

let decisionCounter = 0;

function explain(
  agents: Agent[],
  ctx: PlanContext,
  proposals: Proposal[],
  adopted: Proposal[],
  summary: Summary,
  vetoes: string[],
) {
  const name = (id: AgentId) => agents.find((a) => a.id === id)!.name.replace(" Agent", "");
  const parts: string[] = [];
  if (adopted.length === 0)
    parts.push(
      "No change adopted: no joint plan beat the current course without breaking a floor.",
    );
  else parts.push(`Adopted ${adopted.map((p) => `"${p.text}" (${name(p.agentId)})`).join(", ")}.`);
  const rejected = proposals.filter((p) => !adopted.includes(p));
  for (const p of rejected) {
    const ob = p.objections[0];
    if (p.withdrawn) parts.push(`${name(p.agentId)} withdrew "${p.text}" after objections.`);
    else if (ob)
      parts.push(
        `"${p.text}" dropped: ${name(ob.from)} ${ob.text.replace(/^objects to "[^"]*": /, "flagged ")}.`,
      );
    else parts.push(`"${p.text}" not included: lower joint utility.`);
  }
  if (adopted.length) {
    const losers = agents.filter((a) => utility(a, deltas(summary, ctx.base)) < -0.02);
    const winners = agents.filter((a) => utility(a, deltas(summary, ctx.base)) > 0.02);
    if (losers.length && winners.length) {
      const l = losers[0]!;
      const k = worstMetric(l, summary, ctx.base);
      const wa = winners[0]!;
      const wk = bestMetric(wa, summary, ctx.base);
      parts.push(
        `Trade-off: ${name(l.id)} accepts ${formatMetricDiff(k, summary, ctx.base)} (${METRIC_LABEL[k]}) for ${formatMetricDiff(wk, summary, ctx.base)} (${METRIC_LABEL[wk]}).`,
      );
    }
  }
  for (const v of vetoes) parts.push(v.charAt(0).toUpperCase() + v.slice(1) + ".");
  parts.push(
    `World model expects over 6h: ${summary.kwh.toFixed(0)} kWh (${formatMetricDiff("kwh", summary, ctx.base)}), ${summary.carbonKg.toFixed(1)} kg CO2 (${formatMetricDiff("carbonKg", summary, ctx.base)}), ${summary.missed.toFixed(1)} at-risk/missed jobs.`,
  );
  return parts.join(" ");
}

/** Full LACD decision cycle on the given world (mutates it by applying the joint plan). */
export function decideCollaborative(world: World, wm: WorldModel, agents: Agent[]): Decision {
  resetTransient(world);
  const ctx = makeContext(world, wm);
  const neg = negotiate(agents, ctx);
  const res = resolve(agents, ctx, neg.proposals);
  const adopted = res.chosen.set;
  const actions = adopted.map((p) => p.action);
  const messages = [...neg.messages];
  for (const v of res.vetoes) messages.push(resolverMessage("veto", v, neg.rounds));
  const explanation = explain(agents, ctx, neg.proposals, adopted, res.chosen.summary, res.vetoes);
  messages.push(
    resolverMessage(
      "consensus",
      adopted.length
        ? `consensus (${res.paretoCount} Pareto plans of ${res.considered}): ${adopted.map((p) => p.text).join(" + ")}`
        : "consensus: hold current course",
      neg.rounds,
    ),
  );
  const predicted6 = ctx.evalPlan(actions, 6);
  const base6 = ctx.evalPlan([], 6);
  for (const a of actions) applyAction(world, a);
  decisionCounter += 1;
  return {
    id: `D${decisionCounter}`,
    tick: world.tick,
    proposals: neg.proposals,
    adopted,
    actions,
    summary: res.chosen.summary,
    base: ctx.base,
    utilities: res.chosen.u,
    global: res.chosen.global,
    vetoes: res.vetoes,
    messages,
    explanation,
    rounds: neg.rounds,
    predicted6,
    base6,
  };
}

/** Siloed baseline: each agent applies its own best proposal, no negotiation, no vetoes. */
export function decideSiloed(world: World, wm: WorldModel, agents: Agent[]): Action[] {
  resetTransient(world);
  const ctx = makeContext(world, wm);
  const actions: Action[] = [];
  for (const a of agents) {
    const p = propose(a, ctx);
    if (p) actions.push(p.action);
  }
  for (const a of actions) applyAction(world, a);
  return actions;
}
