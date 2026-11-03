// Scenario lab: replays the current factory state across disruption scenarios
// and compares each agent's recommendations and realized outcomes under three
// policies (collaborative LACD, siloed agents, reactive control). Fully deterministic so
// the three futures are directly comparable.
import {
  HORIZON,
  TICKS_PER_HOUR,
  step,
  type EventKind,
  type TickMetrics,
  type Totals,
  type World,
  zeroTotals,
} from "./twin";
import { cloneWorld, createWorldModel, observe, type WorldModel } from "./worldModel";
import { decideCollaborative, decideSiloed, type Decision } from "./consensus";
import { AGENT_IDS, type Agent, type AgentId } from "./agents";
import { learnFromOutcome, OUTCOME_WINDOW, realizedSummary } from "./learning";
import { injectEvent } from "@/scenarios/events";

export interface SweepScenario {
  label: string;
  event: EventKind | null;
}

export const SWEEP_SCENARIOS: SweepScenario[] = [
  { label: "Baseline", event: null },
  { label: "Heatwave", event: "heatwave" },
  { label: "Machine fault", event: "machineFault" },
  { label: "Rush order", event: "rushOrder" },
  { label: "Grid carbon spike", event: "carbonSpike" },
  { label: "Energy price surge", event: "priceSurge" },
  { label: "Cloud outage", event: "cloudOutage" },
  { label: "Supply delay", event: "supplyDelay" },
];

export interface AgentScenarioRow {
  agentId: AgentId;
  recommendation: string | null;
  adoptedFirstCycle: boolean;
  predictedGain: number;
  realizedSum: number;
  realizedCount: number;
  accuracySum: number;
  accuracyCount: number;
  proposals: number;
  adoptions: number;
}

export interface ScenarioResult {
  scenario: SweepScenario;
  rows: AgentScenarioRow[];
  collab: Totals;
  siloed: Totals;
  reactive: Totals;
  decisions: number;
  vetoes: number;
}

interface RunOutput {
  totals: Totals;
  metrics: TickMetrics[];
  decisions: Decision[];
}

function runPolicy(
  world: World,
  wm: WorldModel,
  agents: Agent[],
  policy: "collab" | "siloed" | "none",
  event: EventKind | null,
): RunOutput {
  const w = cloneWorld(world);
  w.deterministic = true;
  w.totals = zeroTotals();
  w.history = [];
  if (event) injectEvent(w, event);
  const m = structuredClone(wm);
  const ag = structuredClone(agents);
  const metrics: TickMetrics[] = [];
  const decisions: Decision[] = [];
  for (let i = 0; i < HORIZON; i++) {
    if (i > 0 && w.tick % TICKS_PER_HOUR === 0 && policy !== "none") {
      if (policy === "collab") decisions.push(decideCollaborative(w, m, ag));
      else decideSiloed(w, m, ag);
    }
    const r = step(w);
    metrics.push(r);
    observe(m, r);
  }
  w.history = metrics;
  for (const d of decisions) {
    if (d.outcome) continue;
    const end = Math.min(d.tick + OUTCOME_WINDOW, w.tick);
    if (end <= d.tick) continue;
    learnFromOutcome(ag, d, realizedSummary(w, d.tick, end));
  }
  return { totals: w.totals, metrics, decisions };
}

function emptyRow(agentId: AgentId): AgentScenarioRow {
  return {
    agentId,
    recommendation: null,
    adoptedFirstCycle: false,
    predictedGain: 0,
    realizedSum: 0,
    realizedCount: 0,
    accuracySum: 0,
    accuracyCount: 0,
    proposals: 0,
    adoptions: 0,
  };
}

export function runScenarioSweep(world: World, wm: WorldModel, agents: Agent[]): ScenarioResult[] {
  return SWEEP_SCENARIOS.map((scenario) => {
    const collabRun = runPolicy(world, wm, agents, "collab", scenario.event);
    const siloedRun = runPolicy(world, wm, agents, "siloed", scenario.event);
    const reactiveRun = runPolicy(world, wm, agents, "none", scenario.event);

    const rows = new Map<AgentId, AgentScenarioRow>();
    for (const id of AGENT_IDS) rows.set(id, emptyRow(id));
    let first = true;
    let vetoes = 0;
    for (const d of collabRun.decisions) {
      vetoes += d.vetoes.length;
      for (const p of d.proposals) {
        const row = rows.get(p.agentId)!;
        row.proposals += 1;
        if (first) {
          row.recommendation = p.text;
          row.predictedGain = p.ownGain;
        }
      }
      for (const a of d.adopted) {
        const row = rows.get(a.agentId)!;
        row.adoptions += 1;
        if (first) row.adoptedFirstCycle = true;
      }
      first = false;
      if (d.outcome) {
        for (const id of AGENT_IDS) {
          const row = rows.get(id)!;
          const o = d.outcome.perAgent[id]!;
          row.realizedSum += o.real;
          row.realizedCount += 1;
          row.accuracySum += o.acc;
          row.accuracyCount += 1;
        }
      }
    }

    return {
      scenario,
      rows: AGENT_IDS.map((id) => rows.get(id)!),
      collab: collabRun.totals,
      siloed: siloedRun.totals,
      reactive: reactiveRun.totals,
      decisions: collabRun.decisions.length,
      vetoes,
    };
  });
}
