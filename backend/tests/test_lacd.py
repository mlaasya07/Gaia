"""Behavioral tests for the LACD port. Run: python -m pytest tests -q"""
import json
import numpy as np
import pytest
from gaia.simulator import FactorySim
from gaia.lacd import LACDPolicy, create_agents, METRICS, AGENT_IDS
from gaia.lacd.agents import deltas, utility, make_context
from gaia.lacd.coordinator import SafetyLimits, hard_veto, decide_collaborative
from gaia.lacd.experiment import run_episode
from gaia.lacd.twin_model import ExogForecaster, rollout, Summary, MAINT_COST_EQUIV
from gaia.lacd.zema_prior import ZemaHealthPrior


def _obs(health=.8, backlog=.4, price=1., carbon=.6, workload=.55, edge=.3):
    return np.array([health, backlog, price, carbon, workload, edge, 0.])


def _exog(o):
    e = ExogForecaster(); e.update(float(o[2]), float(o[3]), float(o[4])); return e


def test_rollout_matches_simulator_for_one_noise_free_step():
    """The planning twin must use the same plan-dependent equations as FactorySim."""
    sim = FactorySim(seed=3, horizon=96); obs = sim.reset()
    action = {"production": .8, "maintenance": 1, "cloud": 1, "shift": 1}
    s = rollout(obs, _exog(obs), action, horizon=1)
    _, _, _, tot = sim.step(action)
    assert s.kwh == pytest.approx(tot["energy"]); assert s.carbonKg == pytest.approx(tot["carbon"])
    assert s.throughput == pytest.approx(tot["throughput"]); assert s.downtime == pytest.approx(tot["downtime"])
    assert s.latency == pytest.approx(tot["latency"])
    assert s.cost == pytest.approx(tot["energy_cost"] + MAINT_COST_EQUIV)


def test_maintenance_is_one_shot_and_costs_something():
    o = _obs(health=.5)
    with_m = rollout(o, _exog(o), {"maintenance": 1}, 6); without = rollout(o, _exog(o), None, 6)
    assert with_m.cost - without.cost == pytest.approx(MAINT_COST_EQUIV)  # same energy, plus one service
    assert with_m.healthDeficit < without.healthDeficit


def test_forecaster_does_not_see_the_future():
    e = ExogForecaster()
    for v in (.5, .5, .5): e.update(1., v, .5)
    assert e.forecast("carbon", 3) == pytest.approx(.5, abs=1e-6)  # flat history -> flat forecast


def test_veto_blocks_energy_and_emission_spikes():
    base = Summary(peakEnergy=.64, peakCarbon=.4, minHealth=.8)
    assert hard_veto(Summary(peakEnergy=1.2, peakCarbon=.4, minHealth=.8), base, SafetyLimits())
    assert hard_veto(Summary(peakEnergy=.7, peakCarbon=.9, minHealth=.8), base, SafetyLimits())
    assert hard_veto(Summary(peakEnergy=.7, peakCarbon=.5, minHealth=.8), base, SafetyLimits()) is None


def test_chosen_plan_never_violates_hard_limits():
    lim = SafetyLimits(); agents = create_agents()
    rng = np.random.default_rng(0)
    for _ in range(40):
        o = _obs(health=rng.uniform(.1, 1), backlog=rng.uniform(0, 2), price=rng.uniform(.4, 1.5),
                 carbon=rng.uniform(.15, 1), workload=rng.uniform(.1, 1), edge=rng.uniform(0, 1))
        ctx = make_context(o, _exog(o), 6)
        res = decide_collaborative(agents, ctx, lim)
        if res["adopted"]:
            assert hard_veto(res["summary"], ctx.base, lim) is None


def test_adopted_proposals_never_share_a_control():
    agents = create_agents(); o = _obs(); ctx = make_context(o, _exog(o), 6)
    res = decide_collaborative(agents, ctx, SafetyLimits())
    targets = [next(iter(p.patch)) for p in res["adopted"]]
    assert len(targets) == len(set(targets))


def test_policy_is_deterministic_and_learning_changes_weights():
    a = [run_episode(10_000 + i, LACDPolicy(learn=False), 96)["reward"] for i in range(3)]
    b = [run_episode(10_000 + i, LACDPolicy(learn=False), 96)["reward"] for i in range(3)]
    assert a == b
    pol = LACDPolicy(learn=True); before = json.dumps([x.to_dict() for x in pol.agents])
    for i in range(3): run_episode(10_000 + i, pol, 96)
    assert json.dumps([x.to_dict() for x in pol.agents]) != before
    frozen = LACDPolicy(learn=False); fb = json.dumps([x.to_dict() for x in frozen.agents])
    run_episode(10_000, frozen, 96); assert json.dumps([x.to_dict() for x in frozen.agents]) == fb


def test_save_load_roundtrip(tmp_path):
    pol = LACDPolicy(learn=True)
    for i in range(2): run_episode(20_000 + i, pol, 96)
    pol.save(tmp_path / "w.json")
    loaded = LACDPolicy.load_agents(tmp_path / "w.json")
    for a, b in zip(pol.agents, loaded):
        assert a.weights == pytest.approx(b.weights) and a.trust == pytest.approx(b.trust)


def test_health_override_keeps_random_stream_identical():
    s1 = FactorySim(seed=5); s1.reset(); s2 = FactorySim(seed=5); s2.reset(initial_health=.3)
    assert s2.state.health == pytest.approx(.3)
    for _ in range(5):
        o1, *_ = s1.step({"production": .6}); o2, *_ = s2.step({"production": .6})
        assert o1[2:5] == pytest.approx(o2[2:5])  # price, carbon, workload identical


def test_zema_prior_uses_real_labels():
    p = ZemaHealthPrior()
    assert len(p.values) == 2205 and 0 <= p.values.min() and p.values.max() <= 1
    assert p.sample(1) == p.sample(1)
