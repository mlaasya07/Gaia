// Scenario event injection. Each event mutates the world deterministically from its seed.
import { addEvent, makeJob, rand, type EventKind, type World } from "@/engine/twin";

export const EVENT_DEFS: { kind: EventKind; label: string; hint: string }[] = [
  { kind: "carbonSpike", label: "Grid carbon spike", hint: "Grid intensity ×1.85 for 3h" },
  { kind: "heatwave", label: "Heatwave", hint: "Ambient +13°C for 6h" },
  { kind: "machineFault", label: "Machine fault", hint: "Selected machine loses 35 health" },
  { kind: "rushOrder", label: "Rush order", hint: "High-priority job, tight deadline" },
  { kind: "cloudOutage", label: "Cloud outage", hint: "Cloud offline for 3h, edge failover" },
  { kind: "priceSurge", label: "Energy price surge", hint: "Price ×2.5 for 3h" },
  { kind: "supplyDelay", label: "Supply delay", hint: "A queued job is blocked for 2h" },
];

export function injectEvent(w: World, kind: EventKind, targetId?: string): string {
  if (kind === "carbonSpike") addEvent(w, kind, 18, "Grid carbon spike");
  else if (kind === "heatwave") addEvent(w, kind, 36, "Heatwave");
  else if (kind === "priceSurge") addEvent(w, kind, 18, "Energy price surge");
  else if (kind === "cloudOutage") addEvent(w, kind, 18, "Cloud outage");
  else if (kind === "machineFault") {
    const m = w.machines.find((x) => x.id === targetId) ?? w.machines[1]!;
    m.health = Math.max(5, m.health - 35);
    m.vibration += 2;
    addEvent(w, kind, 6, `Fault on ${m.name}`, m.id);
  } else if (kind === "rushOrder") {
    const j = makeJob(w, true);
    w.jobs.push(j);
    addEvent(w, kind, 6, `Rush order ${j.id}`, j.id);
  } else if (kind === "supplyDelay") {
    const open = w.jobs.filter((j) => !j.done && !j.missed);
    const j = open[Math.floor(rand(w) * open.length) % Math.max(1, open.length)];
    if (j) {
      j.deferredUntil = w.tick + 12;
      addEvent(w, kind, 12, `Supply delay on ${j.id}`, j.id);
    }
  }
  return w.events[w.events.length - 1]?.label ?? kind;
}
