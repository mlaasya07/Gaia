"""Dataset discovery and lightweight metadata for the Gaia research dashboard."""
from __future__ import annotations

from pathlib import Path


DATASET_SPECS = [
    {
        "key": "zema",
        "name": "ZeMA hydraulic rig",
        "patterns": ("data.zip", "*zema*.zip"),
        "task": "Component-condition classification",
        "label_status": "Five labeled profile fields; four component targets are modeled separately.",
        "processing": "Per-cycle sensor summaries and grouped cycle splits.",
    },
    {
        "key": "future_factories",
        "name": "Future Factories analog",
        "patterns": ("archive (15).zip", "*future*factor*.zip", "*analog*.zip"),
        "task": "Assembly-description classification",
        "label_status": "Three non-empty Description classes; blank descriptions stay unlabeled.",
        "processing": "Seven aligned sensor channels, five-step windows, contiguous-block splits.",
    },
    {
        "key": "hipe",
        "name": "HIPE electrical telemetry",
        "patterns": ("hipe*.zip",),
        "task": "Next-minute active-power forecasting",
        "label_status": "No verified fault labels; uses P_kW as a forecasting target.",
        "processing": "Per-machine minute aggregation, exact lags, chronological split.",
    },
    {
        "key": "smart_manufacturing",
        "name": "Smart Manufacturing event trace",
        "patterns": ("smart-manufacturing*.zip", "smart*manufacturing*.zip"),
        "task": "Operational monitoring",
        "label_status": "No anomaly labels; uses unsupervised screening only.",
        "processing": "Chunked network, component-state, and position aggregates.",
    },
    {
        "key": "process_metadata",
        "name": "Semiconductor route metadata",
        "patterns": ("dataset.zip", "*process*.zip"),
        "task": "Machine and process configuration",
        "label_status": "Static reference tables; no observations or prediction labels.",
        "processing": "Typed machine, process-step, storage, and travel-time tables.",
    },
]


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def discover_dataset_root() -> Path:
    root = project_root()
    candidates = [root.parent / "Gaia-Code" / "Dataset", root / "data" / "raw"]
    return next((path for path in candidates if path.is_dir()), candidates[0])


def discover_dataset_sources(dataset_root: str | Path) -> dict[str, Path | None]:
    root = Path(dataset_root).expanduser().resolve()
    available = list(root.glob("*.zip")) if root.is_dir() else []
    result = {}
    for spec in DATASET_SPECS:
        match = None
        for pattern in spec["patterns"]:
            match = next((path for path in available if path.name.lower() == pattern.lower()), None)
            if match is None and "*" in pattern:
                match = next((path for path in available if path.match(pattern)), None)
            if match is not None:
                break
        result[spec["key"]] = match
    return result


def dataset_inventory(dataset_root: str | Path) -> list[dict]:
    sources = discover_dataset_sources(dataset_root)
    inventory = []
    for spec in DATASET_SPECS:
        path = sources[spec["key"]]
        inventory.append({
            **spec,
            "path": str(path) if path else None,
            "available": path is not None,
            "archive_mb": round(path.stat().st_size / (1024 * 1024), 2) if path else None,
        })
    return inventory
