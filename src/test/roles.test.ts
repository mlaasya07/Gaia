import { describe, expect, it } from "vitest";

import { PAGES, ROLES, ROLE_DEFS, can, canOpen, isRole, rolesWith } from "@/lib/roles";

describe("roles", () => {
  it("gives only operators and managers floor control", () => {
    expect(ROLES.filter((r) => can(r, "override"))).toEqual(["operator", "manager"]);
    expect(ROLES.filter((r) => can(r, "repair"))).toEqual(["operator", "manager"]);
  });

  it("keeps disruption injection away from operators", () => {
    expect(can("operator", "injectDisruption")).toBe(false);
    expect(can("planner", "injectDisruption")).toBe(true);
    expect(can("researcher", "injectDisruption")).toBe(false);
  });

  it("stops operators from resetting the live twin", () => {
    expect(can("operator", "reset")).toBe(false);
    expect(can("manager", "reset")).toBe(true);
  });

  it("lets the plant manager do everything", () => {
    for (const p of [
      "override",
      "repair",
      "injectDisruption",
      "scenarioDesk",
      "research",
      "reset",
    ] as const) {
      expect(can("manager", p)).toBe(true);
    }
  });

  it("limits the research page to researchers and managers", () => {
    const research = PAGES.find((p) => p.to === "/research")!;
    expect(ROLES.filter((r) => canOpen(r, research))).toEqual(["researcher", "manager"]);
  });

  it("lets every role open Operations and Evidence", () => {
    for (const to of ["/", "/evidence"] as const) {
      const page = PAGES.find((p) => p.to === to)!;
      expect(ROLES.every((r) => canOpen(r, page))).toBe(true);
    }
  });

  it("validates stored role values", () => {
    expect(isRole("planner")).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("names the roles that hold a permission", () => {
    expect(rolesWith("repair").map((r) => r.id)).toEqual(["operator", "manager"]);
    expect(ROLE_DEFS.operator.label).toBe("Operator");
  });

  it("lets only operators and managers commission machines", () => {
    expect(ROLES.filter((r) => can(r, "commission"))).toEqual(["operator", "manager"]);
  });
});
