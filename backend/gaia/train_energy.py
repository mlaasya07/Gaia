"""Train a chronological one-minute-ahead energy forecast from HIPE."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .hipe import load_hipe_energy_data


def _chronological_indexes(data: pd.DataFrame):
    unique_times = np.sort(data["timestamp"].dropna().unique())
    if len(unique_times) < 20:
        raise ValueError("At least 20 unique timestamps are required for chronological evaluation.")
    validation_start = pd.Timestamp(unique_times[int(len(unique_times) * 0.70)])
    test_start = pd.Timestamp(unique_times[int(len(unique_times) * 0.85)])
    train = np.flatnonzero(data["timestamp"].lt(validation_start).to_numpy())
    validation = np.flatnonzero(
        data["timestamp"].ge(validation_start).to_numpy()
        & data["timestamp"].lt(test_start).to_numpy()
    )
    test = np.flatnonzero(data["timestamp"].ge(test_start).to_numpy())
    if min(len(train), len(validation), len(test)) == 0:
        raise ValueError("Chronological split produced an empty partition.")
    return train, validation, test, validation_start, test_start


def train_energy_forecaster(source_path: str | Path, out_dir: str | Path, chunk_rows: int = 100_000, seed: int = 42):
    data, metadata = load_hipe_energy_data(source_path, chunk_rows=chunk_rows)
    data = data.dropna(subset=["target_next_minute_kw"]).reset_index(drop=True)
    train_idx, validation_idx, test_idx, validation_start, test_start = _chronological_indexes(data)
    target = "target_next_minute_kw"
    numeric_features = [
        column for column in data.select_dtypes(include=np.number).columns
        if column not in {target, "minute_from_start"}
    ]
    preprocess = ColumnTransformer([
        ("numeric", Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]), numeric_features),
        ("machine", OneHotEncoder(handle_unknown="ignore"), ["Machine"]),
    ])
    model = Pipeline([
        ("preprocess", preprocess),
        ("forecast", RandomForestRegressor(
            n_estimators=180,
            min_samples_leaf=3,
            max_features=0.8,
            random_state=seed,
            n_jobs=-1,
        )),
    ])
    X = data[numeric_features + ["Machine"]]
    y = data[target]
    model.fit(X.iloc[train_idx], y.iloc[train_idx])
    validation_prediction = model.predict(X.iloc[validation_idx])
    model.fit(X.iloc[np.concatenate([train_idx, validation_idx])], y.iloc[np.concatenate([train_idx, validation_idx])])
    test_prediction = model.predict(X.iloc[test_idx])

    def metrics(actual, predicted):
        return {
            "mae_kw": float(mean_absolute_error(actual, predicted)),
            "rmse_kw": float(np.sqrt(mean_squared_error(actual, predicted))),
        }

    result = {
        "task": "one-minute-ahead mean active power forecasting",
        "target": target,
        "dataset": metadata,
        "feature_columns": numeric_features + ["Machine"],
        "split": {
            "strategy": "strict chronological 70/15/15 by timestamp; no future rows enter training",
            "validation_start": str(validation_start),
            "test_start": str(test_start),
            "train_rows": int(len(train_idx)),
            "validation_rows": int(len(validation_idx)),
            "test_rows": int(len(test_idx)),
        },
        "validation": metrics(y.iloc[validation_idx], validation_prediction),
        "test": metrics(y.iloc[test_idx], test_prediction),
        "label_note": "This dataset has no fault labels; scores measure next-minute power prediction only.",
    }
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output / "hipe_energy_forecaster.joblib")
    (output / "metrics.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Path to the supplied HIPE ZIP archive.")
    parser.add_argument("--out-dir", default="outputs/energy")
    parser.add_argument("--chunk-rows", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    result = train_energy_forecaster(args.source, args.out_dir, args.chunk_rows, args.seed)
    print(f"Saved energy model and metrics to {Path(args.out_dir).resolve()}")
    print(json.dumps({"split": result["split"], "validation": result["validation"], "test": result["test"]}, indent=2))


if __name__ == "__main__":
    main()
