"""Fit an unlabeled Smart Manufacturing event-monitoring baseline."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .smart_manufacturing import load_smart_manufacturing_data


def train_monitoring_model(source_path: str | Path, out_dir: str | Path, seed: int = 42):
    data, metadata = load_smart_manufacturing_data(source_path)
    boundary = max(1, int(len(data) * 0.70))
    validation_end = max(boundary + 1, int(len(data) * 0.85))
    if validation_end >= len(data):
        raise ValueError("Not enough time bins for train/validation/test evaluation.")
    feature_columns = [
        column for column in data.select_dtypes(include=np.number).columns
        if column != "minute_from_start"
    ]
    model = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("detector", IsolationForest(
            n_estimators=300,
            contamination="auto",
            random_state=seed,
            n_jobs=-1,
        )),
    ])
    train = data.iloc[:boundary]
    validation = data.iloc[boundary:validation_end]
    test = data.iloc[validation_end:]
    model.fit(train[feature_columns])
    validation_scores = -model.decision_function(validation[feature_columns])
    threshold = float(np.quantile(validation_scores, 0.99))
    test_scores = -model.decision_function(test[feature_columns])
    result = {
        "task": "unsupervised minute-level operational anomaly screening",
        "source": metadata,
        "feature_columns": feature_columns,
        "split": {
            "strategy": "strict chronological 70/15/15; model fit on training period only",
            "train_rows": int(len(train)),
            "validation_rows": int(len(validation)),
            "test_rows": int(len(test)),
            "train_end_minute": int(train["minute_from_start"].max()),
            "validation_end_minute": int(validation["minute_from_start"].max()),
        },
        "threshold": threshold,
        "validation_screened_fraction": float(np.mean(validation_scores >= threshold)),
        "test_screened_count": int(np.sum(test_scores >= threshold)),
        "test_screened_fraction": float(np.mean(test_scores >= threshold)),
        "interpretation": "Unsupervised screening score, not a fault diagnosis or supervised anomaly accuracy; no ground-truth fault labels are present.",
    }
    scored_test = test[["minute_from_start"]].copy()
    scored_test["anomaly_score"] = test_scores
    scored_test["screened"] = test_scores >= threshold
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output / "smart_manufacturing_isolation_forest.joblib")
    (output / "metrics.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    scored_test.to_csv(output / "test_anomaly_scores.csv", index=False)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Smart Manufacturing dataset archive.")
    parser.add_argument("--out-dir", default="outputs/monitoring")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    result = train_monitoring_model(args.source, args.out_dir, args.seed)
    print(f"Saved monitoring model and scores to {Path(args.out_dir).resolve()}")
    print(json.dumps({key: result[key] for key in ["task", "split", "validation_screened_fraction", "test_screened_count", "test_screened_fraction", "interpretation"]}, indent=2))


if __name__ == "__main__":
    main()
