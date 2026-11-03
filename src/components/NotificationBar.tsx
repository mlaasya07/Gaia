import { AlertTriangle, Bell, ChevronDown, ChevronUp, Info, OctagonAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  computeAlerts,
  countAlerts,
  pruneAcknowledged,
  type Alert,
  type AlertSeverity,
} from "@/engine/alerts";
import { rolesWith, type Permission } from "@/lib/roles";
import { useRole } from "@/lib/RoleProvider";
import { useSim } from "@/lib/SimProvider";

const SEVERITY_STYLE: Record<AlertSeverity, { row: string; chip: string; label: string }> = {
  critical: {
    row: "border-destructive bg-destructive/25",
    chip: "bg-destructive text-destructive-foreground",
    label: "Critical",
  },
  warning: {
    row: "border-chart-4/70 bg-chart-4/10",
    chip: "bg-chart-4/25 text-chart-4",
    label: "Warning",
  },
  info: {
    row: "border-border bg-background",
    chip: "bg-muted text-muted-foreground",
    label: "Info",
  },
};

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === "critical")
    return <OctagonAlert aria-hidden="true" className="size-4 shrink-0" />;
  if (severity === "warning")
    return <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />;
  return <Info aria-hidden="true" className="size-4 shrink-0" />;
}

function needsRoleHint(permission: Permission): string {
  return `Needs the ${rolesWith(permission)
    .map((r) => r.label)
    .join(" or ")} role`;
}

function AlertRow({
  alert,
  acknowledged,
  onAck,
}: {
  alert: Alert;
  acknowledged: boolean;
  onAck: () => void;
}) {
  const sim = useSim();
  const { can } = useRole();
  const style = SEVERITY_STYLE[alert.severity];
  const machineId = alert.machineId;
  const canOverride = can("override");
  const canRepair = can("repair");
  const canCommission = can("commission");
  const wantsAction =
    alert.canThrottle || alert.canService || alert.canRepair || alert.canCommission;

  return (
    <li
      data-testid={`alert-${alert.id}`}
      className={`rounded-md border-l-4 px-3 py-2 text-xs ${style.row} ${acknowledged ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.chip}`}
        >
          <SeverityIcon severity={alert.severity} />
          {style.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{alert.title}</p>
          <p className="mt-0.5 text-muted-foreground">{alert.detail}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">from {alert.source}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {machineId && alert.canThrottle && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canOverride}
              title={canOverride ? undefined : needsRoleHint("override")}
              onClick={() => sim.override({ kind: "throttle", machineId, speed: 0.8 })}
            >
              Throttle to 80%
            </Button>
          )}
          {machineId && alert.canService && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canOverride}
              title={canOverride ? undefined : needsRoleHint("override")}
              onClick={() => sim.override({ kind: "service", machineId, at: sim.world.tick })}
            >
              Service now
            </Button>
          )}
          {machineId && alert.canRepair && (
            <Button
              size="sm"
              disabled={!canRepair}
              title={canRepair ? undefined : needsRoleHint("repair")}
              onClick={() => sim.sendRepairCrew(machineId)}
            >
              Send repair crew
            </Button>
          )}
          {alert.canCommission && (
            <Button
              size="sm"
              disabled={!canCommission}
              title={canCommission ? undefined : needsRoleHint("commission")}
              onClick={() => sim.commission()}
            >
              Commission a machine
            </Button>
          )}
          {!acknowledged && (
            <Button size="sm" variant="ghost" onClick={onAck}>
              Acknowledge
            </Button>
          )}
        </div>
      </div>
      {wantsAction &&
        ((alert.canRepair && !canRepair) ||
          (alert.canCommission && !canCommission) ||
          ((alert.canThrottle || alert.canService) && !canOverride)) && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {alert.canRepair
              ? needsRoleHint("repair")
              : alert.canCommission
                ? needsRoleHint("commission")
                : needsRoleHint("override")}{" "}
            to act on this alert.
          </p>
        )}
    </li>
  );
}

/** Live operator notifications derived from the twin and the agents' forecast. */
export function NotificationBar() {
  const sim = useSim();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set());

  // `version` bumps every tick, which is what makes the (mutated) world re-evaluate.
  const alerts = useMemo(
    () => computeAlerts(sim.world, sim.latestForecast),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.version, sim.latestForecast],
  );

  useEffect(() => {
    setAcknowledged((prev) => {
      const next = pruneAcknowledged(prev, alerts);
      return next.size === prev.size ? prev : next;
    });
  }, [alerts]);

  const counts = countAlerts(alerts, acknowledged);
  const top = alerts.find((a) => !acknowledged.has(a.id));
  const tone =
    counts.critical > 0
      ? "border-destructive bg-destructive/20"
      : counts.warning > 0
        ? "border-chart-4/60 bg-chart-4/10"
        : "border-border bg-card";

  return (
    <section aria-label="Notifications" className={`border-b ${tone}`}>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2 text-xs">
        <Bell aria-hidden="true" className="size-4 shrink-0" />
        <span className="font-medium">Notifications</span>
        <span data-testid="alert-counts" className="flex items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 tabular-nums ${counts.critical ? SEVERITY_STYLE.critical.chip : "bg-muted text-muted-foreground"}`}
          >
            {counts.critical} critical
          </span>
          <span
            className={`rounded px-1.5 py-0.5 tabular-nums ${counts.warning ? SEVERITY_STYLE.warning.chip : "bg-muted text-muted-foreground"}`}
          >
            {counts.warning} warning
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums text-muted-foreground">
            {counts.info} info
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {top
            ? top.title
            : alerts.length
              ? "All current alerts acknowledged"
              : "No active alerts. The line is running normally."}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          disabled={alerts.length === 0}
        >
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {open ? "Hide" : `Show all (${alerts.length})`}
        </Button>
      </div>
      {/* Screen readers hear new critical alerts without the list being open. */}
      <p className="sr-only" role="status" aria-live="polite">
        {counts.critical > 0
          ? `${counts.critical} critical alert${counts.critical === 1 ? "" : "s"}: ${top?.title ?? ""}`
          : ""}
      </p>
      {open && alerts.length > 0 && (
        <ul className="mx-auto max-h-[45vh] max-w-[1400px] space-y-2 overflow-y-auto px-4 pb-3">
          {alerts.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              acknowledged={acknowledged.has(a.id)}
              onAck={() => setAcknowledged((prev) => new Set(prev).add(a.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
