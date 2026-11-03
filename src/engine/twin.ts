// Factory Digital Twin: simulated IoT machines, edge/cloud compute, grid and job queue.
// Physics-lite, seeded and deterministic when `deterministic` is set (used for rollouts).

export const TICKS_PER_HOUR = 6; // one tick = 10 simulated minutes
export const HORIZON = 36; // 6 hours
export const START_HOUR = 14;

export type MachineKind =
  "cnc" | "press" | "furnace" | "conveyor" | "packaging" | "compressor" | "chiller" | "robot";
export type MachineStatus = "running" | "idle" | "slowed" | "boosted" | "maintenance" | "failed";

export interface Machine {
  id: string;
  name: string;
  kind: MachineKind;
  support: boolean;
  basePower: number; // kW at full load
  rate: number; // work units per tick at load 1
  power: number;
  temp: number;
  vibration: number;
  health: number;
  load: number;
  throughput: number;
  status: MachineStatus;
  speed: number;
  downTicks: number;
  failProb: number;
  /** Human speed setting. While active the agents may not change this machine's speed. */
  hold?: { speed: number; until: number };
}

export interface ComputeNode {
  id: string;
  name: string;
  kind: "edge" | "cloud";
  capacity: number;
  used: number;
  latency: number; // ms
  energyPerUnit: number; // kW per compute unit
  carbon: number; // gCO2/kWh, cloud only (edge uses grid)
  online: boolean;
}

export interface Workload {
  id: string;
  name: string;
  demand: number;
  nodeId: string;
  sensitivity: number; // latency sensitivity 0..1
  sourceMachine: string;
  effectiveNode: string;
  latency: number;
}

export interface Job {
  id: string;
  name: string;
  machineId: string;
  work: number;
  remaining: number;
  deadline: number;
  priority: 1 | 2 | 3;
  energy: number;
  flexible: boolean;
  deferredUntil: number;
  createdAt: number;
  done: boolean;
  missed: boolean;
}

export type EventKind =
  | "carbonSpike"
  | "heatwave"
  | "machineFault"
  | "rushOrder"
  | "cloudOutage"
  | "priceSurge"
  | "supplyDelay";

export interface ActiveEvent {
  id: string;
  kind: EventKind;
  start: number;
  until: number;
  targetId?: string;
  label: string;
}

export interface TickMetrics {
  tick: number;
  kwh: number;
  carbonKg: number;
  cost: number;
  latency: number;
  throughput: number;
  downtime: number;
  missed: number;
  completed: number;
  gridCarbon: number;
  price: number;
  ambient: number;
  avgHealth: number;
  defects: number;
  safetyRisk: number;
}

export interface Totals {
  kwh: number;
  carbonKg: number;
  cost: number;
  downtime: number;
  missed: number;
  completed: number;
  onTime: number;
  expectedDowntime: number;
}

export interface World {
  tick: number;
  seed: number;
  rng: number;
  deterministic: boolean;
  machines: Machine[];
  nodes: ComputeNode[];
  workloads: Workload[];
  jobs: Job[];
  events: ActiveEvent[];
  services: { machineId: string; at: number }[];
  jobCounter: number;
  eventCounter: number;
  totals: Totals;
  history: TickMetrics[];
}

export type Action =
  | { kind: "throttle"; machineId: string; speed: number }
  | { kind: "defer"; jobId: string; until: number }
  | { kind: "service"; machineId: string; at: number }
  | { kind: "offload"; workloadId: string; nodeId: string }
  | { kind: "expedite"; jobId: string; boost: number };

export const zeroTotals = (): Totals => ({
  kwh: 0,
  carbonKg: 0,
  cost: 0,
  downtime: 0,
  missed: 0,
  completed: 0,
  onTime: 0,
  expectedDowntime: 0,
});

