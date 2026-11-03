// Disruption impact model: runs the twin physics forward 6h twice from the current state,
// once as-is and once with the operator's disruptions, using identical randomness,
// and reports the differences in machine health, temperature, energy and deadlines.
import { HORIZON, clockLabel, step, zeroTotals, type EventKind, type World } from "@/engine/twin";
import { cloneWorld } from "@/engine/worldModel";
import { injectEvent } from "./events";

export interface MachineImpact {
  id: string;
  name: string;
  healthNow: number;
  healthBase: number;
  healthHit: number;
  peakTempBase: number;
  peakTempHit: number;
  failed: boolean;
  risk: "low" | "elevated" | "critical";
}

export interface JobImpact {
  id: string;
  name: string;
  machine: string;
  due: string;
  status: "newly missed" | "at risk" | "recovered";
}

export interface ImpactReport {
  fromClock: string;
  labels: string[];
  machines: MachineImpact[];
  energy: {
    kwhBase: number;
    kwhHit: number;
    costBase: number;
    costHit: number;
    carbonBase: number;
    carbonHit: number;
  };
  deadlines: {
    missedBase: number;
    missedHit: number;
    downtimeBase: number;
    downtimeHit: number;
    jobs: JobImpact[];
  };
  recommendation: string;
}

function simulate(start: World, events: EventKind[], faultTarget?: string) {
  const w = cloneWorld(start);
  w.deterministic = true;
  w.totals = zeroTotals();
  const labels = events.map((e) => injectEvent(w, e, faultTarget));
  const peak: Record<string, number> = {};
  const failed: Record<string, boolean> = {};
  for (let i = 0; i < HORIZON; i++) {
    step(w);
    for (const m of w.machines) {
      peak[m.id] = Math.max(peak[m.id] ?? 0, m.temp);
      if (m.status === "failed") failed[m.id] = true;
    }
  }
  return { w, peak, failed, labels };
}

export function analyzeImpact(
  world: World,
  events: EventKind[],
  faultTarget?: string,
): ImpactReport {
  const base = simulate(world, []);
  const hit = simulate(world, events, faultTarget);

  const machines: MachineImpact[] = world.machines.map((m) => {
    const b = base.w.machines.find((x) => x.id === m.id)!;
    const h = hit.w.machines.find((x) => x.id === m.id)!;
    const isFailed = !!hit.failed[m.id];
    const tempHit = hit.peak[m.id] ?? m.temp;
    const risk: MachineImpact["risk"] =
      isFailed || h.health < 25 || tempHit > 110
        ? "critical"
        : b.health - h.health > 5 || tempHit > 90
          ? "elevated"
          : "low";
    return {
      id: m.id,
      name: m.name,
      healthNow: m.health,
      healthBase: b.health,
      healthHit: h.health,
      peakTempBase: base.peak[m.id] ?? m.temp,
      peakTempHit: tempHit,
      failed: isFailed,
      risk,
    };
  });

  const machineName = (id: string) => world.machines.find((m) => m.id === id)?.name ?? id;
  const jobs: JobImpact[] = [];
  for (const j of hit.w.jobs) {
    const b = base.w.jobs.find((x) => x.id === j.id);
    const entry = {
      id: j.id,
      name: j.name,
      machine: machineName(j.machineId),
      due: clockLabel(j.deadline),
    };
    if (j.missed && !b?.missed) jobs.push({ ...entry, status: "newly missed" });
    else if (!j.done && !j.missed && b?.done) jobs.push({ ...entry, status: "at risk" });
    else if (b?.missed && !j.missed) jobs.push({ ...entry, status: "recovered" });
  }

  const bt = base.w.totals;
  const ht = hit.w.totals;
  const worst = [...machines].sort(
    (a, b) => b.healthBase - b.healthHit - (a.healthBase - a.healthHit),
  )[0];
  const newlyMissed = jobs.filter((j) => j.status === "newly missed").length;
  let recommendation = "Impact is small. Keep the current plan and monitor.";
  if (worst && (worst.risk === "critical" || worst.healthBase - worst.healthHit > 10))
    recommendation = `Schedule service on ${worst.name} before it degrades further; it loses the most health under this scenario.`;
  else if (newlyMissed > 0)
    recommendation = `Expedite or reassign ${jobs.find((j) => j.status === "newly missed")!.id} to protect its deadline.`;
  else if (ht.kwh - bt.kwh > bt.kwh * 0.05 || ht.cost - bt.cost > bt.cost * 0.1)
    recommendation = "Defer flexible jobs out of the disruption window to contain energy cost.";

  return {
    fromClock: clockLabel(world.tick),
    labels: hit.labels,
    machines,
    energy: {
      kwhBase: bt.kwh,
      kwhHit: ht.kwh,
      costBase: bt.cost,
      costHit: ht.cost,
      carbonBase: bt.carbonKg,
      carbonHit: ht.carbonKg,
    },
    deadlines: {
      missedBase: bt.missed,
      missedHit: ht.missed,
      downtimeBase: bt.downtime,
      downtimeHit: ht.downtime,
      jobs,
    },
    recommendation,
  };
}
