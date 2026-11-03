import { describe, expect, it } from "vitest";

import { computeAlerts, countAlerts, pruneAcknowledged } from "@/engine/alerts";
import { decideCollaborative } from "@/engine/consensus";
import { createAgents } from "@/engine/agents";
import { runScenarioSweep, SWEEP_SCENARIOS } from "@/engine/scenarioLab";
import {
  CREW_REPAIR_TICKS,
  HUMAN_HOLD_TICKS,
  MAX_COMMISSIONED,
  TICKS_PER_HOUR,
  applyAction,
  canCommissionMachine,
  commissionMachine,
  createWorld,
  dispatchRepair,
  holdThrottle,
  isHeld,
  resetTransient,
  step,
} from "@/engine/twin";
import { createWorldModel } from "@/engine/worldModel";

function failedWorld() {
  const w = createWorld(7);
  w.deterministic = true;
  const m = w.machines[1]!;
  m.health = 0; // a machine at zero health fails on the next step (deterministic worlds included)
  step(w);
  return { w, m };
}

describe("dispatchRepair", () => {
  it("shortens a failed machine's outage and restores health", () => {
    const { w, m } = failedWorld();
    expect(m.status).toBe("failed");
    expect(dispatchRepair(w, m.id)).toBe(true);
    expect(m.downTicks).toBeLessThanOrEqual(CREW_REPAIR_TICKS);
    expect(m.health).toBeGreaterThanOrEqual(80);
  });

  it("brings the machine back within the crew window", () => {
    const { w, m } = failedWorld();
    dispatchRepair(w, m.id);
    for (let i = 0; i < CREW_REPAIR_TICKS + 1; i++) step(w);
    expect(m.status).not.toBe("failed");
  });

  it("does nothing for a healthy or unknown machine", () => {
    const w = createWorld(7);
    const before = structuredClone(w.machines);
    expect(dispatchRepair(w, w.machines[0]!.id)).toBe(false);
    expect(dispatchRepair(w, "nope")).toBe(false);
    expect(w.machines).toEqual(before);
  });
});

describe("human hold", () => {
  it("survives the agents' hourly setpoint reset", () => {
    const w = createWorld(7);
    const id = w.machines[0]!.id;
    expect(holdThrottle(w, id, 0.8)).toBe(true);
    resetTransient(w);
    expect(w.machines[0]!.speed).toBe(0.8);
    expect(isHeld(w, w.machines[0]!)).toBe(true);
  });

  it("blocks agent throttle actions on a held machine", () => {
    const w = createWorld(7);
    const id = w.machines[0]!.id;
    holdThrottle(w, id, 0.8);
    applyAction(w, { kind: "throttle", machineId: id, speed: 1 });
    expect(w.machines[0]!.speed).toBe(0.8);
  });

  it("survives a full agent decision cycle", () => {
    const w = createWorld(7);
    const wm = createWorldModel();
    const agents = createAgents();
    const id = w.machines[0]!.id;
    holdThrottle(w, id, 0.7);
    decideCollaborative(w, wm, agents);
    expect(w.machines[0]!.speed).toBe(0.7);
  });

  it("expires after the hold window and can be released early", () => {
    const w = createWorld(7);
    const m = w.machines[0]!;
    holdThrottle(w, m.id, 0.8);
    w.tick += HUMAN_HOLD_TICKS;
    resetTransient(w);
    expect(m.speed).toBe(1);
    expect(m.hold).toBeUndefined();

    holdThrottle(w, m.id, 0.8);
    holdThrottle(w, m.id, 1);
    expect(isHeld(w, m)).toBe(false);
  });

  it("clamps absurd speeds and rejects unknown machines", () => {
    const w = createWorld(7);
    const m = w.machines[0]!;
    holdThrottle(w, m.id, 0);
    expect(m.speed).toBeGreaterThan(0);
    expect(holdThrottle(w, "nope", 0.8)).toBe(false);
  });
});

