// World Model: 6h forecasts via physics rollouts, corrected by exponential smoothing
// of bias plus an online linear-regression residual, with confidence bands.
import {
  HORIZON,
  applyAction,
  gridProfile,
  hourOf,
  step,
  zeroTotals,
  type Action,
  type MachineStatus,
  type TickMetrics,
  type World,
} from "./twin";

export const SERIES = ["kwh", "carbonKg", "latency", "throughput"] as const;
export type SeriesKey = (typeof SERIES)[number];

export interface Frame {
  tick: number;
  m: TickMetrics;
  machines: {
    id: string;
    health: number;
    load: number;
    temp: number;
    power: number;
    failProb: number;
    status: MachineStatus;
  }[];
}

export interface Summary {
  kwh: number;
  carbonKg: number;
  cost: number;
  downtime: number;
  missed: number;
  throughput: number;
  latency: number;
  healthDeficit: number;
  minHealth: number;
  maxTemp: number;
  defects: number;
  safetyRisk: number;
}

export function cloneWorld(w: World, keepHistory = false): World {
  return structuredClone({ ...w, history: keepHistory ? w.history : [] });
}

export function rollout(w: World, actions: Action[], horizon = HORIZON, keepFrames = false) {
  const c = cloneWorld(w);
  c.deterministic = true;
  c.totals = zeroTotals();
  for (const a of actions) applyAction(c, a);
  const frames: Frame[] = [];
  let lat = 0;
  let minHealth = 100;
  let maxTemp = 0;
  let defects = 0;
  let safetyRisk = 0;
  for (let i = 0; i < horizon; i++) {
    const m = step(c);
    lat += m.latency;
    defects += m.defects;
    safetyRisk += m.safetyRisk;
    for (const x of c.machines) {
      if (x.health < minHealth) minHealth = x.health;
      if (x.temp > maxTemp) maxTemp = x.temp;
    }
    if (keepFrames)
      frames.push({
        tick: m.tick,
        m,
        machines: c.machines.map((x) => ({
          id: x.id,
          health: x.health,
          load: x.load,
          temp: x.temp,
          power: x.power,
          failProb: x.failProb,
          status: x.status,
        })),
      });
  }
  let atRisk = 0;
  for (const j of c.jobs) {
    if (j.done || j.missed) continue;
    const m = c.machines.find((x) => x.id === j.machineId)!;
    const start = Math.max(c.tick, j.deferredUntil);
    if (start + j.remaining / Math.max(0.3, m.speed) > j.deadline)
      atRisk += j.priority === 3 ? 1.5 : 1;
  }
  const summary: Summary = {
    kwh: c.totals.kwh,
    carbonKg: c.totals.carbonKg,
    cost: c.totals.cost,
    downtime: c.totals.downtime + c.totals.expectedDowntime,
    missed: c.totals.missed + atRisk,
    throughput: frames.length ? frames.reduce((s, f) => s + f.m.throughput, 0) : 0,
    latency: lat / horizon,
    healthDeficit: c.machines.reduce((s, x) => s + (100 - x.health), 0) / c.machines.length,
    minHealth,
    maxTemp,
    defects,
    safetyRisk,
  };
  if (!keepFrames) summary.throughput = c.machines.length ? estimateThroughput(w, c) : 0;
  return { summary, frames, end: c };
}

function estimateThroughput(start: World, end: World): number {
  const doneBefore = start.jobs.reduce((s, j) => s + (j.work - Math.max(0, j.remaining)), 0);
  const doneAfter = end.jobs.reduce((s, j) => s + (j.work - Math.max(0, j.remaining)), 0);
  return doneAfter - doneBefore;
}

interface SeriesModel {
  bias: number;
  w: number[];
  rmse: number;
  scale: number;
}

interface Pending {
  tick: number;
  kind: 1 | 6;
  phys: Record<SeriesKey, number>;
  pred: Record<SeriesKey, number>;
  x: Record<SeriesKey, number[]>;
}

export interface WorldModel {
  s: Record<SeriesKey, SeriesModel>;
  pending: Pending[];
  ema1: number;
  ema6: number;
  emaPhys: number;
  errorHistory: { tick: number; mape1: number; mape6: number; physMape: number }[];
}

export interface Forecast {
  fromTick: number;
  frames: Frame[];
  series: Record<SeriesKey, { mean: number[]; lo: number[]; hi: number[] }>;
  machineRisk: { id: string; maxFailProb: number; minHealth: number }[];
  jobRisk: { jobId: string; risk: number }[];
  summary: Summary;
}

export function createWorldModel(): WorldModel {
  const s = {} as Record<SeriesKey, SeriesModel>;
  for (const k of SERIES) s[k] = { bias: 0, w: [0, 0, 0, 0, 0], rmse: 0.1, scale: 1 };
  return { s, pending: [], ema1: 0.15, ema6: 0.2, emaPhys: 0.15, errorHistory: [] };
}

function features(w: World, tick: number, phys: number, scale: number): number[] {
  const h = hourOf(tick);
  return [
    1,
    Math.sin((2 * Math.PI * h) / 24),
    Math.cos((2 * Math.PI * h) / 24),
    gridProfile(w, tick).carbon / 500,
    phys / Math.max(1e-6, scale),
  ];
}

