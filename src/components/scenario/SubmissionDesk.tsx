import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ImpactReportView } from "@/components/ScenarioAnalyst";
import type { EventKind } from "@/engine/twin";
import { useSim } from "@/lib/SimProvider";
import { EVENT_DEFS } from "@/scenarios/events";
import { analyzeImpact, type ImpactReport } from "@/scenarios/impact";

interface Submission {
  id: string;
  team: string;
  title: string;
  submittedAt: string;
  report: ImpactReport;
}

const STORE = "gaia-operator-submissions";

export function SubmissionDesk() {
  const sim = useSim();
  const [team, setTeam] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<EventKind[]>([]);
  const [target, setTarget] = useState(sim.world.machines[1]?.id ?? "");
  const [subs, setSubs] = useState<Submission[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSubs(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
    } catch {
      setSubs([]);
    }
  }, []);

  const save = (next: Submission[]) => {
    setSubs(next);
    localStorage.setItem(STORE, JSON.stringify(next.slice(0, 50)));
  };

  const toggle = (k: EventKind) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!team.trim() || selected.length === 0) return;
    const report = analyzeImpact(sim.world, selected, target);
    const s: Submission = {
      id: `S${Date.now().toString(36).toUpperCase()}`,
      team: team.trim(),
      title: title.trim() || report.labels.join(", "),
      submittedAt: new Date().toLocaleString(),
      report,
    };
    save([s, ...subs]);
    setOpenId(s.id);
    setTitle("");
    setSelected([]);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <form onSubmit={submit} className="gaia-panel space-y-3 p-4">
        <h2 className="text-sm font-semibold">Submit a scenario</h2>
        <label className="block text-xs">
          Team
          <input
            required
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="Line maintenance"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
          />
        </label>
        <label className="block text-xs">
          Scenario title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Friday heat and rush"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
          />
        </label>
        <fieldset className="space-y-1.5 text-xs">
          <legend className="mb-1">Disruptions</legend>
          {EVENT_DEFS.map((d) => (
            <label key={d.kind} className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={selected.includes(d.kind)}
                onChange={() => toggle(d.kind)}
              />
              <span>
                {d.label} <span className="text-muted-foreground">· {d.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {selected.includes("machineFault") && (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Faulted machine"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            {sim.world.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={!team.trim() || selected.length === 0}
        >
          Submit and calculate impact
        </Button>
      </form>

      <section className="gaia-panel p-4 lg:col-span-2">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Submitted scenarios ({subs.length})</h2>
          {subs.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => save([])}>
              Clear
            </Button>
          )}
        </div>
        {subs.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No scenarios yet. Submit one to see its impact.
          </p>
        )}
        <ul className="space-y-2">
          {subs.map((s) => {
            const worst = s.report.machines.some((m) => m.risk === "critical")
              ? "critical"
              : s.report.machines.some((m) => m.risk === "elevated")
                ? "elevated"
                : "low";
            return (
              <li key={s.id} className="rounded-md border border-border p-3">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-xs"
                >
                  <span>
                    <span className="font-semibold">{s.title}</span>{" "}
                    <span className="text-muted-foreground">
                      · {s.team} · {s.submittedAt}
                    </span>
                  </span>
                  <span
                    className={
                      worst === "critical"
                        ? "text-critical-text"
                        : worst === "elevated"
                          ? "text-chart-4"
                          : "text-primary"
                    }
                  >
                    {worst} risk · missed {s.report.deadlines.missedHit}
                  </span>
                </button>
                {openId === s.id && <ImpactReportView report={s.report} />}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
