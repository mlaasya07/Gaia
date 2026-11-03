import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import { AGENT_COLORS } from "@/components/dashboard/panels";
import { runScenarioSweep, type ScenarioResult } from "@/engine/scenarioLab";
import { useSim } from "@/lib/SimProvider";
import type { Totals } from "@/engine/twin";

function Cell({ t }: { t: Totals }) {
  return (
    <span className="tabular-nums">
      {t.carbonKg.toFixed(1)} kg · ${t.cost.toFixed(0)} · {t.missed} missed
    </span>
  );
}

function signed(n: number, digits = 1) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

/** Share of agent outcome predictions that held up, or null when nothing settled. */
function meanAccuracy(r: ScenarioResult["rows"][number]) {
  return r.accuracyCount ? r.accuracySum / r.accuracyCount : null;
}

export function ScenarioLabPanel() {
  const sim = useSim();
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const run = () => {
    setRunning(true);
    // Yield once so the "running" state paints before the (synchronous) sweep starts.
    setTimeout(() => {
      setResults(runScenarioSweep(sim.world, sim.wm, sim.agents));
      setRunning(false);
    }, 20);
  };

  return (
    <div className="gaia-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Scenario lab: agents across 8 disruptions</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Replays the next 6 hours from the current factory state under each disruption, three
            ways: collaborative agents, siloed agents and a reactive control with no agents. Runs on
            a copy, so the live twin is untouched.
          </p>
        </div>
        <Button size="sm" onClick={run} disabled={running}>
          {running ? "Running sweep…" : results ? "Re-run from current state" : "Run sweep"}
        </Button>
      </div>

      {results && (
        <div className="mt-4 overflow-x-auto">
          <table data-testid="sweep-table" className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Scenario</th>
                <th className="py-2 pr-3 font-medium">Collaborative</th>
                <th className="py-2 pr-3 font-medium">Siloed</th>
                <th className="py-2 pr-3 font-medium">Reactive control</th>
                <th className="py-2 pr-3 font-medium">CO2 vs reactive</th>
                <th className="py-2 pr-3 font-medium">Missed vs reactive</th>
                <th className="py-2 font-medium">Vetoes</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const key = r.scenario.label;
                const co2 = r.collab.carbonKg - r.reactive.carbonKg;
                const missed = r.collab.missed - r.reactive.missed;
                return (
                  <Fragment key={key}>
                    <tr className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="text-left font-medium underline-offset-2 hover:underline"
                          aria-expanded={open === key}
                          onClick={() => setOpen(open === key ? null : key)}
                        >
                          {key}
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        <Cell t={r.collab} />
                      </td>
                      <td className="py-2 pr-3">
                        <Cell t={r.siloed} />
                      </td>
                      <td className="py-2 pr-3">
                        <Cell t={r.reactive} />
                      </td>
                      <td
                        className={`py-2 pr-3 tabular-nums ${co2 <= 0 ? "text-primary" : "text-chart-4"}`}
                      >
                        {signed(co2)} kg
                      </td>
                      <td
                        className={`py-2 pr-3 tabular-nums ${missed <= 0 ? "text-primary" : "text-chart-4"}`}
                      >
                        {signed(missed, 0)}
                      </td>
                      <td className="py-2 tabular-nums">{r.vetoes}</td>
                    </tr>
                    {open === key && (
                      <tr className="border-b border-border/60 bg-background/40">
                        <td colSpan={7} className="px-2 py-3">
                          <p className="mb-2 text-[11px] text-muted-foreground">
                            {r.decisions} decision cycle(s). First-cycle recommendation from each
                            agent:
                          </p>
                          <ul className="grid gap-2 md:grid-cols-2">
                            {r.rows.map((a) => {
                              const acc = meanAccuracy(a);
                              return (
                                <li key={a.agentId} className="rounded-md border border-border p-2">
                                  <p className={`text-xs font-medium ${AGENT_COLORS[a.agentId]}`}>
                                    {a.agentId}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-foreground/90">
                                    {a.recommendation ?? "No proposal this scenario."}
                                  </p>
                                  <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                                    {a.adoptedFirstCycle
                                      ? "adopted first cycle"
                                      : "not adopted first cycle"}{" "}
                                    · {a.adoptions}/{a.proposals} adopted
                                    {acc !== null &&
                                      ` · prediction accuracy ${(acc * 100).toFixed(0)}%`}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Negative CO2 and missed-job differences mean the collaborative agents did better than
            the reactive control. Totals are for the 6-hour horizon. Results depend on where the
            factory is right now (shift, queued jobs, machine health), so re-run after
            fast-forwarding to a busy period.
          </p>
        </div>
      )}
    </div>
  );
}