function predictOne(model: SeriesModel, phys: number, x: number[]): number {
  let r = 0;
  for (let i = 0; i < x.length; i++) r += model.w[i]! * x[i]!;
  return Math.max(0, phys * (1 + model.bias) + r * model.scale);
}

/** Applies learned bias correction to a rollout summary so agents see the corrected future. */
export function correctSummary(wm: WorldModel, s: Summary): Summary {
  return {
    ...s,
    kwh: s.kwh * (1 + wm.s.kwh.bias),
    carbonKg: s.carbonKg * (1 + wm.s.carbonKg.bias),
    cost: s.cost * (1 + wm.s.kwh.bias),
    latency: s.latency * (1 + wm.s.latency.bias),
  };
}

export function forecast(wm: WorldModel, w: World, actions: Action[] = []): Forecast {
  const r = rollout(w, actions, HORIZON, true);
  const series = {} as Forecast["series"];
  for (const k of SERIES) {
    const model = wm.s[k];
    const mean: number[] = [];
    const lo: number[] = [];
    const hi: number[] = [];
    r.frames.forEach((f, i) => {
      const phys = f.m[k];
      const p = predictOne(model, phys, features(w, f.tick, phys, model.scale));
      const band = model.rmse * model.scale * Math.sqrt(i + 1) * 1.96;
      mean.push(p);
      lo.push(Math.max(0, p - band));
      hi.push(p + band);
    });
    series[k] = { mean, lo, hi };
  }
  const machineRisk = w.machines.map((m) => {
    let maxFailProb = 0;
    let minHealth = 100;
    for (const f of r.frames) {
      const x = f.machines.find((y) => y.id === m.id)!;
      maxFailProb = Math.max(maxFailProb, x.failProb);
      minHealth = Math.min(minHealth, x.health);
    }
    return { id: m.id, maxFailProb, minHealth };
  });
  const jobRisk = r.end.jobs
    .filter((j) => !j.done && !j.missed)
    .map((j) => {
      const slack = j.deadline - Math.max(r.end.tick, j.deferredUntil) - j.remaining;
      return { jobId: j.id, risk: 1 / (1 + Math.exp(slack / 3)) };
    });
  return {
    fromTick: w.tick,
    frames: r.frames,
    series,
    machineRisk,
    jobRisk,
    summary: correctSummary(wm, r.summary),
  };
}

export function recordPending(wm: WorldModel, w: World, fc: Forecast) {
  for (const [idx, kind] of [
    [0, 1],
    [5, 6],
  ] as const) {
    const f = fc.frames[idx];
    if (!f) continue;
    const phys = {} as Record<SeriesKey, number>;
    const pred = {} as Record<SeriesKey, number>;
    const x = {} as Record<SeriesKey, number[]>;
    for (const k of SERIES) {
      phys[k] = f.m[k];
      pred[k] = fc.series[k].mean[idx]!;
      x[k] = features(w, f.tick, f.m[k], wm.s[k].scale);
    }
    wm.pending.push({ tick: f.tick, kind, phys, pred, x });
  }
}

/** Online update: exponential smoothing of bias + normalized LMS on the residual. */
export function observe(wm: WorldModel, actual: TickMetrics) {
  const due = wm.pending.filter((p) => p.tick === actual.tick);
  wm.pending = wm.pending.filter((p) => p.tick > actual.tick);
  for (const p of due) {
    let ape = 0;
    let physApe = 0;
    for (const k of SERIES) {
      const a = actual[k];
      const denom = Math.max(1e-3, Math.abs(a));
      ape += Math.min(1, Math.abs(a - p.pred[k]) / denom);
      physApe += Math.min(1, Math.abs(a - p.phys[k]) / denom);
      if (p.kind !== 1) continue;
      const m = wm.s[k];
      m.scale = m.scale === 1 ? Math.max(1e-3, Math.abs(a)) : 0.98 * m.scale + 0.02 * Math.abs(a);
      const ratio = p.phys[k] > 1e-6 ? a / p.phys[k] - 1 : 0;
      m.bias += 0.12 * (Math.max(-0.8, Math.min(0.8, ratio)) - m.bias);
      const e = (a - p.pred[k]) / m.scale;
      const xx = p.x[k].reduce((s, v) => s + v * v, 0);
      for (let i = 0; i < m.w.length; i++) m.w[i]! += (0.05 * e * p.x[k]![i]!) / (1 + xx);
      m.rmse = Math.sqrt(0.92 * m.rmse * m.rmse + 0.08 * e * e);
    }
    ape /= SERIES.length;
    physApe /= SERIES.length;
    if (p.kind === 1) {
      wm.ema1 = 0.9 * wm.ema1 + 0.1 * ape;
      wm.emaPhys = 0.9 * wm.emaPhys + 0.1 * physApe;
    } else wm.ema6 = 0.9 * wm.ema6 + 0.1 * ape;
  }
  wm.errorHistory.push({ tick: actual.tick, mape1: wm.ema1, mape6: wm.ema6, physMape: wm.emaPhys });
  if (wm.errorHistory.length > 300) wm.errorHistory.shift();
}
