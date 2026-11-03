import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TICKS_PER_HOUR, isHeld } from "@/engine/twin";
import { useSimulation } from "@/lib/useSimulation";

const setup = () => renderHook(() => useSimulation(7, { autostart: false }));

describe("useSimulation", () => {
  it("fast-forwards the requested number of ticks", () => {
    const { result } = setup();
    act(() => result.current.advance(TICKS_PER_HOUR));
    expect(result.current.world.tick).toBe(TICKS_PER_HOUR);
  });

  it("makes agent decisions each hour and records lessons once outcomes settle", () => {
    const { result } = setup();
    act(() => result.current.advance(TICKS_PER_HOUR * 4));
    expect(result.current.decisions.length).toBeGreaterThanOrEqual(3);
    expect(result.current.learningLog.length).toBeGreaterThan(0);
    for (const lesson of result.current.learningLog) expect(lesson.length).toBeGreaterThan(10);
  });

  it("keeps a human throttle in force across the next agent decision", () => {
    const { result } = setup();
    const id = result.current.world.machines[0]!.id;
    act(() => result.current.override({ kind: "throttle", machineId: id, speed: 0.8 }));
    act(() => result.current.advance(TICKS_PER_HOUR * 2 + 1));
    const m = result.current.world.machines[0]!;
    expect(isHeld(result.current.world, m)).toBe(true);
    expect(m.hold?.speed).toBe(0.8);
    expect(result.current.eventLog.some((l) => l.startsWith("Human override"))).toBe(true);
  });

  it("dispatches a repair crew to a failed machine and logs it", () => {
    const { result } = setup();
    const m = result.current.world.machines[1]!;
    m.health = 0;
    act(() => result.current.tickOnce());
    expect(m.status).toBe("failed");
    act(() => result.current.sendRepairCrew(m.id));
    expect(m.downTicks).toBeLessThanOrEqual(4);
    expect(result.current.eventLog.some((l) => /repair crew/i.test(l))).toBe(true);
  });

  it("does not log a repair for a machine that has not failed", () => {
    const { result } = setup();
    act(() => result.current.sendRepairCrew(result.current.world.machines[0]!.id));
    expect(result.current.eventLog.some((l) => /repair crew/i.test(l))).toBe(false);
  });

  it("resets the factory and clears logs", () => {
    const { result } = setup();
    act(() => result.current.advance(TICKS_PER_HOUR * 3));
    act(() => result.current.reset(99));
    expect(result.current.world.tick).toBe(0);
    expect(result.current.decisions).toHaveLength(0);
    expect(result.current.learningLog).toHaveLength(0);
    expect(result.current.eventLog).toHaveLength(0);
  });
});