export function rand(w: World): number {
  if (w.deterministic) return 0.5;
  let t = (w.rng = (w.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function hourOf(tick: number): number {
  return (START_HOUR + tick / TICKS_PER_HOUR) % 24;
}

export function clockLabel(tick: number): string {
  const total = Math.round(hourOf(tick) * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function gridProfile(w: World, tick: number) {
  const h = hourOf(tick);
  const solar = Math.max(0, Math.sin((Math.PI * (h - 6)) / 12));
  const evening = Math.exp(-((h - 19) ** 2) / 4);
  const wind = 0.5 + 0.5 * Math.sin(tick / 37 + (w.seed % 7));
  let carbon = 430 - 170 * solar + 150 * evening - 70 * wind;
  let price = 0.11 + 0.1 * evening - 0.03 * solar;
  let ambient = 22 + 7 * Math.sin((Math.PI * (h - 9)) / 12);
  for (const e of w.events) {
    if (tick < e.start || tick >= e.until) continue;
    if (e.kind === "carbonSpike") carbon *= 1.85;
    if (e.kind === "priceSurge") price *= 2.5;
    if (e.kind === "heatwave") ambient += 13;
  }
  return { carbon, price, ambient };
}

const PRODUCTION = ["cnc", "press", "furnace", "packaging", "robot"];

export function makeJob(w: World, rush = false): Job {
  // Commissioned machines join the pool after the original five, so a seeded run without
  // commissioning draws exactly the same sequence as before.
  const pool = [
    ...PRODUCTION,
    ...w.machines.filter((x) => !x.support && !PRODUCTION.includes(x.id)).map((x) => x.id),
  ];
  const machineId = pool[Math.floor(rand(w) * pool.length) % pool.length]!;
  const m = w.machines.find((x) => x.id === machineId)!;
  const work = 6 + rand(w) * 10;
  const slack = rush ? 4 + rand(w) * 4 : 6 + rand(w) * 30;
  w.jobCounter += 1;
  return {
    id: `J${w.jobCounter}`,
    name: `J${w.jobCounter}`,
    machineId,
    work,
    remaining: work,
    deadline: Math.round(w.tick + work / 0.9 + slack),
    priority: rush ? 3 : ((1 + Math.floor(rand(w) * 2)) as 1 | 2),
    energy: (m.basePower * work) / TICKS_PER_HOUR,
    flexible: !rush && rand(w) < 0.55,
    deferredUntil: 0,
    createdAt: w.tick,
    done: false,
    missed: false,
  };
}

function machine(
  id: string,
  name: string,
  kind: MachineKind,
  basePower: number,
  health: number,
  support = false,
): Machine {
  return {
    id,
    name,
    kind,
    support,
    basePower,
    rate: 1,
    power: 0,
    temp: 25,
    vibration: 1,
    health,
    load: 0,
    throughput: 0,
    status: "idle",
    speed: 1,
    downTicks: 0,
    failProb: 0,
  };
}

export function createWorld(seed: number): World {
  const w: World = {
    tick: 0,
    seed,
    rng: seed | 0,
    deterministic: false,
    machines: [
      machine("cnc", "CNC", "cnc", 45, 88),
      machine("press", "Press", "press", 60, 52),
      machine("robot", "Robotic Arm", "robot", 18, 91),
      machine("furnace", "Furnace", "furnace", 140, 74),
      machine("packaging", "Packaging", "packaging", 25, 83),
      machine("conveyor", "Conveyor", "conveyor", 12, 79, true),
      machine("compressor", "Compressor", "compressor", 35, 66, true),
      machine("chiller", "Chiller", "chiller", 40, 85, true),
    ],
    nodes: [
      {
        id: "edge-a",
        name: "Edge A",
        kind: "edge",
        capacity: 10,
        used: 0,
        latency: 6,
        energyPerUnit: 1.2,
        carbon: 0,
        online: true,
      },
      {
        id: "edge-b",
        name: "Edge B",
        kind: "edge",
        capacity: 10,
        used: 0,
        latency: 7,
        energyPerUnit: 1.2,
        carbon: 0,
        online: true,
      },
      {
        id: "edge-c",
        name: "Edge C",
        kind: "edge",
        capacity: 8,
        used: 0,
        latency: 8,
        energyPerUnit: 1.3,
        carbon: 0,
        online: true,
      },
      {
        id: "cloud",
        name: "Cloud Cluster",
        kind: "cloud",
        capacity: 40,
        used: 0,
        latency: 48,
        energyPerUnit: 0.7,
        carbon: 190,
        online: true,
      },
    ],
    workloads: [
      {
        id: "vision",
        name: "Vision inference",
        demand: 6,
        nodeId: "edge-a",
        sensitivity: 1,
        sourceMachine: "robot",
        effectiveNode: "edge-a",
        latency: 0,
      },
      {
        id: "telemetry",
        name: "Telemetry aggregation",
        demand: 3,
        nodeId: "edge-a",
        sensitivity: 0.5,
        sourceMachine: "conveyor",
        effectiveNode: "edge-a",
        latency: 0,
      },
      {
        id: "predictive",
        name: "Predictive analytics",
        demand: 5,
        nodeId: "edge-b",
        sensitivity: 0.2,
        sourceMachine: "press",
        effectiveNode: "edge-b",
        latency: 0,
      },
      {
        id: "quality",
        name: "Quality analytics",
        demand: 4,
        nodeId: "edge-b",
        sensitivity: 0.6,
        sourceMachine: "packaging",
        effectiveNode: "edge-b",
        latency: 0,
      },
      {
        id: "scheduler",
        name: "Schedule optimizer",
        demand: 4,
        nodeId: "edge-c",
        sensitivity: 0.3,
        sourceMachine: "cnc",
        effectiveNode: "edge-c",
        latency: 0,
      },
    ],
    jobs: [],
    events: [],
    services: [],
    jobCounter: 0,
    eventCounter: 0,
    totals: zeroTotals(),
    history: [],
  };
  for (let i = 0; i < 9; i++) w.jobs.push(makeJob(w));
  return w;
}

export function addEvent(
  w: World,
  kind: EventKind,
  duration: number,
  label: string,
  targetId?: string,
) {
  w.eventCounter += 1;
  w.events.push({
    id: `E${w.eventCounter}`,
    kind,
    start: w.tick,
    until: w.tick + duration,
    label,
    ...(targetId !== undefined ? { targetId } : {}),
  });
}

export function activeJob(w: World, m: Machine): Job | undefined {
  let best: Job | undefined;
  for (const j of w.jobs) {
    if (j.machineId !== m.id || j.done || j.deferredUntil > w.tick || j.createdAt > w.tick)
      continue;
    if (
      !best ||
      j.priority > best.priority ||
      (j.priority === best.priority && j.deadline < best.deadline)
    )
      best = j;
  }
  return best;
}

function startService(m: Machine) {
  m.status = "maintenance";
  m.downTicks = 3;
  m.load = 0;
}

function physics(w: World, m: Machine, ambient: number) {
  const heatK = m.kind === "furnace" ? 1.7 : m.kind === "chiller" ? 0.3 : 1;
  m.temp += (ambient + 55 * m.load * heatK - m.temp) * 0.25;
  if (m.downTicks > 0) m.power = m.basePower * (m.status === "maintenance" ? 0.1 : 0.05);
  else m.power = m.basePower * (0.15 + 0.85 * m.load);
  if (m.downTicks === 0) {
    const wear = 0.03 + 0.35 * m.load * m.load + Math.max(0, m.temp - 85) * 0.012;
    m.health = Math.max(0, m.health - wear);
  }
  m.vibration =
    0.6 + (100 - m.health) * 0.07 + m.load * 0.9 + (w.deterministic ? 0 : (rand(w) - 0.5) * 0.4);
  m.failProb = m.downTicks > 0 ? 0 : 0.08 / (1 + Math.exp(-(m.vibration - 6.5) * 1.5));
  if (m.downTicks === 0) {
    if (m.health <= 0 || (!w.deterministic && rand(w) < m.failProb)) {
      m.status = "failed";
      m.downTicks = 12;
    } else if (w.deterministic) {
      w.totals.expectedDowntime += m.failProb * 12;
    }
  }
  m.throughput = m.downTicks > 0 ? 0 : m.load * m.rate;
  if (m.downTicks === 0) {
    m.status =
      m.load < 0.1 ? "idle" : m.speed < 0.95 ? "slowed" : m.speed > 1.05 ? "boosted" : "running";
  }
}

export function step(w: World): TickMetrics {
  const t = w.tick;
  w.events = w.events.filter((e) => e.until > t);
  const cloud = w.nodes.find((n) => n.kind === "cloud")!;
  cloud.online = !w.events.some((e) => e.kind === "cloudOutage");
  const g = gridProfile(w, t);
  const carbon = g.carbon * (1 + (rand(w) - 0.5) * 0.12);
  if (!w.deterministic && rand(w) < 0.006)
    addEvent(w, "carbonSpike", 6, "Random grid carbon spike");

  w.services = w.services.filter((s) => {
    if (s.at > t) return true;
    const m = w.machines.find((x) => x.id === s.machineId);
    if (m && m.downTicks === 0) startService(m);
    return false;
  });

  let completed = 0;
  let prodLoad = 0;
  let prodCount = 0;
  for (const m of w.machines) {
    if (m.downTicks > 0) {
      m.downTicks -= 1;
      if (m.downTicks === 0) {
        if (m.status === "maintenance") m.health = 97;
        else m.health = Math.max(m.health, 60);
        m.status = "idle";
      }
    }
  }
  for (const m of w.machines) {
    if (m.support) continue;
    const job = m.downTicks > 0 ? undefined : activeJob(w, m);
    m.load = m.downTicks > 0 ? 0 : job ? m.speed : 0.08;
    physics(w, m, g.ambient);
    prodLoad += m.load;
    prodCount += 1;
    if (job && m.throughput > 0) {
      job.remaining -= m.throughput;
      if (job.remaining <= 0) {
        job.done = true;
        completed += 1;
        w.totals.completed += 1;
        if (t <= job.deadline) w.totals.onTime += 1;
      }
    }
  }
  const avgLoad = prodLoad / Math.max(1, prodCount);
  for (const m of w.machines) {
    if (!m.support) continue;
    let load = avgLoad * 0.9;
    if (m.kind === "chiller")
      load = Math.min(1.3, avgLoad * 0.7 + Math.max(0, g.ambient - 22) / 25);
    m.load = m.downTicks > 0 ? 0 : Math.min(1.3, load * m.speed);
    physics(w, m, g.ambient);
  }

  let missed = 0;
  for (const j of w.jobs) {
    if (!j.done && !j.missed && t > j.deadline) {
      j.missed = true;
      missed += 1;
      w.totals.missed += 1;
    }
  }
  if (!w.deterministic && rand(w) < 0.1) w.jobs.push(makeJob(w));
  if (w.jobs.length > 40)
    w.jobs = w.jobs.filter((j) => !(j.done || j.missed) || t - j.deadline < 12);

  for (const n of w.nodes) n.used = 0;
  const edgeA = w.nodes[0]!;
  for (const wl of w.workloads) {
    const n = w.nodes.find((x) => x.id === wl.nodeId)!;
    const eff = n.online ? n : edgeA;
    wl.effectiveNode = eff.id;
    eff.used += wl.demand;
  }
  let edgeKwh = 0;
  let cloudKwh = 0;
  let latSum = 0;
  let latW = 0;
  for (const wl of w.workloads) {
    const n = w.nodes.find((x) => x.id === wl.effectiveNode)!;
    const failover = wl.effectiveNode !== wl.nodeId ? 80 : 0;
    wl.latency = n.latency + Math.max(0, n.used - n.capacity) * 12 + failover;
    const kwh = (wl.demand * n.energyPerUnit) / TICKS_PER_HOUR;
    if (n.kind === "cloud") cloudKwh += kwh;
    else edgeKwh += kwh;
    latSum += wl.latency * wl.sensitivity;
    latW += wl.sensitivity;
  }
  const factoryKwh = w.machines.reduce((s, m) => s + m.power, 0) / TICKS_PER_HOUR;
  const kwh = factoryKwh + edgeKwh + cloudKwh;
  const carbonKg = ((factoryKwh + edgeKwh) * carbon + cloudKwh * cloud.carbon) / 1000;
  const cost = (factoryKwh + edgeKwh) * g.price + cloudKwh * 0.14;
  const downtime = w.machines.filter((m) => m.status === "failed").length;
  let defects = 0;
  let safetyRisk = 0;
  for (const m of w.machines) {
    if (m.downTicks === 0 && m.load > 0.05) {
      const wear = (100 - m.health) / 100;
      const heat = Math.max(0, m.temp - 92) / 50;
      const rush = m.speed > 1.05 ? 0.12 : 0;
      defects += m.load * (0.55 * wear + 0.35 * heat + rush);
    }
    safetyRisk +=
      Math.max(0, (m.temp - 102) / 16) +
      Math.max(0, (38 - m.health) / 38) +
      Math.max(0, (m.vibration - 7) / 2.5);
  }
  const metrics: TickMetrics = {
    tick: t,
    kwh,
    carbonKg,
    cost,
    latency: latSum / Math.max(0.01, latW),
    throughput: w.machines.reduce((s, m) => s + (m.support ? 0 : m.throughput), 0),
    downtime,
    missed,
    completed,
    gridCarbon: carbon,
    price: g.price,
    ambient: g.ambient,
    avgHealth: w.machines.reduce((s, m) => s + m.health, 0) / w.machines.length,
    defects,
    safetyRisk,
  };
  w.totals.kwh += kwh;
  w.totals.carbonKg += carbonKg;
  w.totals.cost += cost;
  w.totals.downtime += downtime;
  if (!w.deterministic) {
    w.history.push(metrics);
    if (w.history.length > 300) w.history.shift();
  }
  w.tick += 1;
  return metrics;
}

export function applyAction(w: World, a: Action) {
  if (a.kind === "throttle") {
    const m = w.machines.find((x) => x.id === a.machineId);
    if (m && !isHeld(w, m)) m.speed = a.speed;
  } else if (a.kind === "defer") {
    const j = w.jobs.find((x) => x.id === a.jobId);
    if (j) j.deferredUntil = a.until;
  } else if (a.kind === "service") {
    const m = w.machines.find((x) => x.id === a.machineId);
    if (!m) return;
    if (a.at <= w.tick) {
      if (m.downTicks === 0) startService(m);
    } else w.services.push({ machineId: a.machineId, at: a.at });
  } else if (a.kind === "offload") {
    const wl = w.workloads.find((x) => x.id === a.workloadId);
    if (wl) wl.nodeId = a.nodeId;
  } else if (a.kind === "expedite") {
    const j = w.jobs.find((x) => x.id === a.jobId);
    if (!j) return;
    j.deferredUntil = 0;
    j.priority = 3;
    const m = w.machines.find((x) => x.id === j.machineId);
    if (m && !isHeld(w, m)) m.speed = a.boost;
  }
}

/** Ticks a dispatched repair crew needs to bring a failed machine back (an unaided outage is 12). */
export const CREW_REPAIR_TICKS = 4;

/**
 * Human override: send a repair crew to a failed machine. Shortens the outage to
 * CREW_REPAIR_TICKS and brings the machine back at 80% health or better.
 * Returns false (and changes nothing) if the machine is missing or not failed.
 */
export function dispatchRepair(w: World, machineId: string): boolean {
  const m = w.machines.find((x) => x.id === machineId);
  if (!m || m.status !== "failed") return false;
  m.downTicks = Math.min(m.downTicks, CREW_REPAIR_TICKS);
  m.health = Math.max(m.health, 80);
  return true;
}

/** How many extra machines the line can have commissioned on top of the original eight. */
export const MAX_COMMISSIONED = 2;

export function commissionedCount(w: World): number {
  return w.machines.filter((m) => !m.support && !PRODUCTION.includes(m.id)).length;
}

export function canCommissionMachine(w: World): boolean {
  return commissionedCount(w) < MAX_COMMISSIONED;
}

/**
 * Human override: commission an additional CNC machine. It starts new and idle, and takes every
 * second waiting CNC job that has not started, so the extra capacity helps straight away.
 * Returns the new machine, or null once MAX_COMMISSIONED is reached.
 */
export function commissionMachine(w: World): Machine | null {
  if (!canCommissionMachine(w)) return null;
  const n = commissionedCount(w) + 2; // "CNC 2", "CNC 3"
  const added = machine(`cnc-${n}`, `CNC ${n}`, "cnc", 45, 100);
  w.machines.push(added);
  const waiting = w.jobs.filter((j) => j.machineId === "cnc" && !j.done && j.remaining === j.work);
  waiting.forEach((j, i) => {
    if (i % 2 === 1) j.machineId = added.id;
  });
  return added;
}

/** How long a human speed setting stays in force before the agents may change it again. */
export const HUMAN_HOLD_TICKS = TICKS_PER_HOUR * 3;
export const HOLD_MIN_SPEED = 0.3;
export const HOLD_MAX_SPEED = 1.3;

/** True while a human speed setting is in force on this machine. */
export function isHeld(w: World, m: Machine): boolean {
  return m.hold !== undefined && w.tick < m.hold.until;
}

/**
 * Human override: pin a machine's speed so agent decision cycles cannot undo it.
 * Speed 1 releases the hold. Returns false if the machine does not exist.
 */
export function holdThrottle(
  w: World,
  machineId: string,
  speed: number,
  ticks = HUMAN_HOLD_TICKS,
): boolean {
  const m = w.machines.find((x) => x.id === machineId);
  if (!m) return false;
  const clamped = Math.min(HOLD_MAX_SPEED, Math.max(HOLD_MIN_SPEED, speed));
  if (clamped === 1) delete m.hold;
  else m.hold = { speed: clamped, until: w.tick + ticks };
  m.speed = clamped;
  return true;
}

/** Reverts per-decision setpoints (speeds, pending services) before a new decision cycle. Human holds survive. */
export function resetTransient(w: World) {
  for (const m of w.machines) {
    if (m.hold && w.tick >= m.hold.until) delete m.hold;
    m.speed = m.hold ? m.hold.speed : 1;
  }
  w.services = [];
}

export function actionTarget(a: Action): string {
  if (a.kind === "throttle" || a.kind === "service") return `m:${a.machineId}`;
  if (a.kind === "offload") return `w:${a.workloadId}`;
  return `j:${a.jobId}`;
}

export function describeAction(w: World, a: Action): string {
  const mName = (id: string) => w.machines.find((m) => m.id === id)?.name ?? id;
  if (a.kind === "throttle") {
    if (a.speed === 1) return `restore ${mName(a.machineId)} to full speed`;
    if (a.speed > 1) return `boost ${mName(a.machineId)} ${Math.round((a.speed - 1) * 100)}%`;
    return `slow ${mName(a.machineId)} ${Math.round((1 - a.speed) * 100)}%`;
  }
  if (a.kind === "defer") return `delay job ${a.jobId} to ${clockLabel(a.until)}`;
  if (a.kind === "service")
    return a.at <= w.tick
      ? `service ${mName(a.machineId)} now`
      : `service ${mName(a.machineId)} at ${clockLabel(a.at)}`;
  if (a.kind === "offload") {
    const wl = w.workloads.find((x) => x.id === a.workloadId);
    const n = w.nodes.find((x) => x.id === a.nodeId);
    return `move ${wl?.name.toLowerCase() ?? a.workloadId} to ${n?.name ?? a.nodeId}`;
  }
  const j = w.jobs.find((x) => x.id === a.jobId);
  return `expedite job ${a.jobId} on ${mName(j?.machineId ?? "")} (+${Math.round((a.boost - 1) * 100)}%)`;
}
