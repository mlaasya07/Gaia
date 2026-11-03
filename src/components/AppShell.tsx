import { Link } from "@tanstack/react-router";
import { FastForward, Lock, Pause, Play, RotateCcw, StepForward } from "lucide-react";
import type { ReactNode } from "react";

import { NotificationBar } from "@/components/NotificationBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { clockLabel, TICKS_PER_HOUR } from "@/engine/twin";
import { PAGES, ROLES, ROLE_DEFS, canOpen, isRole } from "@/lib/roles";
import { useRole } from "@/lib/RoleProvider";
import { useSim } from "@/lib/SimProvider";

function RoleSwitcher() {
  const { role, setRole } = useRole();
  return (
    <label
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={`${ROLE_DEFS[role].summary} Roles are an interface setting, not a login.`}
    >
      Role
      <select
        aria-label="Switch role"
        value={role}
        onChange={(e) => {
          if (isRole(e.target.value)) setRole(e.target.value);
        }}
        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_DEFS[r].label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Nav() {
  const { role } = useRole();
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
      {PAGES.map((page) =>
        canOpen(role, page) ? (
          <Link
            key={page.to}
            to={page.to}
            activeOptions={{ exact: true }}
            className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            activeProps={{ className: "bg-accent text-accent-foreground", "aria-current": "page" }}
          >
            {page.label}
          </Link>
        ) : (
          <span
            key={page.to}
            aria-disabled="true"
            title={`Not available to the ${ROLE_DEFS[role].label} role`}
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground/50"
          >
            <Lock aria-hidden="true" className="size-3" />
            {page.label}
          </span>
        ),
      )}
    </nav>
  );
}

function Playback() {
  const sim = useSim();
  const { can } = useRole();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        data-testid="simulation-clock"
        className="rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm tabular-nums"
      >
        {clockLabel(sim.world.tick)} · tick {sim.world.tick}
      </span>
      <Button
        variant="outline"
        size="sm"
        title="Advance one simulation tick"
        onClick={sim.tickOnce}
      >
        <StepForward aria-hidden="true" /> Step
      </Button>
      <Button
        variant="outline"
        size="sm"
        title="Fast-forward one simulated hour"
        onClick={() => sim.advance(TICKS_PER_HOUR)}
      >
        <FastForward aria-hidden="true" /> +1h
      </Button>
      <Button
        variant="outline"
        size="sm"
        title="Fast-forward six simulated hours"
        onClick={() => sim.advance(TICKS_PER_HOUR * 6)}
      >
        <FastForward aria-hidden="true" /> +6h
      </Button>
      <Button
        size="sm"
        onClick={sim.toggle}
        aria-label={sim.running ? "Pause simulation" : "Resume simulation"}
      >
        {sim.running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        {sim.running ? "Pause" : "Resume"}
      </Button>
      <select
        value={sim.speedMs}
        onChange={(e) => sim.setSpeedMs(Number(e.target.value))}
        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
        aria-label="Simulation speed"
      >
        <option value={1000}>1×</option>
        <option value={650}>2×</option>
        <option value={300}>5×</option>
        <option value={120}>10×</option>
      </select>
      <Button
        variant="outline"
        size="sm"
        aria-label="Reset simulation"
        disabled={!can("reset")}
        title={
          can("reset")
            ? "Reset the factory and clear simulation results"
            : "Resetting the live twin needs the Planner, Researcher or Plant manager role"
        }
        onClick={() => sim.reset(Math.floor(Math.random() * 10000))}
      >
        <RotateCcw aria-hidden="true" /> Reset
      </Button>
    </div>
  );
}

/** Header, navigation, role switcher, playback controls and live notifications shared by every page. */
export function AppShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold tracking-normal">
              Gaia <span className="font-normal text-muted-foreground">- Factory Digital Twin</span>
            </h1>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <Nav />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <RoleSwitcher />
            <ThemeToggle />
            <Playback />
          </div>
        </div>
      </header>
      <NotificationBar />
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 pb-10 pt-4">{children}</main>
    </div>
  );
}
