"""Pretrain LACD agents, then compare all policies on held-out seeds (paired, identical environments).

    python -m gaia.lacd.experiment --episodes 100 --pretrain-episodes 100
"""
from __future__ import annotations
import argparse, json, time
from pathlib import Path
import numpy as np
import pandas as pd
from ..simulator import FactorySim
from ..agents import act_centralized, act_independent
from .agents import create_agents
from .policy import LACDPolicy
from .coordinator import SafetyLimits
from .zema_prior import ZemaHealthPrior
from .mpc_baseline import CentralizedMPC
from .twin_model import MAINT_COST_EQUIV

EVAL_SEED0, PRETRAIN_SEED0 = 10_000, 20_000  # disjoint seed ranges: pretraining never sees eval environments
KEYS = ("reward", "throughput", "energy", "energy_cost", "carbon", "downtime", "latency", "maintenance")
TAIL_KEYS = ("peak_step_energy", "p95_step_carbon", "max_step_carbon")
CONDITIONS = ("default", "zema_prior")


def run_episode(seed, policy, horizon=96, prior: ZemaHealthPrior | None = None) -> dict:
    sim = FactorySim(seed=seed, horizon=horizon)
    obs = sim.reset(initial_health=prior.sample(seed) if prior else None)
    lacd = isinstance(policy, (LACDPolicy, CentralizedMPC))
    if lacd:
        policy.begin_episode()
    step_energy, step_carbon = [], []
    for t in range(horizon):
        action = policy.act(t, obs) if lacd else policy(obs)
        before = dict(sim.total)
        obs, _, _, tot = sim.step(action)
        d = {k: tot[k] - before[k] for k in tot}
        step_energy.append(d["energy"]); step_carbon.append(d["carbon"])
        if lacd:
            policy.record({"energy": d["energy"], "cost": d["energy_cost"] + (MAINT_COST_EQUIV if action["maintenance"] else 0.), "carbon": d["carbon"],
                           "throughput": d["throughput"], "downtime": d["downtime"], "latency": d["latency"],
                           "health": sim.state.health, "backlog": sim.state.backlog})
    if lacd:
        policy.end_episode()
    m = {k: sim.total[k] / horizon for k in ("reward", "throughput", "energy", "energy_cost", "carbon",
                                             "downtime", "latency")}
    m["maintenance"] = sim.total["maintenance"]  # count per episode
    m.update(peak_step_energy=max(step_energy), p95_step_carbon=float(np.percentile(step_carbon, 95)),
             max_step_carbon=max(step_carbon), seed=seed)
    return m


def pretrain(n_episodes, horizon, prior, path) -> LACDPolicy:
    """Offline pretraining: online learning over held-out-from-eval seeds, mixing both conditions."""
    pol = LACDPolicy(learn=True)
    for i in range(n_episodes):
        run_episode(PRETRAIN_SEED0 + i, pol, horizon, prior if i % 2 else None)
    pol.save(path, meta={"pretrain_episodes": n_episodes, "seeds": [PRETRAIN_SEED0, PRETRAIN_SEED0 + n_episodes - 1],
                         "conditions": "alternating default / zema_prior"})
    return pol


def build_policies(pretrained_path):
    def pre(learn): return LACDPolicy(agents=LACDPolicy.load_agents(pretrained_path), learn=learn)
    return {
        "B1_centralized": act_centralized,
        "B2_independent": act_independent,
        "Centralized_MPC": CentralizedMPC(),
        "Centralized_MPC_safe": CentralizedMPC(limits=SafetyLimits()),
        "Siloed_agents": LACDPolicy(mode="siloed", learn=False),
        "LACD_static": LACDPolicy(learn=False),
        "LACD_cold_online": LACDPolicy(learn=True),
        "LACD_pretrained_online": pre(True),
        "LACD_pretrained_frozen": pre(False),
    }


def paired_ci(a, b, n_boot=10_000, seed=0):
    diff = np.asarray(a) - np.asarray(b)
    rng = np.random.default_rng(seed)
    boots = rng.choice(diff, size=(n_boot, len(diff)), replace=True).mean(axis=1)
    return float(diff.mean()), float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))