describe("alerts", () => {
  it("raises a critical repair alert for a failed machine, most severe first", () => {
    const { w, m } = failedWorld();
    const alerts = computeAlerts(w, null);
    const repair = alerts.find((a) => a.id === `repair-failed-${m.id}`);
    expect(repair).toMatchObject({
      severity: "critical",
      kind: "repair",
      canRepair: true,
      canThrottle: false,
    });
    expect(alerts[0]!.severity).toBe("critical");
  });

  it("raises overheating alerts with throttle and service actions", () => {
    const w = createWorld(7);
    const m = w.machines[0]!;
    m.temp = 104;
    const a = computeAlerts(w, null).find((x) => x.id === `overheat-hot-${m.id}`);
    expect(a).toMatchObject({ severity: "critical", canThrottle: true, canService: true });
  });

  it("warns about worn machines that are still running", () => {
    const w = createWorld(7);
    const m = w.machines[0]!;
    m.health = 30;
    m.downTicks = 0;
    expect(computeAlerts(w, null).some((a) => a.id === `repair-worn-${m.id}`)).toBe(true);
  });

  it("is quiet for a freshly created factory", () => {
    expect(
      computeAlerts(createWorld(7), null).filter((a) => a.severity === "critical"),
    ).toHaveLength(0);
  });

  it("counts by severity and respects acknowledgements", () => {
    const { w, m } = failedWorld();
    const alerts = computeAlerts(w, null);
    expect(countAlerts(alerts).critical).toBeGreaterThanOrEqual(1);
    const acked = new Set([`repair-failed-${m.id}`]);
    const counts = countAlerts(alerts, acked);
    expect(counts.total).toBe(alerts.length);
    expect(counts.open).toBe(alerts.length - 1);
  });

  it("forgets acknowledgements for alerts that went away", () => {
    const { w, m } = failedWorld();
    const alerts = computeAlerts(w, null);
    const acked = new Set([`repair-failed-${m.id}`, "gone"]);
    expect([...pruneAcknowledged(acked, alerts)]).toEqual([`repair-failed-${m.id}`]);
  });

  it("recommends capacity review after repeated outages", () => {
    const w = createWorld(7);
    w.deterministic = true;
    // step() returns metrics; the simulation hook is what records them, so record them here.
    for (let i = 0; i < TICKS_PER_HOUR * 2; i++) w.history.push({ ...step(w), downtime: 2 });
    const ids = computeAlerts(w, null).map((a) => a.id);
    expect(ids).toContain("capacity-outages");
  });
});

describe("scenario lab", () => {
  const world = createWorld(11);
  world.deterministic = true;
  const wm = createWorldModel();
  const agents = createAgents();

  it("covers every scenario with a row for each agent and three comparable policies", () => {
    const results = runScenarioSweep(world, wm, agents);
    expect(results.map((r) => r.scenario.label)).toEqual(SWEEP_SCENARIOS.map((s) => s.label));
    for (const r of results) {
      expect(r.rows).toHaveLength(agents.length);
      for (const t of [r.collab, r.siloed, r.reactive]) {
        expect(t.kwh).toBeGreaterThan(0);
        expect(t.missed).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is deterministic and leaves the live world and agents untouched", () => {
    const beforeWorld = structuredClone(world);
    const beforeAgents = structuredClone(agents);
    const a = runScenarioSweep(world, wm, agents);
    const b = runScenarioSweep(world, wm, agents);
    expect(b).toEqual(a);
    expect(world).toEqual(beforeWorld);
    expect(agents).toEqual(beforeAgents);
  });
});

describe("commissionMachine", () => {
  it("adds an idle CNC machine and hands it every second waiting CNC job", () => {
    const w = createWorld(7);
    const waiting = w.jobs.filter(
      (j) => j.machineId === "cnc" && !j.done && j.remaining === j.work,
    ).length;
    const before = w.machines.length;

    const added = commissionMachine(w);

    expect(added?.name).toBe("CNC 2");
    expect(w.machines).toHaveLength(before + 1);
    expect(added?.health).toBe(100);
    expect(w.jobs.filter((j) => j.machineId === added?.id)).toHaveLength(Math.floor(waiting / 2));
  });

  it("stops at the commissioning limit", () => {
    const w = createWorld(7);
    for (let i = 0; i < MAX_COMMISSIONED; i++) expect(commissionMachine(w)).not.toBeNull();
    expect(canCommissionMachine(w)).toBe(false);
    expect(commissionMachine(w)).toBeNull();
  });

  it("keeps running with the new machine and gives it new work", () => {
    const w = createWorld(7);
    const added = commissionMachine(w)!;
    for (let i = 0; i < TICKS_PER_HOUR * 6; i++) step(w);
    expect(w.jobs.some((j) => j.machineId === added.id)).toBe(true);
    expect(w.machines.every((m) => Number.isFinite(m.health))).toBe(true);
  });

  it("leaves seeded runs unchanged when nothing is commissioned", () => {
    const a = createWorld(7);
    const b = createWorld(7);
    expect(a.jobs.map((j) => j.machineId)).toEqual(b.jobs.map((j) => j.machineId));
  });
});

describe("capacity alert", () => {
  function overloaded() {
    const w = createWorld(7);
    for (const m of w.machines) if (!m.support) m.load = 0.95;
    for (let i = 0; i < TICKS_PER_HOUR; i++) step(w);
    for (const m of w.machines) if (!m.support) m.load = 0.95;
    w.history = w.history.map((r) => ({ ...r, missed: 1 }));
    return w;
  }

  it("offers commissioning while there is room for another machine", () => {
    const alert = computeAlerts(overloaded(), null).find((a) => a.id === "capacity-shortfall");
    expect(alert?.canCommission).toBe(true);
  });

  it("stops offering it once the limit is reached", () => {
    const w = overloaded();
    for (let i = 0; i < MAX_COMMISSIONED; i++) commissionMachine(w);
    for (const m of w.machines) if (!m.support) m.load = 0.95;
    const alert = computeAlerts(w, null).find((a) => a.id === "capacity-shortfall");
    expect(alert?.canCommission).toBe(false);
  });
});
