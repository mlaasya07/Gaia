// Client-side simulation controller: drives the digital twin, the world model,
// the LACD agent collective, learning, events, human overrides and the what-if
// lab. No backend.
import { useCallback, useEffect, useRef, useState } from "react";

import { createAgents, type Agent } from "@/engine/agents";
import { decideCollaborative, type Decision } from "@/engine/consensus";
import { OUTCOME_WINDOW, learnFromOutcome, realizedSummary } from "@/engine/learning";
import {
  TICKS_PER_HOUR,
  applyAction,
  createWorld,
  describeAction,
  commissionMachine,
  dispatchRepair,
  holdThrottle,
  step,
  type Action,
  type EventKind,
  type TickMetrics,
  type World,
} from "@/engine/twin";
import {
  createWorldModel,
  forecast,
  observe,
  type Forecast,
  type WorldModel,
} from "@/engine/worldModel";
import { runCounterfactual, type CfMode, type CfResult } from "@/scenarios/counterfactual";
import { injectEvent } from "@/scenarios/events";

export interface SimApi {
  world: World;
  wm: WorldModel;
  agents: Agent[];
  decisions: Decision[];
  latestForecast: Forecast | null;
  latest: TickMetrics | null;
  running: boolean;
  speedMs: number;
  cf: CfResult | null;
  eventLog: string[];
  learningLog: string[];
  version: number;
  toggle: () => void;
  setSpeedMs: (ms: number) => void;
  tickOnce: () => void;
  advance: (n: number) => void;
  fireEvent: (kind: EventKind) => void;
  override: (action: Action) => void;
  sendRepairCrew: (machineId: string) => void;
  commission: () => void;
  runWhatIf: (mode: CfMode, event?: EventKind) => void;
  reset: (seed?: number) => void;
}

const MAX_DECISIONS = 14;
const MAX_EVENT_LOG = 30;
const MAX_LEARNING_LOG = 24;

export function useSimulation(seed = 7, opts: { autostart?: boolean } = {}) {
  const worldRef = useRef<World>(null as unknown as World);
  const wmRef = useRef<WorldModel>(null as unknown as WorldModel);
  const agentsRef = useRef<Agent[]>([]);
  const decisionsRef = useRef<Decision[]>([]);
  if (!worldRef.current) {
    worldRef.current = createWorld(seed);
    wmRef.current = createWorldModel();
    agentsRef.current = createAgents();
  }

  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(opts.autostart !== false);
  const [speedMs, setSpeedMs] = useState(650);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [latestForecast, setLatestForecast] = useState<Forecast | null>(null);
  const [cf, setCf] = useState<CfResult | null>(null);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [learningLog, setLearningLog] = useState<string[]>([]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const tickOnce = useCallback(() => {
    const world = worldRef.current;
    const wm = wmRef.current;
    const agents = agentsRef.current;

    const metrics = step(world);
    observe(wm, metrics);

    // Decision cycle once per simulated hour.
    if (world.tick % TICKS_PER_HOUR === 0) {
      const d = decideCollaborative(world, wm, agents);
      decisionsRef.current = [d, ...decisionsRef.current].slice(0, MAX_DECISIONS);
      setDecisions(decisionsRef.current);
      setLatestForecast(forecast(wm, world));
    }

    // Settle matured decisions against realized outcomes.
    let settled = false;
    const lessons: string[] = [];
    for (const d of decisionsRef.current) {
      if (!d.outcome && world.tick >= d.tick + OUTCOME_WINDOW) {
        lessons.push(
          ...learnFromOutcome(agents, d, realizedSummary(world, d.tick, d.tick + OUTCOME_WINDOW)),
        );
        settled = true;
      }
    }
    if (settled) {
      setDecisions([...decisionsRef.current]);
      setLearningLog((prev) => [...lessons, ...prev].slice(0, MAX_LEARNING_LOG));
    }

    bump();
  }, [bump]);

  const advance = useCallback(
    (n: number) => {
      for (let i = 0; i < n; i++) tickOnce();
    },
    [tickOnce],
  );

  useEffect(() => {
    if (!running) return;
    const id = setInterval(tickOnce, speedMs);
    return () => clearInterval(id);
  }, [running, speedMs, tickOnce]);

  const toggle = useCallback(() => setRunning((r) => !r), []);

  const fireEvent = useCallback(
    (kind: EventKind) => {
      const label = injectEvent(worldRef.current, kind);
      setEventLog((prev) =>
        [`${label} @ tick ${worldRef.current.tick}`, ...prev].slice(0, MAX_EVENT_LOG),
      );
      bump();
    },
    [bump],
  );

  const override = useCallback(
    (action: Action) => {
      const text = describeAction(worldRef.current, action);
      // A human speed change is held against the agents; every other action applies as normal.
      if (action.kind === "throttle")
        holdThrottle(worldRef.current, action.machineId, action.speed);
      else applyAction(worldRef.current, action);
      setEventLog((prev) =>
        [`Human override: ${text} @ tick ${worldRef.current.tick}`, ...prev].slice(
          0,
          MAX_EVENT_LOG,
        ),
      );
      bump();
    },
    [bump],
  );

  const sendRepairCrew = useCallback(
    (machineId: string) => {
      const m = worldRef.current.machines.find((x) => x.id === machineId);
      if (!m) return;
      // Only claim a dispatch that happened: dispatchRepair refuses machines that have not failed.
      if (!dispatchRepair(worldRef.current, machineId)) return;
      setEventLog((prev) =>
        [
          `Human override: repair crew dispatched to ${m.name} @ tick ${worldRef.current.tick}`,
          ...prev,
        ].slice(0, MAX_EVENT_LOG),
      );
      bump();
    },
    [bump],
  );

  const commission = useCallback(() => {
    const added = commissionMachine(worldRef.current);
    if (!added) return;
    setEventLog((prev) =>
      [`Human override: commissioned ${added.name} @ tick ${worldRef.current.tick}`, ...prev].slice(
        0,
        MAX_EVENT_LOG,
      ),
    );
    bump();
  }, [bump]);

  const runWhatIf = useCallback((mode: CfMode, event?: EventKind) => {
    setCf(
      runCounterfactual(worldRef.current, wmRef.current, agentsRef.current, mode, undefined, event),
    );
  }, []);

  const reset = useCallback(
    (nextSeed = seed) => {
      worldRef.current = createWorld(nextSeed);
      wmRef.current = createWorldModel();
      agentsRef.current = createAgents();
      decisionsRef.current = [];
      setDecisions([]);
      setLatestForecast(null);
      setCf(null);
      setEventLog([]);
      setLearningLog([]);
      bump();
    },
    [bump, seed],
  );

  const world = worldRef.current;
  return {
    world,
    wm: wmRef.current,
    agents: agentsRef.current,
    decisions,
    latestForecast,
    latest: world.history[world.history.length - 1] ?? null,
    running,
    speedMs,
    cf,
    eventLog,
    learningLog,
    version,
    toggle,
    setSpeedMs,
    tickOnce,
    advance,
    fireEvent,
    override,
    sendRepairCrew,
    commission,
    runWhatIf,
    reset,
  };
}
