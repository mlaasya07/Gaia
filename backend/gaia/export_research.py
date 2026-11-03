"""Export the learned LACD policy and real-dataset evidence for the web app.

Writes one JSON file (default: ../public/data/research.json) that the /research
route reads. The browser never runs torch: this script runs the trained policy in
FactorySim on the same evaluation seeds as `evaluation.csv`, records what the
agents attended to and did, and bundles it with the saved metrics and the
dataset-integration evidence.

Run from the backend/ directory:

    python -m gaia.export_research

Sections written:
  meta        what was run, from which files, plus a reproduction check
  variants    one entry per trained checkpoint (FactorySim-only, real-data-conditioned)
              each with: policy summary, paired deltas vs baselines, training curve,
              attention (mean + per head + one sample episode) and behaviour stats
  evidence    the per-agent real-dataset evidence rows and the 4x4 vectors fed to the policy
  caveats     the limits the integration report states, carried through unchanged
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from .lacd_learning import (
    AGENTS,
    LACDPolicy,
    critic_features,
    load_dataset_evidence,
    make_features,
    predict_history,
    safe_project,
)
from .simulator import FactorySim
from .world_model import load_shared_world_model

METRICS = ("reward", "energy", "energy_cost", "carbon", "throughput", "latency", "health_risk_proxy")
# True when a larger value is better for that metric.
HIGHER_IS_BETTER = {
    "reward": True,
    "throughput": True,
    "energy": False,
    "energy_cost": False,
    "carbon": False,
    "latency": False,
    "health_risk_proxy": False,
}
BASELINES = ("B1_centralized", "B2_independent", "B3_rule_based_coordination")
LEARNED = "LACD_learned"

VARIANTS = {
    "factorysim": {
        "label": "FactorySim only",
        "dir": "outputs/lacd_learning",
    },
    "real_data": {
        "label": "Real-dataset conditioned",
        "dir": "outputs/lacd_learning_realdata",
    },
}


def r(x, nd=4):
    """Round numpy/python numbers for compact, stable JSON."""
    return round(float(x), nd)


def mat(a, nd=4):
    return np.round(np.asarray(a, dtype=float), nd).tolist()


# ---------------------------------------------------------------------------
# Saved metrics (from the existing evaluation.csv, not re-run)
# ---------------------------------------------------------------------------

def summarize_metrics(df: pd.DataFrame) -> dict:
    out = {}
    for policy, g in df.groupby("policy"):
        out[policy] = {m: {"mean": r(g[m].mean()), "std": r(g[m].std())} for m in METRICS}
        out[policy]["n_episodes"] = int(len(g))
    return out


def paired_deltas(df: pd.DataFrame) -> list[dict]:
    """LACD_learned minus each baseline on identical seeds."""
    learned = df[df["policy"] == LEARNED].set_index("seed")
    rows = []
    for base in BASELINES:
        b = df[df["policy"] == base].set_index("seed")
        seeds = learned.index.intersection(b.index)
        for m in METRICS:
            diff = learned.loc[seeds, m] - b.loc[seeds, m]
            better = diff > 0 if HIGHER_IS_BETTER[m] else diff < 0
            rows.append(
                {
                    "baseline": base,
                    "metric": m,
                    "higher_is_better": HIGHER_IS_BETTER[m],
                    "mean_diff": r(diff.mean()),
                    "std_diff": r(diff.std()),
                    "n": int(len(seeds)),
                    "learned_better_in": int(better.sum()),
                }
            )
    return rows


def training_curve(path: Path, max_points: int = 100) -> list[dict]:
    log = pd.read_csv(path)
    k = max(1, int(np.ceil(len(log) / max_points)))
    cols = [c for c in log.columns if c != "episode"]
    rows = []
    for start in range(0, len(log), k):
        chunk = log.iloc[start : start + k]
        row = {"episode": int(chunk["episode"].iloc[-1])}
        row.update({c: r(chunk[c].mean()) for c in cols})
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Re-running the learned policy to record attention and behaviour
# ---------------------------------------------------------------------------

def run_policy(policy, wm, norm, evidence, seeds, horizon):
    """Deterministic evaluation, mirroring gaia.lacd_learning.evaluate."""
    per_episode = []
    all_attn = []  # list of (heads, 4, 4)
    sample = None
    n_steps = 0
    counts = {"maintenance": 0, "cloud": 0, "shift": 0, "forced_maintenance": 0, "production_capped": 0}
    prod_sum = 0.0

    for idx, seed in enumerate(seeds):
        env = FactorySim(seed=seed, horizon=horizon)
        state = env.reset().astype(np.float32)
        forecast = state.copy()
        states, actions = [], []
        steps = []
        done = False
        while not done:
            with torch.no_grad():
                local = torch.tensor(make_features(state, forecast, evidence)[None], dtype=torch.float32)
                glob = torch.tensor(critic_features(state, forecast, evidence)[None], dtype=torch.float32)
                raw, _, _, value, weights = policy.sample(local, glob, deterministic=True)
            raw = raw[0].numpy()
            act = safe_project(raw, state)

            raw_maint = int(raw[1] >= 0.5)
            raw_prod = float(np.clip(raw[0], 0.0, 1.0))
            forced = bool(act["maintenance"] == 1 and raw_maint == 0)
            capped = bool(act["production"] < raw_prod - 1e-9)

            next_state, reward, done, _ = env.step(act)
            attn = weights[0].numpy()  # (heads, query, key)
            all_attn.append(attn)
            n_steps += 1
            counts["maintenance"] += act["maintenance"]
            counts["cloud"] += act["cloud"]
            counts["shift"] += act["shift"]
            counts["forced_maintenance"] += int(forced)
            counts["production_capped"] += int(capped)
            prod_sum += act["production"]

            if idx == 0:
                steps.append(
                    {
                        "t": len(steps),
                        "state": [r(x) for x in state],
                        "reward": r(reward),
                        "value": r(value[0]),
                        "action": {
                            "production": r(act["production"]),
                            "maintenance": act["maintenance"],
                            "cloud": act["cloud"],
                            "shift": act["shift"],
                        },
                        "safety_override": forced or capped,
                        "attention": mat(attn.mean(axis=0)),
                    }
                )

            states.append(state.copy())
            actions.append(
                np.array([act["production"], act["maintenance"], act["cloud"], act["shift"]], dtype=np.float32)
            )
            forecast = predict_history(wm, norm, states, actions)
            state = next_state.astype(np.float32)

        per_episode.append(
            {
                "seed": int(seed),
                "reward": float(env.total["reward"] / horizon),
                "energy": float(env.total["energy"] / horizon),
                "energy_cost": float(env.total["energy_cost"] / horizon),
                "carbon": float(env.total["carbon"] / horizon),
                "throughput": float(env.total["throughput"] / horizon),
                "latency": float(env.total["latency"] / horizon),
                "health_risk_proxy": float(1 - env.state.health),
            }
        )
        if idx == 0:
            sample = {"seed": int(seed), "horizon": horizon, "steps": steps}

    attn_all = np.stack(all_attn)  # (steps, heads, 4, 4)
    behaviour = {
        "steps": n_steps,
        "production_mean": r(prod_sum / n_steps),
        "maintenance_rate": r(counts["maintenance"] / n_steps),
        "cloud_rate": r(counts["cloud"] / n_steps),
        "shift_rate": r(counts["shift"] / n_steps),
        "safety_forced_maintenance_rate": r(counts["forced_maintenance"] / n_steps),
        "safety_production_capped_rate": r(counts["production_capped"] / n_steps),
    }
    attention = {
        "agents": list(AGENTS),
        "layout": "rows = listening agent (query), columns = agent listened to (key)",
        "mean": mat(attn_all.mean(axis=(0, 1))),
        "per_head": [mat(attn_all[:, h].mean(axis=0)) for h in range(attn_all.shape[1])],
        "sample_episode": sample,
    }
    return pd.DataFrame(per_episode), attention, behaviour


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------

def evidence_section(evidence_csv: Path, report_json: Path) -> tuple[dict, list[str]]:
    rows = pd.read_csv(evidence_csv)
    vectors = load_dataset_evidence(evidence_csv)
    report = json.loads(report_json.read_text())
    caveats = list(report.get("dataset_caveats", []))
    section = {
        "rows": [
            {
                "dataset": str(x.dataset),
                "agent": str(x.target_agent),
                "signal": str(x.signal),
                "value": str(x.value),
                "unit": str(x.unit),
                "records": int(x.records) if pd.notna(x.records) else None,
                "interpretation": str(x.interpretation),
                "limitation": str(x.limitation),
            }
            for x in rows.itertuples(index=False)
        ],
        "policy_input_vectors": {
            "layout": "one length-4 evidence vector per agent, in the order below, appended to that agent's observation",
            "agents": list(AGENTS),
            "values": mat(vectors),
        },
        "integration_boundary": report.get("important_boundary", ""),
    }
    return section, caveats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def export(args) -> dict:
    root = Path(args.root)
    wm, norm = load_shared_world_model(str(root / args.world_model))
    wm.eval()
    evidence = load_dataset_evidence(root / args.dataset_evidence)

    variants, repro = {}, {}
    for key, spec in VARIANTS.items():
        vdir = root / spec["dir"]
        ckpt_path = vdir / "lacd_policy.pt"
        eval_path = vdir / "evaluation.csv"
        if not ckpt_path.exists() or not eval_path.exists():
            print(f"skip {key}: missing files in {vdir}")
            continue

        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        saved = pd.read_csv(eval_path)
        seeds = sorted(saved["seed"].unique())[: args.episodes]
        saved = saved[saved["seed"].isin(seeds)]

        policy = LACDPolicy()
        unavailable = None
        try:
            policy.load_state_dict(ckpt["model_state_dict"])
        except RuntimeError:
            unavailable = (
                "This checkpoint was trained with a different observation size than the current "
                "LACDPolicy class, so it cannot be re-run here. Saved metrics and training curve are shown; "
                "attention and behaviour are unavailable."
            )
            print(f"{key}: checkpoint does not match LACDPolicy; exporting saved metrics only")

        if unavailable is None:
            policy.eval()
            rerun, attention, behaviour = run_policy(policy, wm, norm, evidence, seeds, args.horizon)
            learned_saved = saved[saved["policy"] == LEARNED].set_index("seed").loc[seeds]
            rerun_idx = rerun.set_index("seed")
            gap = {m: r(np.abs(rerun_idx[m] - learned_saved[m]).max(), 6) for m in METRICS}
            repro[key] = {"episodes": len(seeds), "max_abs_diff_vs_saved_csv": gap}
        else:
            attention, behaviour = None, None

        variants[key] = {
            "label": spec["label"],
            "rerun_available": unavailable is None,
            "note": unavailable,
            "checkpoint": {
                "file": str(Path(spec["dir"]) / "lacd_policy.pt"),
                "algorithm": ckpt.get("algorithm"),
                "training_episodes": ckpt.get("episodes"),
                "training_seed": ckpt.get("seed"),
                "input_design": ckpt.get("input_design"),
            },
            "policies": summarize_metrics(saved),
            "paired_vs_baselines": paired_deltas(saved),
            "training_curve": training_curve(vdir / "lacd_training_log.csv"),
            "attention": attention,
            "behaviour": behaviour,
        }

    evidence_section_, caveats = evidence_section(
        root / args.dataset_evidence, root / "outputs/dataset_integration/integration_report.json"
    )
    caveats += [
        "The policy is trained on FactorySim rewards; real datasets only condition its observations.",
        "Health-risk, latency and carbon values are simulator proxies, not measurements.",
        "This is a research prototype, not MAPPO.",
    ]
    return {
        "meta": {
            "generated_by": "backend/gaia/export_research.py",
            "agents": list(AGENTS),
            "evaluation_seeds": [int(s) for s in seeds],
            "horizon": args.horizon,
            "metrics": list(METRICS),
            "higher_is_better": HIGHER_IS_BETTER,
            "reproduction_check": repro,
        },
        "variants": variants,
        "evidence": evidence_section_,
        "caveats": caveats,
    }


def main():
    ap = argparse.ArgumentParser(description="Export learned-LACD research data for the web app")
    ap.add_argument("--root", default=".", help="backend directory (default: current)")
    ap.add_argument("--world-model", default="outputs/simulation/shared_world_model.pt")
    ap.add_argument("--dataset-evidence", default="outputs/dataset_integration/agent_evidence.csv")
    ap.add_argument("--episodes", type=int, default=30)
    ap.add_argument("--horizon", type=int, default=96)
    ap.add_argument("--out", default="../public/data/research.json")
    args = ap.parse_args()

    payload = export(args)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1) + "\n")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB), variants: {list(payload['variants'])}")
    for key, chk in payload["meta"]["reproduction_check"].items():
        print(f"reproduction [{key}]: max |rerun - saved| reward = {chk['max_abs_diff_vs_saved_csv']['reward']}")


if __name__ == "__main__":
    main()
