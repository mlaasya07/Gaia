import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { EventKind } from "@/engine/twin";
import type { SimApi } from "@/lib/useSimulation";
import { EVENT_DEFS } from "@/scenarios/events";
import { analyzeImpact, type ImpactReport } from "@/scenarios/impact";

const RISK_STYLE = {
  low: "text-primary",
  elevated: "text-chart-4",
  critical: "bg-destructive text-destructive-foreground rounded px-1",
} as const;

function delta(a: number, b: number, digits = 1) {
  const d = b - a;
  return `${d >= 0 ? "+" : ""}${d.toFixed(digits)}`;
}

export function ScenarioAnalyst({ sim }: { sim: SimApi }) {
  const [selected, setSelected] = useState<EventKind[]>([]);
  const [target, setTarget] = useState(sim.world.machines[1]?.id ?? "");
  const [report, setReport] = useState<ImpactReport | null>(null);

  const toggle = (k: EventKind) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const run = () => {
    if (selected.length === 0) return;
    setReport(analyzeImpact(sim.world, selected, target));
  };

  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-1 text-sm font-semibold">Scenario impact model</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Combine disruptions. The twin runs the next 6h with and without them and reports the effect
        on machine health, energy use and deadlines.
      </p>
      <div className="flex flex-wrap gap-2">
        {EVENT_DEFS.map((e) => (
          <label
            key={e.kind}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${selected.includes(e.kind) ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-chart-4"}`}
          >
            <input
              type="checkbox"
              className="accent-primary"
              checked={selected.includes(e.kind)}
              onChange={() => toggle(e.kind)}
            />
            {e.label}
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {selected.includes("machineFault") && (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Faulted machine"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {sim.world.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" onClick={run} disabled={selected.length === 0}>
          Calculate impact
        </Button>
      </div>

      {report && <ImpactReportView report={report} />}
    </div>
  );
}

export function ImpactReportView({ report }: { report: ImpactReport }) {
  return (
    <div className="mt-4 grid gap-4 text-xs lg:grid-cols-3">
      <div>
        <h3 className="mb-2 font-semibold">Machine health</h3>
        <ul className="space-y-1 tabular-nums">
          {report.machines.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2">
              <span>{m.name}</span>
              <span className={RISK_STYLE[m.risk]}>
                {m.healthHit.toFixed(0)}% ({delta(m.healthBase, m.healthHit, 0)}) · peak{" "}
                {m.peakTempHit.toFixed(0)}°C
                {m.failed ? " · fails" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">Energy use (6h)</h3>
        <ul className="space-y-1 tabular-nums">
          <li>
            Energy: {report.energy.kwhHit.toFixed(0)} kWh (
            {delta(report.energy.kwhBase, report.energy.kwhHit, 0)})
          </li>
          <li>
            Cost: ${report.energy.costHit.toFixed(2)} (
            {delta(report.energy.costBase, report.energy.costHit, 2)})
          </li>
          <li>
            Carbon: {report.energy.carbonHit.toFixed(1)} kg (
            {delta(report.energy.carbonBase, report.energy.carbonHit)})
          </li>
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">Deadlines</h3>
        <p className="tabular-nums">
          Missed jobs: {report.deadlines.missedHit} (
          {delta(report.deadlines.missedBase, report.deadlines.missedHit, 0)}) · down-ticks{" "}
          {report.deadlines.downtimeHit} (
          {delta(report.deadlines.downtimeBase, report.deadlines.downtimeHit, 0)})
        </p>
        <ul className="mt-1 space-y-1">
          {report.deadlines.jobs.length === 0 && (
            <li className="text-muted-foreground">No job changes status.</li>
          )}
          {report.deadlines.jobs.map((j) => (
            <li
              key={j.id}
              className={
                j.status === "newly missed"
                  ? "text-critical-text"
                  : j.status === "at risk"
                    ? "text-chart-4"
                    : "text-primary"
              }
            >
              {j.id} {j.name} on {j.machine}, due {j.due}: {j.status}
            </li>
          ))}
        </ul>
      </div>
      <p className="rounded-md border border-border bg-background p-2 lg:col-span-3">
        <span className="font-semibold">Recommended action:</span> {report.recommendation}{" "}
        <span className="text-muted-foreground">
          From {report.fromClock}: {report.labels.join(", ")}.
        </span>
      </p>
    </div>
  );
}
