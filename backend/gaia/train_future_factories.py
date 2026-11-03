"""Train a leakage-aware Future Factories assembly-state classifier."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .future_factories import grouped_train_validation_test_split, load_future_factory_data


def train_future_factory_classifier(
    source_path: str | Path,
    out_dir: str | Path,
    max_rows: int = 50_000,
    seed: int = 42,
) -> dict:
    X, y, groups, metadata = load_future_factory_data(source_path, max_labeled_rows=max_rows)
    train_idx, validation_idx, test_idx = grouped_train_validation_test_split(y, groups, seed)
    model = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("classifier", RandomForestClassifier(
            n_estimators=250,
            min_samples_leaf=2,
            class_weight="balanced_subsample",
            random_state=seed,
            n_jobs=-1,
        )),
    ])
    model.fit(X.iloc[train_idx], y.iloc[train_idx])
    validation_predictions = model.predict(X.iloc[validation_idx])
    test_predictions = model.predict(X.iloc[test_idx])
    class_labels = sorted(y.unique())
    result = {
        "task": "Future Factories assembly-description classification",
        "target": "Description (non-empty records only)",
        "dataset": metadata,
        "split": {
            "strategy": "StratifiedGroupKFold over contiguous 8192-row source blocks; 80/10/10",
            "seed": seed,
            "train_rows": int(len(train_idx)),
            "validation_rows": int(len(validation_idx)),
            "test_rows": int(len(test_idx)),
            "train_groups": sorted(int(v) for v in set(groups[train_idx])),
            "validation_groups": sorted(int(v) for v in set(groups[validation_idx])),
            "test_groups": sorted(int(v) for v in set(groups[test_idx])),
        },
        "validation": {
            "accuracy": float(accuracy_score(y.iloc[validation_idx], validation_predictions)),
            "macro_f1": float(f1_score(y.iloc[validation_idx], validation_predictions, average="macro", zero_division=0)),
        },
        "test": {
            "accuracy": float(accuracy_score(y.iloc[test_idx], test_predictions)),
            "macro_f1": float(f1_score(y.iloc[test_idx], test_predictions, average="macro", zero_division=0)),
            "classification_report": classification_report(
                y.iloc[test_idx], test_predictions, labels=class_labels, output_dict=True, zero_division=0
            ),
            "confusion_matrix": confusion_matrix(y.iloc[test_idx], test_predictions, labels=class_labels).tolist(),
            "labels": [str(label) for label in class_labels],
        },
        "normalization": "Median imputation and StandardScaler fitted only on training groups.",
        "unlabeled_rows": "Excluded; blank Description is not treated as normal operation.",
    }
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output / "future_factories_rf.joblib")
    (output / "metrics.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=None, help="Future Factories ZIP archive or CSV directory.")
    parser.add_argument("--data-dir", default="data/raw/future_factories", help="Legacy CSV directory option.")
    parser.add_argument("--out-dir", default="outputs/future_factories")
    parser.add_argument("--max-rows", type=int, default=50_000, help="Maximum labeled rows sampled across the full timeline.")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    source = args.source or args.data_dir
    result = train_future_factory_classifier(source, args.out_dir, args.max_rows, args.seed)
    print(f"Saved model and metrics to {Path(args.out_dir).resolve()}")
    print(json.dumps({"target": result["target"], "rows": result["dataset"]["rows_used"], "features": result["dataset"]["features"], "validation": result["validation"], "test": {k: v for k, v in result["test"].items() if k != "classification_report"}}, indent=2))
    print("These results use supplied Future Factories data and are not paper-reported scores.")


if __name__ == "__main__":
    main()
