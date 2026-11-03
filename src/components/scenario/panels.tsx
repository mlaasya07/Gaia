import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/dashboard/panels";
import { useRole } from "@/lib/RoleProvider";
import { useSim } from "@/lib/SimProvider";
import type { CfMode } from "@/scenarios/counterfactual";
import { EVENT_DEFS } from "@/scenarios/events";

export function EventsPanel() {
  const sim = useSim();
  const { can } = useRole();
  const allowed = can("injectDisruption");
  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-1 text-sm font-semibold">Inject disruption</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {allowed
          ? "Fires into the live twin immediately."
          : "Needs the Planner or Plant manager role."}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {EVENT_DEFS.map((e) => (
          <Button
            key={e.kind}
            disabled={!allowed}
            onClick={() => sim.fireEvent(e.kind)}
            title={e.hint}
            variant="outline"
            className="h-auto min-w-0 flex-col items-start gap-0 whitespace-normal rounded-md border border-border bg-background px-2 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
          >
            <span className="block font-medium">{e.label}</span>
            <span className="text-[10px] text-muted-foreground">{e.hint}</span>
          </Button>
        ))}
      </div>
      {sim.eventLog.length > 0 && (
        <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-[11px] text-muted-foreground">
          {sim.eventLog.map((l, i) => (
            <li key={i}>· {l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WhatIfPanel() {
  const sim = useSim();
  const [mode, setMode] = useState<CfMode>("reactive");
  const cf = sim.cf;
  const rows = useMemo(() => {
    if (!cf) return [];
    const mk = (label: string, f: typeof cf.a) => ({
      label,
      kwh: f.totals.kwh,
      carbon: f.totals.carbonKg,
      cost: f.totals.cost,
      missed: f.totals.missed,
      downtime: f.totals.downtime,
    });
    return [mk(cf.a.label, cf.a), mk(cf.b.label, cf.b)];
  }, [cf]);
  return (
    <div className="gaia-panel p-4">
      <h2 className="mb-3 text-sm font-semibold">What-if lab (next 6h)</h2>
      <div className="flex gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as CfMode)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          aria-label="Comparison mode"
        >
          <option value="reactive">vs reactive control (no agents)</option>
          <option value="siloed">vs siloed agents</option>
        </select>
        <Button
          onClick={() => sim.runWhatIf(mode)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Run
        </Button>
      </div>
      {cf && (
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="rounded-md border border-border bg-background p-2 text-xs"
            >
              <p className="font-medium">{r.label}</p>
              <p className="mt-0.5 text-muted-foreground tabular-nums">
                {r.kwh.toFixed(0)} kWh · {r.carbon.toFixed(1)} kg CO2 · ${r.cost.toFixed(2)} ·{" "}
                {r.missed} missed · {r.downtime} down-ticks
              </p>
            </div>
          ))}
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">
              kWh per tick - collaborative (top line overlay)
            </p>
            <Sparkline points={cf.a.kwh} height={70} />
            <Sparkline points={cf.b.kwh} height={70} className="mt-1 opacity-60" />
          </div>
        </div>
      )}
    </div>
  );
}
