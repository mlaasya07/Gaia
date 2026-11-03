import { motion, useReducedMotion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { AGENT_IDS, type Agent, type AgentId } from "@/engine/agents";
import type { Decision } from "@/engine/consensus";
import type { Message } from "@/engine/negotiation";
import { clockLabel, isHeld, type Machine, type TickMetrics } from "@/engine/twin";
import type { Forecast } from "@/engine/worldModel";
import { useRole } from "@/lib/RoleProvider";
import { useSim } from "@/lib/SimProvider";

// Dashboard panels shared by the operations page and the scenario desk.

export const AGENT_COLORS: Record<AgentId, string> = {
  energy: "text-primary",
  carbon: "text-chart-2",
  maintenance: "text-chart-3",
  production: "text-chart-1",
  orchestration: "text-chart-3",
  quality: "text-chart-4",
  safety: "text-chart-5",
};

export function KpiRow({ latest }: { latest: TickMetrics | null }) {
  const items = latest
    ? [
        { label: "Power draw", value: `${latest.kwh.toFixed(1)} kWh`, sub: "per 10 min" },
        {
          label: "Emissions",
          value: `${latest.carbonKg.toFixed(2)} kg`,
          sub: `grid ${latest.gridCarbon.toFixed(0)} g/kWh`,
        },
        {
          label: "Energy cost",
          value: `$${latest.cost.toFixed(2)}`,
          sub: `@ $${latest.price.toFixed(3)}/kWh`,
        },
        { label: "Throughput", value: latest.throughput.toFixed(1), sub: "units / tick" },
        { label: "Latency", value: `${latest.latency.toFixed(0)} ms`, sub: "weighted avg" },
        {
          label: "Avg health",
          value: `${latest.avgHealth.toFixed(0)}%`,
          sub: `ambient ${latest.ambient.toFixed(0)}°C`,
        },
      ]
    : [];
  return (
    <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => (
        <div key={k.label} className="gaia-panel p-3">
          <p className="text-xs text-muted-foreground">{k.label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
          <p className="text-xs text-muted-foreground">{k.sub}</p>
          {k.label === "Emissions" && latest && (
            <div
              className="carbon-scale relative mt-2 h-1.5 rounded"
              title={`Carbon intensity: ${latest.gridCarbon.toFixed(0)} g/kWh`}
            >
              <span
                className="absolute -top-0.5 h-2.5 w-0.5 bg-foreground"
                style={{ left: `${Math.min(99, Math.max(0, (latest.gridCarbon / 800) * 100))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Sparkline({
  points,
  band,
  height = 120,
  className,
  ghost = false,
}: {
  points: number[];
  band?: { lo: number[]; hi: number[] };
  height?: number;
  className?: string;
  ghost?: boolean;
}) {
  if (points.length < 2) return <div style={{ height }} className="rounded bg-muted/40" />;
  const all = band ? [...points, ...band.lo, ...band.hi] : points;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1e-6, max - min);
  const w = 100;
  const x = (i: number, n: number) => (i / (n - 1)) * w;
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const line = points.map((v, i) => `${x(i, points.length)},${y(v)}`).join(" ");
  const bandPath = band
    ? `M ${band.hi.map((v, i) => `${x(i, band.hi.length)},${y(v)}`).join(" L ")} L ${band.lo
        .map((v, i) => `${x(i, band.lo.length)},${y(v)}`)
        .reverse()
        .join(" L ")} Z`
    : null;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: "100%" }}
    >
      {bandPath && <path d={bandPath} className="fill-primary/10" stroke="none" />}
      <polyline
        points={line}
        fill="none"
        className={ghost ? "stroke-primary/60" : "stroke-primary"}
        strokeDasharray={ghost ? "5 5" : undefined}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ForecastPanel({
  forecast,
  history,
}: {
  forecast: Forecast | null;
  history: TickMetrics[];
}) {
  const hist = history.slice(-72).map((h) => h.kwh);
  const fc = forecast?.series.kwh;
  return (
    <div className="gaia-panel p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Energy - history & 6h forecast</h2>
        {forecast && (
          <p className="text-xs text-muted-foreground">
            next 6h: {forecast.summary.kwh.toFixed(0)} kWh · {forecast.summary.carbonKg.toFixed(1)}{" "}
            kg CO2 · {forecast.summary.missed.toFixed(1)} at-risk jobs
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Observed (last 12h)</p>
          <Sparkline points={hist} />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">World-model forecast (95% band)</p>
          {fc ? (
            <Sparkline points={fc.mean} band={{ lo: fc.lo, hi: fc.hi }} ghost />
          ) : (
            <div className="h-[120px] rounded bg-muted/40" />
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<Machine["status"], string> = {
  running: "bg-chart-2/20 text-chart-2",
  idle: "bg-muted text-muted-foreground",
  slowed: "bg-chart-4/20 text-chart-4",
  boosted: "bg-chart-4/20 text-chart-4",
  maintenance: "bg-chart-3/20 text-chart-3",
  failed: "bg-destructive text-destructive-foreground",
};

export function MachineGrid() {
  const sim = useSim();
  const { can } = useRole();
  const reduceMotion = useReducedMotion();
  const { machines, tick } = sim.world;
  const canOverride = can("override");
  const canRepair = can("repair");
  return (
    <div className="gaia-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Shop floor</h2>
        {!canOverride && !canRepair && (
          <p className="text-[11px] text-muted-foreground">
            Read-only for this role. Overrides need the Operator or Plant manager role.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {machines.map((m) => {
          const held = isHeld(sim.world, m);
          return (
            <motion.div
              key={m.id}
              data-testid={`machine-${m.id}`}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className={`machine-body min-w-0 rounded-md border p-3 ${m.health > 60 && m.status !== "failed" ? "machine-healthy" : "border-border"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="text-sm font-medium">{m.name}</p>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_STYLE[m.status]}`}
                >
                  {m.status}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                <motion.div
                  className={`h-full ${m.health > 60 ? "bg-chart-2" : m.health > 30 ? "bg-chart-4" : "bg-destructive"}`}
                  initial={false}
                  animate={{ width: `${m.health}%` }}
                  transition={{ duration: reduceMotion ? 0 : 0.45 }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground tabular-nums">
                <span>{m.health.toFixed(0)}% hp</span>
                <span className={m.temp > 90 ? "text-chart-4" : ""}>{m.temp.toFixed(0)}°C</span>
                <span>{m.power.toFixed(0)} kW</span>
              </div>
              {held && m.hold && (
                <p
                  data-testid={`hold-${m.id}`}
                  className="mt-2 rounded bg-chart-4/15 px-1.5 py-0.5 text-[10px] text-chart-4"
                >
                  Held at {Math.round(m.hold.speed * 100)}% by operator until{" "}
                  {clockLabel(m.hold.until)}
                </p>
              )}
              {(canOverride || (canRepair && m.status === "failed")) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canOverride && m.status !== "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() =>
                        sim.override({ kind: "throttle", machineId: m.id, speed: held ? 1 : 0.8 })
                      }
                    >
                      {held ? "Release" : "Slow 20%"}
                    </Button>
                  )}
                  {canOverride && m.downTicks === 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => sim.override({ kind: "service", machineId: m.id, at: tick })}
                    >
                      Service now
                    </Button>
                  )}
                  {canRepair && m.status === "failed" && (
                    <Button
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => sim.sendRepairCrew(m.id)}
                    >
                      Send repair crew
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function AgentPanel({ agents }: { agents: Agent[] }) {
  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-3 text-sm font-semibold">Agent collective</h2>
      <ul className="space-y-3">
        {agents.map((a) => {
          const acc = a.accuracyHistory.length
            ? a.accuracyHistory.reduce((s, v) => s + v, 0) / a.accuracyHistory.length
            : null;
          return (
            <li key={a.id} className="border-b border-border py-2 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className={`text-sm font-medium ${AGENT_COLORS[a.id]}`}>{a.name}</p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  influence {a.influence.toFixed(2)}
                  {acc !== null && ` · acc ${(acc * 100).toFixed(0)}%`}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.goal}</p>
              <div className="mt-2 flex gap-1">
                {AGENT_IDS.filter((id) => id !== a.id).map((id) => (
                  <div
                    key={id}
                    className="flex-1"
                    title={`trust in ${id}: ${a.trust[id].toFixed(2)}`}
                  >
                    <div className="h-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-chart-3"
                        style={{ width: `${a.trust[id] * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const KIND_STYLE: Record<Message["kind"], string> = {
  propose: "border-chart-1/40",
  hold: "border-border",
  object: "border-chart-4/60",
  support: "border-chart-2/50",
  revise: "border-chart-4/50",
  withdraw: "border-muted",
  consensus: "border-primary/60 bg-primary/5",
  veto: "border-destructive bg-destructive/50",
};

export function NegotiationFeed({ decision }: { decision: Decision | undefined }) {
  if (!decision)
    return (
      <div className="gaia-panel p-4">
        <h2 className="text-sm font-semibold">Negotiation feed</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          First decision cycle happens at the next hour mark…
        </p>
      </div>
    );
  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-1 text-sm font-semibold">Negotiation feed</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        decision {decision.id} @ {clockLabel(decision.tick)} · {decision.rounds} round(s)
      </p>
      <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {decision.messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-md border-l-2 bg-background px-3 py-2 text-xs ${KIND_STYLE[m.kind]}`}
          >
            <span
              className={`font-medium ${m.from === "resolver" ? "text-primary" : AGENT_COLORS[m.from]}`}
            >
              {m.from === "resolver" ? "Resolver" : m.from}
            </span>{" "}
            <span className="text-muted-foreground">r{m.round}</span>
            <p className="mt-0.5 text-foreground/90">{m.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DecisionLog({ decisions }: { decisions: Decision[] }) {
  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-3 text-sm font-semibold">Decision log</h2>
      {decisions.length === 0 && <p className="text-xs text-muted-foreground">No decisions yet.</p>}
      <ul className="max-h-[380px] space-y-3 overflow-y-auto pr-1">
        {decisions.map((d) => (
          <li key={d.id} className="rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {d.id} @ {clockLabel(d.tick)}
              </span>
              <span className="tabular-nums">joint utility {d.global.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-foreground/90">{d.explanation}</p>
            {d.outcome && (
              <p className="mt-1 text-[11px] text-chart-2">
                realized: {d.outcome.realized.kwh.toFixed(1)} kWh ·{" "}
                {d.outcome.realized.carbonKg.toFixed(2)} kg CO2 (1h window)
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LearningFeed({ lessons }: { lessons: string[] }) {
  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-1 text-sm font-semibold">What the agents learned</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        After each decision plays out for an hour, agents compare the prediction with reality and
        adjust.
      </p>
      {lessons.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No lessons yet. The first appears about an hour after the first decision.
        </p>
      )}
      <ul data-testid="learning-feed" className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {lessons.map((l, i) => (
          <li
            key={`${i}-${l}`}
            className="rounded-md border-l-2 border-chart-3/60 bg-background px-3 py-2 text-xs text-foreground/90"
          >
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OverrideLog({ log }: { log: string[] }) {
  const mine = log.filter((l) => l.startsWith("Human override"));
  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-1 text-sm font-semibold">Operator actions</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Human overrides are held against the agents, so they are not undone at the next decision
        cycle.
      </p>
      {mine.length === 0 && <p className="text-xs text-muted-foreground">No overrides yet.</p>}
      <ul
        data-testid="override-log"
        className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-muted-foreground"
      >
        {mine.map((l, i) => (
          <li key={i}>· {l}</li>
        ))}
      </ul>
    </div>
  );
}
