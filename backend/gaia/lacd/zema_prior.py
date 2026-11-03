"""Degradation prior derived from real ZeMA hydraulic-rig component-condition labels.

Each ZeMA cycle has four component labels (cooler, valve, pump leakage, accumulator pressure).
We normalize each to [0, 1] (1 = healthy) and average them into a composite health value, then
sample cycles as starting health for simulated episodes.

Assumption (state it when you present): ZeMA is a fault-injection rig, so its labels are
degradation-heavy by design. This prior is a stress-test condition, not a claim about typical
factory fleets, and the simulator's machines are not hydraulic rigs.
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
import pandas as pd

DEFAULT_CSV = Path(__file__).resolve().parents[2] / "outputs" / "maintenance" / "zema_targets.csv"


def composite_health(df: pd.DataFrame) -> np.ndarray:
    parts = [(df["cooler_condition"] - 3) / 97, (df["valve_condition"] - 73) / 27,
             1 - df["pump_leakage"] / 2, (df["accumulator_pressure"] - 90) / 40]
    return np.clip(np.mean(parts, axis=0), 0., 1.)


class ZemaHealthPrior:
    def __init__(self, csv_path=DEFAULT_CSV, floor: float = .15):
        self.values = np.maximum(composite_health(pd.read_csv(csv_path)), floor)

    def sample(self, seed: int) -> float:
        return float(self.values[np.random.default_rng(seed + 7_000_000).integers(len(self.values))])

    def summary(self) -> dict:
        v = self.values
        return {"n_cycles": int(len(v)), "mean": float(v.mean()), "p05": float(np.percentile(v, 5)),
                "p50": float(np.percentile(v, 50)), "p95": float(np.percentile(v, 95))}
