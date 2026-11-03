// What-if lab: fork current state and run two futures side by side with identical randomness.
import {
  HORIZON,
  TICKS_PER_HOUR,
  applyAction,
  step,
  zeroTotals,
  type Action,
  type EventKind,
  type Totals,
  type World,
} from "@/engine/twin";
import { cloneWorld, observe, type WorldModel } from "@/engine/worldModel";
import { decideCollaborative, decideSiloed } from "@/engine/consensus";
import type { Agent } from "@/engine/agents";
import { injectEvent } from "./events";

export type CfMode = "reactive" | "siloed" | "force";

export interface CfFuture {
  label: string;
  kwh: number[];
  carbonKg: number[];
  downtime: number[];
  totals: Totals;
}

export interface CfResult {
  fromTick: number;
  a: CfFuture;
  b: CfFuture;
}

function run(
  label: string,
  world: World,
  wm: WorldModel,
  agents: Agent[],
  policy: "collab" | "siloed" | "none",
  initial?: Action,
): CfFuture {
  const w = cloneWorld(world);
  const m = structuredClone(wm);
  const ag = structuredClone(agents);
  w.totals = zeroTotals();
  if (initial) applyAction(w, initial);
  const out: CfFuture = { label, kwh: [], carbonKg: [], downtime: [], totals: w.totals };
  for (let i = 0; i < HORIZON; i++) {
    if (i > 0 && w.tick % TICKS_PER_HOUR === 0) {
      if (policy === "collab") decideCollaborative(w, m, ag);
      else if (policy === "siloed") decideSiloed(w, m, ag);
    }
    const r = step(w);
    observe(m, r);
    out.kwh.push(r.kwh);
    out.carbonKg.push(r.carbonKg);
    out.downtime.push(r.downtime);
  }
  out.totals = w.totals;
  return out;
}

export function runCounterfactual(
  world: World,
  wm: WorldModel,
  agents: Agent[],
  mode: CfMode,
  forced?: Action,
  event?: EventKind,
): CfResult {
  const base = cloneWorld(world);
  if (event) injectEvent(base, event);
  const a = run("Gaia (collaborative)", base, wm, agents, "collab");
  const b =
    mode === "reactive"
      ? run("Reactive control", base, wm, agents, "none")
      : mode === "siloed"
        ? run("Siloed agents", base, wm, agents, "siloed")
        : run("Forced decision", base, wm, agents, "collab", forced);
  return { fromTick: world.tick, a, b };
}
