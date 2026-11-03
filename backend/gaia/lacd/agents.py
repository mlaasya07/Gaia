"""LACD agents: objectives, learnable utility weights, inter-agent trust, proposal generation."""
from __future__ import annotations
from dataclasses import dataclass, field
from .twin_model import BASE_ACTION, Summary, rollout, ExogForecaster

AGENT_IDS = ("energy", "carbon", "maintenance", "production", "orchestration")
METRICS = ("kwh", "cost", "carbonKg", "downtime", "healthDeficit", "missed", "throughput", "latency")
ACTION_TARGETS = ("production", "maintenance", "cloud", "shift")

_DEFS = {
    "energy": ("Minimize kWh and cost", ("kwh", "cost"), {"kwh": 1., "cost": .8}),
    "carbon": ("Minimize emissions, shift flexible load to clean windows", ("carbonKg",), {"carbonKg": 1.2}),
    "maintenance": ("Keep machines healthy, service before failure", ("downtime", "healthDeficit"),
                    {"downtime": 1., "healthDeficit": .7}),
    "production": ("Maximize throughput, avoid backlog", ("missed", "throughput"), {"missed": 1.2, "throughput": .6}),
    "orchestration": ("Place compute on edge or cloud for latency", ("latency",),
                      {"latency": 1., "kwh": .2, "carbonKg": .2}),
}


@dataclass
class Agent:
    id: str
    goal: str
    primary: tuple
    weights: dict
    trust: dict
    influence: float = .6
    reward_history: list = field(default_factory=list)
    accuracy_history: list = field(default_factory=list)

    def to_dict(self):
        return {"id": self.id, "weights": self.weights, "trust": self.trust, "influence": self.influence}


def create_agents() -> list[Agent]:
    agents = []
    for aid in AGENT_IDS:
        goal, primary, over = _DEFS[aid]
        weights = {k: over.get(k, .05) for k in METRICS}
        trust = {other: (1. if other == aid else .6) for other in AGENT_IDS}
        agents.append(Agent(aid, goal, primary, weights, trust))
    return agents


# Normalizers put each metric delta on a comparable scale (positive = better than base).
# NORM_REL is the relative change that counts as one unit. The original frontend uses 0.02 for
# small single-machine moves; Gaia's production changes are 30-50% swings, so it is set to 0.10.
# Chosen on exploration seeds 20000+ (never on the evaluation seeds); see README.
NORM_REL = .10


def deltas(plan: Summary, base: Summary) -> dict:
    def rel(v, floor):
        return max(v * NORM_REL, floor)
    raw = {
        "kwh": (base.kwh - plan.kwh) / rel(base.kwh, .05),
        "cost": (base.cost - plan.cost) / rel(base.cost, .05),
        "carbonKg": (base.carbonKg - plan.carbonKg) / rel(base.carbonKg, .03),
        "downtime": (base.downtime - plan.downtime) / .15,
        "healthDeficit": (base.healthDeficit - plan.healthDeficit) / 5.,
        "missed": (base.missed - plan.missed) / .15,
        "throughput": (plan.throughput - base.throughput) / rel(abs(base.throughput), .05),
        "latency": (base.latency - plan.latency) / rel(base.latency, .005),
    }
    return {k: max(-5., min(5., v)) for k, v in raw.items()}


def utility(agent: Agent, d: dict) -> float:
    tot = sum(agent.weights[k] for k in METRICS)
    return sum(agent.weights[k] * d[k] for k in METRICS) / tot


@dataclass
class PlanContext:
    obs: object
    exog: ExogForecaster
    horizon: int
    base: Summary = None
    _cache: dict = field(default_factory=dict)

    def eval_plan(self, patch: dict | None, horizon: int | None = None) -> Summary:
        h = horizon or self.horizon
        key = (tuple(sorted((patch or {}).items())), h)
        if key not in self._cache:
            self._cache[key] = rollout(self.obs, self.exog, patch, h)
        return self._cache[key]


def make_context(obs, exog, horizon) -> PlanContext:
    ctx = PlanContext(obs, exog, horizon)
    ctx.base = ctx.eval_plan(None)
    return ctx


def target_of(patch: dict) -> str:
    return next(iter(patch))


@dataclass
class Proposal:
    agent_id: str
    patch: dict
    text: str
    summary: Summary
    own_gain: float
    scores: dict = field(default_factory=dict)
    objections: list = field(default_factory=list)
    withdrawn: bool = False


def candidates(agent_id: str, ctx: PlanContext) -> list[dict]:
    h, backlog, price, carbon, workload, edge = (float(x) for x in ctx.obs[:6])
    if agent_id == "energy":
        return [{"production": .45}, {"production": .35}]
    if agent_id == "carbon":
        out = [{"shift": 1}]
        if carbon > ctx.exog.level.get("carbon", carbon):
            out.append({"production": .45})
        return out
    if agent_id == "maintenance":
        out = [{"maintenance": 1}]
        if h < .6:
            out.append({"production": .5})
        return out
    if agent_id == "production":
        return [{"production": .8}, {"production": .9}]
    return [{"cloud": 1}]


def describe(patch: dict) -> str:
    k, v = next(iter(patch.items()))
    return {"production": f"set production to {v:.2f}", "maintenance": "service machines now",
            "cloud": "offload compute to cloud", "shift": "defer flexible load to cleaner window"}[k]


def evaluate_proposal(agent: Agent, ctx: PlanContext, patch: dict):
    s = ctx.eval_plan(patch)
    return s, utility(agent, deltas(s, ctx.base))


def propose(agent: Agent, ctx: PlanContext, min_gain: float = .02) -> Proposal | None:
    best = None
    for patch in candidates(agent.id, ctx):
        s, gain = evaluate_proposal(agent, ctx, patch)
        if gain > min_gain and (best is None or gain > best.own_gain):
            best = Proposal(agent.id, patch, describe(patch), s, gain)
    return best
