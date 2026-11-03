"""Control baseline: ONE centralized planner with the SAME world model and the TRUE reward.

If LACD only beats heuristics because it has a good model, this planner will match or beat it.
Beating this planner is what would show that agents, negotiation and learning add something.
"""
from __future__ import annotations
from itertools import product
from .coordinator import SafetyLimits, hard_veto
from .twin_model import BASE_ACTION, ExogForecaster, rollout

PRODUCTION_GRID = (.3, .45, .6, .8, .9)


def horizon_reward(s, maintenance: int, horizon: int, health_value: float) -> float:
    """Sum of the simulator's per-step reward terms over the horizon, plus a terminal health bonus."""
    # s.cost already includes the maintenance effort (scaled by the same reward weight)
    return (1.4 * s.throughput - .45 * s.cost - .50 * s.carbonKg - .45 * s.latency * horizon
            - .7 * s.downtime + health_value * (1. - s.healthDeficit / 100.))


class CentralizedMPC:
    def __init__(self, horizon: int = 6, interval: int = 6, health_value: float = 3.0,
                 limits: SafetyLimits | None = None):
        self.horizon, self.interval, self.health_value = horizon, interval, health_value
        self.limits = limits  # None = unconstrained; set to the LACD limits for a like-for-like comparison
        self.exog = ExogForecaster()
        self._action = dict(BASE_ACTION)
        self._step = 0

    def begin_episode(self):
        self.exog.reset(); self._step = 0

    def end_episode(self):
        pass

    def record(self, _):
        pass

    def act(self, t, obs):
        self.exog.update(float(obs[2]), float(obs[3]), float(obs[4]))
        if t % self.interval == 0:
            best, best_v = None, -1e18
            base = rollout(obs, self.exog, None, self.horizon)
            for prod, maint, cloud, shift in product(PRODUCTION_GRID, (0, 1), (0, 1), (0, 1)):
                patch = {"production": prod, "maintenance": maint, "cloud": cloud, "shift": shift}
                s = rollout(obs, self.exog, patch, self.horizon)
                if self.limits and hard_veto(s, base, self.limits):
                    continue
                v = horizon_reward(s, maint, self.horizon, self.health_value)
                if v > best_v:
                    best, best_v = patch, v
            if best is None:  # every candidate vetoed: fall back to the base course
                best = dict(BASE_ACTION)
            self._action = best
            self._step = 0
        a = dict(self._action)
        if self._step > 0:
            a["maintenance"] = 0
        self._step += 1
        return a
