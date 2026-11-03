"""Build a schema-safe bridge from Gaia's five industrial datasets to LACD roles.

This module does NOT concatenate unrelated datasets or pretend they share timestamps.
It loads the existing trained predictors, creates role-specific evidence summaries,
and writes a common evidence table plus a JSON context package.
The current LACD policy is simulator-trained; this bridge is an integration artifact,
not evidence that the learned policy has been validated on real factory observations.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from collections import Counter

import joblib
import numpy as np
import pandas as pd
import sklearn

# Saved Gaia estimators were trained with scikit-learn 1.7.1. Loading them under
# 1.8.x can fail because sklearn does not guarantee cross-version pickle compatibility.
SUPPORTED_SKLEARN = "1.7.1"
if sklearn.__version__ != SUPPORTED_SKLEARN:
    raise RuntimeError(
        f"Gaia model artifacts were saved with scikit-learn {SUPPORTED_SKLEARN}, "
        f"but this environment has {sklearn.__version__}. Run: "
        f"python -m pip install scikit-learn=={SUPPORTED_SKLEARN} "
        "then rerun this command."
    )

from .zema import cycle_features
from .future_factories import load_future_factory_data
from .hipe import load_hipe_energy_data
from .smart_manufacturing import load_smart_manufacturing_data
from .process_metadata import load_process_metadata


def _jsonable(value):
    if isinstance(value, (np.integer,)): return int(value)
    if isinstance(value, (np.floating,)): return float(value)
    if isinstance(value, (np.bool_,)): return bool(value)
    if isinstance(value, (pd.Timestamp,)): return value.isoformat()
    if isinstance(value, Path): return str(value)
    raise TypeError(type(value).__name__)


def _require(path: Path, label: str):
    if not path.exists():
        raise FileNotFoundError(f"Missing {label}: {path}")
    return path


def _evidence(rows, dataset, agent, name, value, unit, records, interpretation, limitation):
    rows.append({
        "dataset": dataset, "target_agent": agent, "signal": name,
        "value": value, "unit": unit, "records": int(records),
        "interpretation": interpretation, "limitation": limitation,
    })


def integrate(project_root: Path, dataset_root: Path, out_dir: Path, future_rows: int = 10_000):
    project_root = project_root.resolve(); dataset_root = dataset_root.resolve(); out_dir.mkdir(parents=True, exist_ok=True)
    evidence = []; context = {"schema_version": "1.0", "integration_type": "role_specific_dataset_evidence", "agents": {}, "sources": {}}

    # 1) ZeMA -> maintenance. Use the exact saved feature matrix used to train the RF models.
    zema_features_path = _require(project_root / "outputs/maintenance/zema_cycle_features.csv", "ZeMA feature matrix")
    Xz = pd.read_csv(zema_features_path)
    zema_dir = _require(project_root / "outputs/maintenance", "ZeMA model directory")
    zema_agent = {"dataset": "ZeMA", "task": "component-condition classification", "rows_scored": int(len(Xz)), "targets": {}}
    for target in ("cooler_condition", "valve_condition", "pump_leakage", "accumulator_pressure"):
        model_path = _require(zema_dir / f"{target}_rf.joblib", f"ZeMA {target} model")
        model = joblib.load(model_path)
        pred = model.predict(Xz)
        proba = model.predict_proba(Xz) if hasattr(model, "predict_proba") else None
        counts = {str(k): int(v) for k, v in pd.Series(pred).value_counts().items()}
        confidence = float(np.mean(np.max(proba, axis=1))) if proba is not None else None
        zema_agent["targets"][target] = {"predicted_class_counts": counts, "mean_max_class_probability": confidence}
        _evidence(evidence, "ZeMA", "maintenance", f"{target}_predicted_class_distribution", json.dumps(counts), "class_counts", len(pred),
                  "Distribution of model-predicted component-condition classes across the saved ZeMA cycles.",
                  "Class IDs are retained as provided; this bridge does not assume which class is a fault without the dataset's label mapping.")
        if confidence is not None:
            _evidence(evidence, "ZeMA", "maintenance", f"{target}_mean_prediction_confidence", confidence, "probability", len(pred),
                      "Mean maximum class probability; a confidence summary, not a calibrated fault probability.",
                      "Do not interpret as probability of machine failure.")
    context["agents"]["maintenance"] = zema_agent
    context["sources"]["ZeMA"] = {"source": "data.zip", "feature_rows": len(Xz), "features": Xz.shape[1]}

    # 2) Future Factories -> scheduling. Preserve assembly labels; do not convert them to throughput.
    ff_zip = _require(dataset_root / "archive (15).zip", "Future Factories archive")
    ff_model = joblib.load(_require(project_root / "outputs/future_factories/future_factories_rf.joblib", "Future Factories model"))
    Xf, yf, groups, ff_meta = load_future_factory_data(ff_zip, max_labeled_rows=future_rows)
    ff_pred = ff_model.predict(Xf)
    ff_proba = ff_model.predict_proba(Xf) if hasattr(ff_model, "predict_proba") else None
    ff_counts = {str(k): int(v) for k, v in pd.Series(ff_pred).value_counts().items()}
    ff_conf = float(np.mean(np.max(ff_proba, axis=1))) if ff_proba is not None else None
    pd.DataFrame({"sample_index": np.arange(len(ff_pred)), "predicted_assembly_description": ff_pred,
                  "max_class_probability": np.max(ff_proba, axis=1) if ff_proba is not None else np.nan}).to_csv(out_dir / "future_factories_agent_predictions.csv", index=False)
    ff_agent = {"dataset": "Future Factories", "task": "assembly-description classification", "rows_scored": int(len(Xf)),
                "predicted_class_counts": ff_counts, "mean_max_class_probability": ff_conf,
                "dataset_metadata": ff_meta}
    _evidence(evidence, "Future Factories", "scheduling", "predicted_assembly_description_counts", json.dumps(ff_counts), "class_counts", len(ff_pred),
              "Predicted assembly-description class distribution for sampled labeled sensor windows.",
              "Class labels describe assembly states; they are not a direct production-throughput measurement.")
    if ff_conf is not None:
        _evidence(evidence, "Future Factories", "scheduling", "mean_prediction_confidence", ff_conf, "probability", len(ff_pred),
                  "Mean maximum class probability across sampled windows.", "Classifier confidence is not a calibrated production-completion probability.")
    context["agents"]["scheduling"] = ff_agent
    context["sources"]["Future Factories"] = {"archive": ff_zip.name, "rows_scored": len(Xf), "features": Xf.shape[1], "rows_total": ff_meta.get("rows_total")}

    # 3) HIPE -> energy. Forecast power using the existing trained pipeline; summarize per machine/hour.
    hipe_zip = _require(dataset_root / "hipe_cleaned_v1.0.1_geq_2017-10-23_lt_2017-10-30.zip", "HIPE archive")
    hipe_model = joblib.load(_require(project_root / "outputs/energy/hipe_energy_forecaster.joblib", "HIPE energy model"))
    hipe, hipe_meta = load_hipe_energy_data(hipe_zip)
    hipe_metrics = json.loads(_require(project_root / "outputs/energy/metrics.json", "HIPE metrics").read_text(encoding="utf-8"))
    hipe_cols = hipe_metrics.get("feature_columns") or [c for c in hipe.select_dtypes(include=np.number).columns if c != "target_next_minute_kw"] + ["Machine"]
    Xh = hipe[hipe_cols].copy()
    hipe["predicted_next_minute_power_kw"] = hipe_model.predict(Xh)
    hipe["hour_bucket"] = hipe["timestamp"].dt.floor("h")
    hourly = hipe.groupby(["Machine", "hour_bucket"], as_index=False).agg(
        mean_predicted_power_kw=("predicted_next_minute_power_kw", "mean"),
        p95_predicted_power_kw=("predicted_next_minute_power_kw", lambda s: s.quantile(.95)),
        readings=("predicted_next_minute_power_kw", "size"))
    hourly.to_csv(out_dir / "hipe_energy_agent_hourly_forecasts.csv", index=False)
    hipe_agent = {"dataset": "HIPE", "task": "one-minute-ahead active-power forecasting", "rows_scored": int(len(hipe)),
                  "machines": int(hipe["Machine"].nunique()), "mean_predicted_power_kw": float(hipe["predicted_next_minute_power_kw"].mean()),
                  "p95_predicted_power_kw": float(hipe["predicted_next_minute_power_kw"].quantile(.95)),
                  "hourly_output": "hipe_energy_agent_hourly_forecasts.csv", "dataset_metadata": hipe_meta}
    _evidence(evidence, "HIPE", "energy", "mean_predicted_next_minute_power", hipe_agent["mean_predicted_power_kw"], "kW", len(hipe),
              "Mean of model forecasts for next-minute active power.", "HIPE has no fault labels; power forecasts are not energy-price or carbon-intensity forecasts.")
    _evidence(evidence, "HIPE", "energy", "p95_predicted_next_minute_power", hipe_agent["p95_predicted_power_kw"], "kW", len(hipe),
              "95th percentile of next-minute active-power forecasts.", "Forecast distribution is from the supplied HIPE period and machines.")
    context["agents"]["energy"] = hipe_agent
    context["sources"]["HIPE"] = {"archive": hipe_zip.name, "minute_rows": len(hipe), "machines": hipe_agent["machines"]}

    # 4) Smart Manufacturing -> monitoring. Scores are unsupervised screens, not labeled faults.
    sm_zip = _require(dataset_root / "Smart-Manufacturing-Dataset-0.1.0.zip", "Smart Manufacturing archive")
    sm_model = joblib.load(_require(project_root / "outputs/monitoring/smart_manufacturing_isolation_forest.joblib", "monitoring model"))
    sm_metrics = json.loads(_require(project_root / "outputs/monitoring/metrics.json", "monitoring metrics").read_text(encoding="utf-8"))
    sm, sm_meta = load_smart_manufacturing_data(sm_zip)
    sm_cols = sm_metrics["feature_columns"]
    scores = -sm_model.decision_function(sm[sm_cols])
    threshold = float(sm_metrics["threshold"])
    sm_out = pd.DataFrame({"minute_from_start": sm["minute_from_start"], "anomaly_score": scores, "screened": scores >= threshold})
    sm_out.to_csv(out_dir / "smart_manufacturing_monitoring_agent_scores.csv", index=False)
    screened = int((scores >= threshold).sum())
    sm_agent = {"dataset": "Smart Manufacturing", "task": "unsupervised operational anomaly screening", "minute_rows_scored": int(len(sm)),
                "screened_minutes": screened, "screened_fraction": float(np.mean(scores >= threshold)),
                "threshold": threshold, "scores_file": "smart_manufacturing_monitoring_agent_scores.csv", "dataset_metadata": sm_meta}
    _evidence(evidence, "Smart Manufacturing", "monitoring", "screened_minute_fraction", sm_agent["screened_fraction"], "fraction", len(sm),
              "Fraction of aggregated minutes whose Isolation Forest score exceeds the saved validation threshold.",
              "Unsupervised screening only; no ground-truth anomaly labels. Latency is a requirement field, not observed delay.")
    _evidence(evidence, "Smart Manufacturing", "monitoring", "screened_minute_count", screened, "minutes", len(sm),
              "Number of minute bins flagged for review by the unsupervised detector.",
              "A flagged minute is not a confirmed fault.")
    context["agents"]["monitoring"] = sm_agent
    context["sources"]["Smart Manufacturing"] = {"archive": sm_zip.name, "minute_rows": len(sm), "labels_available": False}

    # 5) Semiconductor -> shared scheduling/process constraints. Static metadata only.
    semi_zip = _require(dataset_root / "dataset.zip", "semiconductor metadata archive")
    tables = load_process_metadata(semi_zip)
    semi_summary = {}
    for name, frame in tables.items():
        semi_summary[name] = {"rows": int(len(frame)), "columns": [str(c) for c in frame.columns],
                              "sample": frame.head(3).astype(object).where(pd.notna(frame.head(3)), None).to_dict(orient="records")}
    machine_rows = next((len(v) for k, v in tables.items() if k in {"machineinfo", "machine_info"}), None)
    step_rows = next((len(v) for k, v in tables.items() if k in {"processstepinfo", "process_step_info"}), None)
    semi_agent = {"dataset": "Semiconductor process metadata", "task": "static route/machine/process context", "tables": semi_summary,
                  "machine_records": machine_rows, "process_step_records": step_rows}
    _evidence(evidence, "Semiconductor metadata", "scheduling", "machine_metadata_records", machine_rows if machine_rows is not None else 0,
              "records", machine_rows or 0, "Count of machine configuration records where a machine table is available.",
              "Static configuration only; not a live machine-state measurement.")
    _evidence(evidence, "Semiconductor metadata", "scheduling", "process_step_metadata_records", step_rows if step_rows is not None else 0,
              "records", step_rows or 0, "Count of process-step metadata records where available.",
              "Static route/process context; no labels or time-series target are supplied.")
    context["agents"]["process_context"] = semi_agent
    context["sources"]["Semiconductor metadata"] = {"archive": semi_zip.name, "tables": {k: len(v) for k, v in tables.items()}}

    # Common, typed evidence table. Values remain source-specific; no fabricated cross-source clock.
    evidence_df = pd.DataFrame(evidence)
    evidence_df.to_csv(out_dir / "agent_evidence.csv", index=False)
    (out_dir / "agent_context.json").write_text(json.dumps(context, indent=2, default=_jsonable), encoding="utf-8")
    report = {
        "status": "completed",
        "integration": "five dataset adapters -> role-specific agent evidence",
        "dataset_count": 5,
        "evidence_rows": int(len(evidence_df)),
        "outputs": ["agent_evidence.csv", "agent_context.json", "future_factories_agent_predictions.csv",
                    "hipe_energy_agent_hourly_forecasts.csv", "smart_manufacturing_monitoring_agent_scores.csv"],
        "important_boundary": "This creates real-dataset evidence for agent roles. The current learned LACD checkpoint was trained in FactorySim and is not automatically validated or retrained on these heterogeneous real datasets.",
        "dataset_caveats": [
            "ZeMA predicted class IDs are not translated into fault severity without verified class semantics.",
            "Future Factories assembly classes are not treated as throughput labels.",
            "HIPE forecasts power, not carbon intensity or energy price.",
            "Smart Manufacturing flags unsupervised anomalies; it has no ground-truth fault labels.",
            "Semiconductor tables are static metadata, not live observations."
        ],
    }
    (out_dir / "integration_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Saved five-dataset agent evidence to: {out_dir.resolve()}")
    return report


def main():
    parser = argparse.ArgumentParser(description="Integrate Gaia's five industrial datasets into role-specific LACD evidence.")
    parser.add_argument("--project-root", default=".", help="Gaia_Paper_Aligned project root containing gaia/ and outputs/.")
    parser.add_argument("--dataset-root", default="../Gaia-Code/Dataset", help="Folder containing the five supplied ZIP archives.")
    parser.add_argument("--out-dir", default="outputs/dataset_integration")
    parser.add_argument("--future-rows", type=int, default=10000, help="Labeled Future Factories windows to score (default matches saved training sample).")
    args = parser.parse_args()
    integrate(Path(args.project_root), Path(args.dataset_root), Path(args.out_dir), args.future_rows)


if __name__ == "__main__":
    main()
