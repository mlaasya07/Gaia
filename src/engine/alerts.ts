// Alert rules: turn live twin state, recent history and agent forecasts into
// operator notifications for the factory dashboard.
import { TICKS_PER_HOUR, canCommissionMachine, type World } from "./twin";
import type { Forecast } from "./worldModel";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertKind = "repair" | "overheat" | "capacity" | "failureRisk";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  kind: AlertKind;
  title: string;
  detail: string;
  source: string;
  machineId?: string;
  canThrottle: boolean;
  canService: boolean;
  canRepair: boolean;
  canCommission: boolean;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function computeAlerts(world: World, forecast: Forecast | null): Alert[] {
  const alerts: Alert[] = [];

  for (const m of world.machines) {
    if (m.status === "failed") {
      alerts.push({
        id: `repair-failed-${m.id}`,
        severity: "critical",
        kind: "repair",
        title: `${m.name} failed and is stopped`,
        detail: `Repair crew required. Down for ${m.downTicks} ticks so far; dispatching a crew shortens the outage.`,
        source: "Maintenance agent",
        machineId: m.id,
        canThrottle: false,
        canService: false,
        canRepair: true,
        canCommission: false,
      });
      continue;
    }
    if (m.temp >= 100) {
      alerts.push({
        id: `overheat-hot-${m.id}`,
        severity: "critical",
        kind: "overheat",
        title: `${m.name} is overheating: ${m.temp.toFixed(0)}°C`,
        detail: "Human intervention required. Throttle to 80% or dispatch service before it fails.",
        source: "Safety agent",
        machineId: m.id,
        canThrottle: true,
        canService: true,
        canRepair: false,
        canCommission: false,
      });
    } else if (m.temp >= 92 && m.load > 0.05) {
      alerts.push({
        id: `overheat-warm-${m.id}`,
        severity: "warning",
        kind: "overheat",
        title: `${m.name} running hot: ${m.temp.toFixed(0)}°C`,
        detail: "Approaching the thermal limit. Consider throttling or easing its load.",
        source: "Safety agent",
        machineId: m.id,
        canThrottle: true,
        canService: false,
        canRepair: false,
        canCommission: false,
      });
    }
    if (m.downTicks === 0 && m.health < 40) {
      alerts.push({
        id: `repair-worn-${m.id}`,
        severity: "warning",
        kind: "repair",
        title: `${m.name} health at ${m.health.toFixed(0)}%`,
        detail: "Wear is high. Schedule service before a forced outage stops the line.",
        source: "Maintenance agent",
        machineId: m.id,
        canThrottle: false,
        canService: true,
        canRepair: false,
        canCommission: false,
      });
    }
  }

  if (forecast) {
    for (const r of forecast.machineRisk) {
      const m = world.machines.find((x) => x.id === r.id);
      if (!m || m.downTicks > 0) continue;
      if (r.maxFailProb > 0.02 && r.minHealth < 55) {
        alerts.push({
          id: `risk-${m.id}`,
          severity: "info",
          kind: "failureRisk",
          title: `${m.name} failure risk in the next 6h`,
          detail: `World model puts failure probability at ${(r.maxFailProb * 100).toFixed(0)}% with health falling to ${r.minHealth.toFixed(0)}%. Prebook service.`,
          source: "Maintenance agent",
          machineId: m.id,
          canThrottle: false,
          canService: true,
          canRepair: false,
          canCommission: false,
        });
      }
    }
  }

  // Capacity rule: sustained production load above what the line can absorb while deadlines slip.
  const recent = world.history.slice(-TICKS_PER_HOUR * 2);
  if (recent.length >= TICKS_PER_HOUR) {
    const prod = world.machines.filter((m) => !m.support);
    const prodLoad = prod.reduce((s, m) => s + m.load, 0) / Math.max(1, prod.length);
    const missedRecent = recent.reduce((s, r) => s + r.missed, 0);
    const downRecent = recent.reduce((s, r) => s + r.downtime, 0);
    if (prodLoad > 0.85 && missedRecent >= 2) {
      alerts.push({
        id: "capacity-shortfall",
        severity: "warning",
        kind: "capacity",
        title: "Demand is outgrowing the line: new machine required",
        detail: `Production load has run at ${(prodLoad * 100).toFixed(0)}% with ${missedRecent} missed jobs in the last 2h. Commissioning an additional machine adds capacity.`,
        source: "Production agent",
        canThrottle: false,
        canService: false,
        canRepair: false,
        canCommission: canCommissionMachine(world),
      });
    } else if (downRecent >= 8) {
      alerts.push({
        id: "capacity-outages",
        severity: "info",
        kind: "capacity",
        title: "Repeated outages: capacity review recommended",
        detail: `${downRecent} machine-down ticks in the last 2h. Review redundancy and spares for the affected assets.`,
        source: "Maintenance agent",
        canThrottle: false,
        canService: false,
        canRepair: false,
        canCommission: false,
      });
    }
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface AlertCounts {
  critical: number;
  warning: number;
  info: number;
  /** Alerts the person has not acknowledged yet. */
  open: number;
  total: number;
}

/** Counts alerts by severity. Acknowledged alerts still count in `total` but not in `open`. */
export function countAlerts(
  alerts: readonly Alert[],
  acknowledged: ReadonlySet<string> = new Set(),
): AlertCounts {
  const counts: AlertCounts = { critical: 0, warning: 0, info: 0, open: 0, total: alerts.length };
  for (const a of alerts) {
    if (acknowledged.has(a.id)) continue;
    counts[a.severity] += 1;
    counts.open += 1;
  }
  return counts;
}

/** Drops acknowledgements for alerts that no longer exist, so a returning problem alerts again. */
export function pruneAcknowledged(
  acknowledged: ReadonlySet<string>,
  alerts: readonly Alert[],
): Set<string> {
  const live = new Set(alerts.map((a) => a.id));
  return new Set([...acknowledged].filter((id) => live.has(id)));
}
