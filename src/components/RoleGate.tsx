import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ROLE_DEFS, rolesWith, type Permission } from "@/lib/roles";
import { useRole } from "@/lib/RoleProvider";

/** Renders children only when the current role holds the permission; otherwise explains and offers a switch. */
export function RoleGate({
  need,
  what,
  children,
}: {
  need: Permission;
  what: string;
  children: ReactNode;
}) {
  const { role, can, setRole } = useRole();
  if (can(need)) return <>{children}</>;
  const allowed = rolesWith(need);
  return (
    <div
      role="alert"
      data-testid="role-gate-denied"
      className="gaia-panel mx-auto mt-8 max-w-xl p-6 text-center"
    >
      <Lock aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
      <h2 className="mt-3 text-base font-semibold">
        {what} is not available to the {ROLE_DEFS[role].label} role
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Roles keep each screen focused on one job. This is an interface setting, not a login, so you
        can switch freely.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {allowed.map((r) => (
          <Button key={r.id} size="sm" variant="outline" onClick={() => setRole(r.id)}>
            Switch to {r.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
