"""World model used for planning: known-structure physics twin plus an online exogenous forecaster.

Physics: the plan-dependent equations (health, throughput, energy, carbon, latency, backlog)
are the same ones FactorySim uses, i.e. this is a digital twin whose structure is known.
Exogenous series (energy price, grid carbon intensity, workload) are NOT read from the
simulator's formulas. They are forecast online from observed values with a damped-trend
smoother, so the planner cannot see the future.
"""
from __future__ import annotations
from dataclasses import dataclass, field

BASE_ACTION = {"production": .6, "maintenance": 0, "cloud": 0, "shift": 0}
# Servicing effort is booked as cost, scaled by the simulator reward weights: 1.2 * 0.10 / 0.45.
MAINT_COST_EQUIV = 1.2 * .10 / .45
EXOGENOUS = ("price", "carbon", "workload")


@dataclass
class Summary:
    """Aggregate outcome of a plan over a horizon (same fields for predicted and realized)."""
    kwh: float = 0.
    cost: float = 0.
    carbonKg: float = 0.
    downtime: float = 0.
    healthDeficit: float = 0.   # (1 - final health) * 100
    missed: float = 0.          # backlog growth over the window (unmet demand)
    throughput: float = 0.
    latency: float = 0.         # mean per step
    minHealth: float = 1.
    peakEnergy: float = 0.      # max per-step energy
    peakCarbon: float = 0.      # max per-step carbon


@dataclass
class ExogForecaster:
    alpha: float = .5   # level smoothing
    beta: float = .3    # trend smoothing
    phi: float = .8     # trend damping
    level: dict = field(default_factory=dict)
    trend: dict = field(default_factory=dict)

    def reset(self):
        self.level.clear(); self.trend.clear()

    def update(self, price: float, carbon: float, workload: float):
        for k, v in zip(EXOGENOUS, (price, carbon, workload)):
            if k not in self.level:
                self.level[k], self.trend[k] = v, 0.
                continue
            prev = self.level[k]
            self.level[k] = self.alpha * v + (1 - self.alpha) * (prev + self.phi * self.trend[k])
            self.trend[k] = self.beta * (self.level[k] - prev) + (1 - self.beta) * self.phi * self.trend[k]

    def forecast(self, k: str, steps_ahead: int) -> float:
        damp = sum(self.phi ** i for i in range(1, steps_ahead + 1))
        return self.level[k] + self.trend[k] * damp


def _merge(plan_patch: dict | None) -> dict:
    a = dict(BASE_ACTION)
    if plan_patch:
        a.update(plan_patch)
    return a


def rollout(obs, exog: ExogForecaster, patch: dict | None, horizon: int, start_price=None) -> Summary:
    """Expected outcome of holding `patch` (merged over the base course) for `horizon` steps.

    Maintenance is a one-shot action applied on the first step only. `obs` is the simulator
    observation (health, backlog, price, carbon, workload, edge_load, time_fraction).
    """
    health, backlog, price, carbon, workload, edge_load = (float(x) for x in obs[:6])
    a = _merge(patch)
    out = Summary(minHealth=health)
    backlog0 = backlog
    lat_sum = 0.
    for k in range(horizon):
        if k > 0:
            price = min(1.5, max(.4, exog.forecast("price", k)))
            carbon = min(1., max(.15, exog.forecast("carbon", k)))
            workload = min(1., max(.1, exog.forecast("workload", k)))
        production = a["production"]
        maint = a["maintenance"] if k == 0 else 0
        cloud, shift = a["cloud"], a["shift"]
        eff_health = min(1., health + (.18 if maint else 0.) - .006 * production)
        downtime = .16 if (health < .35 and not maint) else 0.
        throughput = max(0., production * (.55 + .45 * eff_health) - downtime)
        energy = .35 + .8 * production ** 2 + (.10 if cloud else 0.)
        eff_carbon = max(.1, carbon - (.15 if shift else 0.))
        latency = (.06 + .25 * edge_load ** 2) if not cloud else (.11 + .07 * edge_load)
        latency += .05 if shift else 0.
        out.kwh += energy
        out.cost += energy * price + (MAINT_COST_EQUIV if maint else 0.)
        out.carbonKg += energy * eff_carbon
        out.downtime += downtime
        out.throughput += throughput
        lat_sum += latency
        out.peakEnergy = max(out.peakEnergy, energy)
        out.peakCarbon = max(out.peakCarbon, energy * eff_carbon)
        backlog = min(2., max(0., backlog + workload - throughput))
        health = min(1., max(.05, eff_health))
        out.minHealth = min(out.minHealth, health)
        edge_load = min(1., max(0., .3 + .25 * production))
    out.latency = lat_sum / horizon
    out.healthDeficit = (1. - health) * 100.
    out.missed = max(0., backlog - backlog0)
    return out