COMPARISONS = [("LACD_pretrained_online", "B1_centralized"), ("LACD_pretrained_online", "Centralized_MPC"),
               ("Centralized_MPC", "B1_centralized"), ("LACD_pretrained_online", "Siloed_agents"),
               ("LACD_pretrained_online", "LACD_static"), ("LACD_cold_online", "LACD_static"),
               ("LACD_pretrained_frozen", "LACD_static"), ("Siloed_agents", "B1_centralized")]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", type=int, default=100)
    ap.add_argument("--pretrain-episodes", type=int, default=100)
    ap.add_argument("--horizon", type=int, default=96)
    ap.add_argument("--out", default="outputs/lacd")
    ap.add_argument("--export-frontend", default=None, help="write evidence JSON for the React app")
    args = ap.parse_args(argv)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    prior = ZemaHealthPrior()
    t0 = time.time()
    pretrain(args.pretrain_episodes, args.horizon, prior, out / "lacd_pretrained.json")
    print(f"pretrained in {time.time() - t0:.0f}s")

    rows = []
    for cond in CONDITIONS:
        policies = build_policies(out / "lacd_pretrained.json")
        for name, pol in policies.items():
            for i in range(args.episodes):
                m = run_episode(EVAL_SEED0 + i, pol, args.horizon, prior if cond == "zema_prior" else None)
                rows.append({"condition": cond, "policy": name, **m})
        print(f"evaluated {cond} ({time.time() - t0:.0f}s)")
    df = pd.DataFrame(rows)
    df.to_csv(out / "episode_metrics.csv", index=False)
    cols = list(KEYS) + list(TAIL_KEYS)
    summ = df.groupby(["condition", "policy"], sort=False)[cols].agg(["mean", "std"])
    summ.to_csv(out / "policy_summary.csv")

    comps = []
    for cond in CONDITIONS:
        sub = df[df.condition == cond]
        for a, b in COMPARISONS:
            A = sub[sub.policy == a].sort_values("seed"); B = sub[sub.policy == b].sort_values("seed")
            for k in ("reward", "throughput", "carbon", "peak_step_energy", "max_step_carbon", "downtime"):
                mean, lo, hi = paired_ci(A[k].values, B[k].values)
                comps.append({"condition": cond, "a": a, "b": b, "metric": k, "mean_diff": mean,
                              "ci95_lo": lo, "ci95_hi": hi, "significant": bool(lo > 0 or hi < 0)})
    pd.DataFrame(comps).to_csv(out / "paired_comparisons.csv", index=False)

    meta = {"episodes": args.episodes, "pretrain_episodes": args.pretrain_episodes, "horizon": args.horizon,
            "eval_seeds": [EVAL_SEED0, EVAL_SEED0 + args.episodes - 1],
            "pretrain_seeds": [PRETRAIN_SEED0, PRETRAIN_SEED0 + args.pretrain_episodes - 1]}
    (out / "run_meta.json").write_text(json.dumps(meta, indent=2))
    if args.export_frontend:
        export_frontend(args.export_frontend, df, comps, summ, prior, out, meta)
    print(summ[[("reward", "mean"), ("throughput", "mean"), ("carbon", "mean"), ("peak_step_energy", "mean")]].round(4))


def export_frontend(path, df, comps, summ, prior, out, meta):
    ff = Path("outputs/maintenance/metrics.json")
    zema = json.loads(ff.read_text())["targets"] if ff.exists() else {}
    flat = []
    for (cond, pol), row in summ.iterrows():
        flat.append({"condition": cond, "policy": pol,
                     **{f"{k}_{s}": float(row[(k, s)]) for k in list(KEYS) + list(TAIL_KEYS) for s in ("mean", "std")}})
    payload = {
        "meta": meta, "policies": flat, "paired": comps,
        "pretrained_agents": json.loads((out / "lacd_pretrained.json").read_text())["agents"],
        "zema_health_prior": prior.summary(),
        "zema_classifier_test": {t: {"accuracy": v["test_accuracy"], "macro_f1": v["test_macro_f1"]} for t, v in zema.items()},
        "caveats": [
            "All policy results come from the Gaia factory simulator, not a real plant.",
            "The planning model uses the simulator's own equations (known-structure twin); exogenous series are forecast online.",
            "The zema_prior condition samples starting health from ZeMA fault-injection labels, a degradation-heavy stress test.",
            "Online-learning policies keep learning across the evaluation episodes in seed order.",
        ]}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
