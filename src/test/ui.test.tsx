import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NotificationBar } from "@/components/NotificationBar";
import { RoleGate } from "@/components/RoleGate";
import { MachineGrid } from "@/components/dashboard/panels";
import { AttentionPanel, ComparisonTable, FindingsPanel } from "@/components/research/panels";
import { EventsPanel } from "@/components/scenario/panels";
import { ScenarioLabPanel } from "@/components/scenario/ScenarioLabPanel";
import { deriveFindings, type ResearchData } from "@/lib/research";
import { RoleProvider } from "@/lib/RoleProvider";
import type { Role } from "@/lib/roles";
import { SimProvider, useSim } from "@/lib/SimProvider";
import type { SimApi } from "@/lib/useSimulation";

let sim: SimApi;
function Grab() {
  const s = useSim();
  useEffect(() => {
    sim = s;
  });
  sim = s;
  return null;
}

function Providers({ role, children }: { role: Role; children: ReactNode }) {
  return (
    <RoleProvider initialRole={role}>
      <SimProvider autostart={false}>
        <Grab />
        {children}
      </SimProvider>
    </RoleProvider>
  );
}

const failMachine = (index = 1) => {
  const m = sim.world.machines[index]!;
  m.health = 0;
  act(() => sim.tickOnce());
  return m;
};

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("NotificationBar", () => {
  it("is quiet when nothing is wrong", () => {
    render(
      <Providers role="operator">
        <NotificationBar />
      </Providers>,
    );
    expect(screen.getByText(/No active alerts/i)).toBeInTheDocument();
    expect(screen.getByTestId("alert-counts")).toHaveTextContent("0 critical");
  });

  it("shows a critical alert when a machine fails, and lets an operator send a crew", () => {
    render(
      <Providers role="operator">
        <NotificationBar />
      </Providers>,
    );
    const m = failMachine();
    expect(screen.getByTestId("alert-counts")).toHaveTextContent("1 critical");
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    fireEvent.click(screen.getByRole("button", { name: /send repair crew/i }));
    expect(m.downTicks).toBeLessThanOrEqual(4);
  });

  it("disables the repair action for roles without permission and says who can", () => {
    render(
      <Providers role="researcher">
        <NotificationBar />
      </Providers>,
    );
    const m = failMachine();
    const before = m.downTicks;
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    const btn = screen.getByRole("button", { name: /send repair crew/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("Operator"));
    fireEvent.click(btn);
    expect(m.downTicks).toBe(before);
  });

  it("moves an acknowledged alert out of the open counts", () => {
    render(
      <Providers role="operator">
        <NotificationBar />
      </Providers>,
    );
    failMachine();
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    fireEvent.click(screen.getByRole("button", { name: /acknowledge/i }));
    expect(screen.getByTestId("alert-counts")).toHaveTextContent("0 critical");
  });

  it("offers throttle and service for an overheating machine", () => {
    render(
      <Providers role="operator">
        <NotificationBar />
      </Providers>,
    );
    sim.world.machines[0]!.temp = 110;
    act(() => sim.tickOnce());
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    fireEvent.click(screen.getByRole("button", { name: /throttle to 80%/i }));
    expect(isFinite(sim.world.machines[0]!.speed)).toBe(true);
    expect(sim.world.machines[0]!.hold?.speed).toBe(0.8);
  });
});

describe("commissioning from the capacity alert", () => {
  const overload = () => {
    for (const m of sim.world.machines) if (!m.support) m.load = 0.95;
    sim.world.history = Array.from({ length: 12 }, (_, i) => ({
      ...sim.world.history[0]!,
      tick: i,
      missed: 1,
    }));
    // A no-op override re-renders without ticking, which would recompute the loads set above.
    act(() => sim.override({ kind: "throttle", machineId: "cnc", speed: 1 }));
  };

  it("lets an operator commission a machine", () => {
    render(
      <Providers role="operator">
        <NotificationBar />
      </Providers>,
    );
    act(() => sim.tickOnce());
    overload();
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    const before = sim.world.machines.length;
    fireEvent.click(screen.getByRole("button", { name: "Commission a machine" }));
    expect(sim.world.machines).toHaveLength(before + 1);
  });

  it("disables it for a planner and says who can", () => {
    render(
      <Providers role="planner">
        <NotificationBar />
      </Providers>,
    );
    act(() => sim.tickOnce());
    overload();
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    expect(screen.getByRole("button", { name: "Commission a machine" })).toBeDisabled();
    expect(screen.getByText(/Needs the Operator or Plant manager role/)).toBeInTheDocument();
  });
});

describe("MachineGrid role controls", () => {
  it("lets an operator slow a machine, shows the hold, and releases it", () => {
    render(
      <Providers role="operator">
        <MachineGrid />
      </Providers>,
    );
    const id = sim.world.machines[0]!.id;
    const card = screen.getByTestId(`machine-${id}`);
    fireEvent.click(within(card).getByRole("button", { name: /slow 20%/i }));
    expect(screen.getByTestId(`hold-${id}`)).toHaveTextContent(/80%/);
    fireEvent.click(
      within(screen.getByTestId(`machine-${id}`)).getByRole("button", { name: /release/i }),
    );
    expect(screen.queryByTestId(`hold-${id}`)).toBeNull();
  });

  it("is read-only for a planner", () => {
    render(
      <Providers role="planner">
        <MachineGrid />
      </Providers>,
    );
    expect(screen.queryByRole("button", { name: /slow 20%/i })).toBeNull();
    expect(screen.getByText(/Read-only for this role/i)).toBeInTheDocument();
  });
});

describe("RoleGate", () => {
  it("blocks a role without permission and offers roles that have it", () => {
    render(
      <Providers role="planner">
        <RoleGate need="research" what="The research dashboard">
          <p>secret</p>
        </RoleGate>
      </Providers>,
    );
    expect(screen.getByTestId("role-gate-denied")).toHaveTextContent(
      /not available to the Planner role/i,
    );
    expect(screen.queryByText("secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /switch to researcher/i }));
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("renders children for a permitted role", () => {
    render(
      <Providers role="manager">
        <RoleGate need="research" what="x">
          <p>visible</p>
        </RoleGate>
      </Providers>,
    );
    expect(screen.getByText("visible")).toBeInTheDocument();
  });
});

describe("scenario desk", () => {
  it("disables disruption injection for an operator", () => {
    render(
      <Providers role="operator">
        <EventsPanel />
      </Providers>,
    );
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("lets a planner inject a disruption into the live twin", () => {
    render(
      <Providers role="planner">
        <EventsPanel />
      </Providers>,
    );
    const before = sim.world.events.length;
    fireEvent.click(screen.getByRole("button", { name: /heatwave/i }));
    expect(sim.world.events.length).toBe(before + 1);
  });

  it("runs the eight-scenario sweep without touching the live twin", async () => {
    render(
      <Providers role="researcher">
        <ScenarioLabPanel />
      </Providers>,
    );
    const tickBefore = sim.world.tick;
    fireEvent.click(screen.getByRole("button", { name: /run sweep/i }));
    const table = await screen.findByTestId("sweep-table", undefined, { timeout: 15000 });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 8);
    expect(sim.world.tick).toBe(tickBefore);
  }, 20000);
});

describe("research panels with the exported data", () => {
  const data = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../public/data/research.json"), "utf8"),
  ) as ResearchData;
  const variant = data.variants["real_data"]!;

  it("shows the concerns the data supports", () => {
    render(<FindingsPanel findings={deriveFindings(variant)} />);
    expect(screen.getByTestId("finding-near-constant-policy")).toHaveTextContent(
      /nearly constant/i,
    );
    expect(screen.getByTestId("finding-uniform-attention")).toBeInTheDocument();
  });

  it("renders a 4x4 attention heatmap and switches heads", () => {
    render(<AttentionPanel variant={variant} />);
    const table = screen.getByTestId("attention-heatmap");
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 4);
    const first = within(table).getAllByText(/^0\.\d{3}$/)[0]!.textContent;
    fireEvent.change(screen.getByLabelText("Attention head"), { target: { value: "2" } });
    expect(within(screen.getByTestId("attention-heatmap")).getAllByText(/^0\.\d{3}$/)).toHaveLength(
      16,
    );
    expect(first).toMatch(/^0\.\d{3}$/);
  });

  it("says why attention is missing for the old checkpoint", () => {
    render(<AttentionPanel variant={data.variants["factorysim"]!} />);
    expect(screen.getByText(/different observation size/i)).toBeInTheDocument();
  });

  it("highlights reward as best for the centralized baseline, not the learned policy", () => {
    render(<ComparisonTable variant={variant} data={data} />);
    const rows = within(screen.getByTestId("comparison-table")).getAllByRole("row");
    const learned = rows.find((r) => /Learned LACD/.test(r.textContent ?? ""))!;
    const rewardCell = within(learned).getAllByRole("cell")[1]!;
    expect(rewardCell.className).not.toContain("font-semibold");
  });
});
