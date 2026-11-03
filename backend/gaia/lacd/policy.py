"""LACDPolicy: runs the LACD decision cycle against a FactorySim, with optional online learning."""
from __future__ import annotations
import json
from collections import Counter
from pathlib import Path
from .agents import Agent, create_agents, make_context
from .coordinator import SafetyLimits, decide_collaborative, decide_siloed
from .learning import learn_from_outcome
from .twin_model import BASE_ACTION, ExogForecaster, Summary


def realized_summary(records: list[dict], backlog_start: float) -> Summary:
    n = len(records)
    return Summary(
        kwh=sum(r["energy"] for r in records), cost=sum(r["cost"] for r in records),
        carbonKg=sum(r["carbon"] for r in records), downtime=sum(r["downtime"] for r in records),
        throughput=sum(r["throughput"] for r in records), latency=sum(r["latency"] for r in records) / n,
        healthDeficit=(1. - records[-1]["health"]) * 100.,
        missed=max(0., records[-1]["backlog"] - backlog_start),
        minHealth=min(r["health"] for r in records),
        peakEnergy=max(r["energy"] for r in records), peakCarbon=max(r["carbon"] for r in records))


class LACDPolicy:
    def __init__(self, agents: list[Agent] | None = None, learn: bool = True, mode: str = "collaborative",
                 horizon: int = 6, interval: int = 6, limits: SafetyLimits | None = None):
        assert mode in ("collaborative", "siloed")
        self.agents = agents or create_agents()
        self.learn, self.mode = learn and mode == "collaborative", mode
        self.horizon, self.interval = horizon, interval
        self.limits = limits or SafetyLimits()
        self.exog = ExogForecaster()
        self.decisions = 0
        self.adopted_counts: Counter = Counter()  # which agents' proposals were adopted
        self.veto_count = 0
        self.last_decision: dict | None = None
        self._pending = None
        self._plan: dict = {}
        self._plan_step = 0

    # ---- lifecycle ----
    def begin_episode(self):
        self.exog.reset()
        self._pending, self._plan, self._plan_step = None, {}, 0

    def end_episode(self):
        self._finalize()

    def _finalize(self):
        p = self._pending
        if p and self.learn and len(p["records"]) == self.interval:
            learn_from_outcome(self.agents, p["adopted"], p["predicted"], p["base"],
                               realized_summary(p["records"], p["backlog_start"]))
        self._pending = None

    # ---- per-step API ----
    def act(self, t: int, obs) -> dict:
        self.exog.update(float(obs[2]), float(obs[3]), float(obs[4]))
        if t % self.interval == 0:
            self._finalize()
            ctx = make_context(obs, self.exog, self.horizon)
            if self.mode == "collaborative":
                res = decide_collaborative(self.agents, ctx, self.limits)
                self._plan = res["patch"]
                self._pending = {"adopted": {p.agent_id for p in res["adopted"]},
                                 "predicted": res["summary"], "base": ctx.base,
                                 "records": [], "backlog_start": float(obs[1])}
                self.adopted_counts.update(p.agent_id for p in res["adopted"])
                self.veto_count += len(res["vetoes"])
                self.last_decision = {k: res[k] for k in ("vetoes", "considered", "pareto", "rounds")}
                self.last_decision["adopted"] = [(p.agent_id, p.text) for p in res["adopted"]]
            else:
                self._plan = decide_siloed(self.agents, ctx)
            self.decisions += 1
            self._plan_step = 0
        action = dict(BASE_ACTION)
        action.update(self._plan)
        if self._plan_step > 0:
            action["maintenance"] = 0  # one-shot
        self._plan_step += 1
        return action

    def record(self, step_metrics: dict):
        if self._pending is not None:
            self._pending["records"].append(step_metrics)

    # ---- persistence ----
    def save(self, path, meta: dict | None = None):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps({"meta": meta or {}, "agents": [a.to_dict() for a in self.agents]}, indent=2))

    @staticmethod
    def load_agents(path) -> list[Agent]:
        data = json.loads(Path(path).read_text())
        agents = create_agents()
        saved = {a["id"]: a for a in data["agents"]}
        for a in agents:
            a.weights.update(saved[a.id]["weights"]); a.trust.update(saved[a.id]["trust"])
            a.influence = saved[a.id]["influence"]
        return agents
