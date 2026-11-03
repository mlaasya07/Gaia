// Role-based access for the Gaia interface.
//
// This is an interface-level permission model: it decides which pages and controls the
// UI offers for each job role. The app has no login and no server, so it is NOT a
// security boundary. Anyone can switch role. It exists to keep each person's screen
// focused and to stop accidental actions (for example an analyst wiping the live twin).

export const ROLES = ["operator", "planner", "researcher", "manager"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "override" // change machine speed, send a machine to service
  | "repair" // dispatch a repair crew to a failed machine
  | "commission" // commission an additional machine when capacity runs short
  | "injectDisruption" // fire disruption events into the live twin
  | "scenarioDesk" // open the scenario desk
  | "research" // open the research dashboard
  | "reset"; // reset the whole simulation

export interface RoleDef {
  id: Role;
  label: string;
  summary: string;
  permissions: readonly Permission[];
}

export const ROLE_DEFS: Record<Role, RoleDef> = {
  operator: {
    id: "operator",
    label: "Operator",
    summary: "Runs the floor: acts on alerts, overrides agents, dispatches repair crews.",
    permissions: ["override", "repair", "commission"],
  },
  planner: {
    id: "planner",
    label: "Planner",
    summary: "Plans ahead: injects disruptions and runs what-if scenarios. Cannot touch machines.",
    permissions: ["injectDisruption", "scenarioDesk", "reset"],
  },
  researcher: {
    id: "researcher",
    label: "Researcher",
    summary:
      "Studies the agents: scenario desk and the research dashboard. Read-only on the floor.",
    permissions: ["scenarioDesk", "research", "reset"],
  },
  manager: {
    id: "manager",
    label: "Plant manager",
    summary: "Full access to every page and control.",
    permissions: [
      "override",
      "repair",
      "commission",
      "injectDisruption",
      "scenarioDesk",
      "research",
      "reset",
    ],
  },
};

export const DEFAULT_ROLE: Role = "operator";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_DEFS[role].permissions.includes(permission);
}

/** Roles that hold a permission, for "ask a Planner or Manager" style hints. */
export function rolesWith(permission: Permission): RoleDef[] {
  return ROLES.map((r) => ROLE_DEFS[r]).filter((d) => d.permissions.includes(permission));
}

export type PagePath = "/" | "/scenarios" | "/research" | "/evidence";

export interface PageDef {
  to: PagePath;
  label: string;
  /** Permission needed to open the page; null means every role can. */
  needs: Permission | null;
}

export const PAGES: readonly PageDef[] = [
  { to: "/", label: "Operations", needs: null },
  { to: "/scenarios", label: "Scenario desk", needs: "scenarioDesk" },
  { to: "/research", label: "Research", needs: "research" },
  { to: "/evidence", label: "Evidence", needs: null },
];

export function canOpen(role: Role, page: PageDef): boolean {
  return page.needs === null || can(role, page.needs);
}
