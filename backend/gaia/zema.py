"""ZeMA preprocessing: each row is one 60-second cycle; each column is a sampled point."""
from pathlib import Path
import zipfile
import numpy as np
import pandas as pd

PROFILE_COLS = ["cooler_condition", "valve_condition", "pump_leakage", "accumulator_pressure", "stable_flag"]

def _read_matrix(path) -> pd.DataFrame:
    # ZeMA files are tab-separated matrices without a header.
    return pd.read_csv(path, sep=r"\s+", header=None, dtype=np.float32)

def cycle_features(data_dir):
    root = Path(data_dir)
    archive = zipfile.ZipFile(root) if root.is_file() and root.suffix.lower() == ".zip" else None
    if archive:
        profile_member = next((name for name in archive.namelist() if Path(name).name.lower() == "profile.txt"), None)
        sensor_files = [name for name in archive.namelist()
                        if name.lower().endswith(".txt")
                        and Path(name).name.lower() not in {"profile.txt", "description.txt", "documentation.txt"}]
        if profile_member is None:
            archive.close()
            raise FileNotFoundError(f"Could not find profile.txt inside {root}.")
        profile = _read_matrix(archive.open(profile_member))
    else:
        profile_path = next(root.rglob("profile.txt"), None)
        if profile_path is None:
            raise FileNotFoundError(f"Could not find profile.txt under {root}. Supply the ZeMA ZIP or extract it first.")
        profile = _read_matrix(profile_path)
        sensor_files = [path for path in root.rglob("*.txt")
                        if path.name.lower() not in {"profile.txt", "description.txt", "documentation.txt"}]
    if profile.shape[1] < 5:
        if archive:
            archive.close()
        raise ValueError(f"profile.txt expected at least 5 columns, found {profile.shape[1]}")
    profile = profile.iloc[:, :5].copy()
    profile.columns = PROFILE_COLS
    feature_frames = []
    for path in sensor_files:
        try:
            raw = _read_matrix(archive.open(path) if archive else path)
        except Exception:
            continue
        if len(raw) != len(profile) or raw.shape[1] < 2:
            continue
        # Summaries are computed within each cycle. NaNs are ignored.
        safe_name = Path(path).stem.replace(" ", "_")
        f = pd.DataFrame({
            f"{safe_name}__mean": raw.mean(axis=1),
            f"{safe_name}__std": raw.std(axis=1),
            f"{safe_name}__min": raw.min(axis=1),
            f"{safe_name}__max": raw.max(axis=1),
            f"{safe_name}__p10": raw.quantile(.10, axis=1),
            f"{safe_name}__p50": raw.quantile(.50, axis=1),
            f"{safe_name}__p90": raw.quantile(.90, axis=1),
        })
        feature_frames.append(f)
    if not feature_frames:
        if archive:
            archive.close()
        raise FileNotFoundError("No sensor matrices matching profile.txt rows were found.")
    X = pd.concat(feature_frames, axis=1).replace([np.inf, -np.inf], np.nan)
    # Remove columns that are entirely missing; imputation is fit inside the training pipeline.
    X = X.loc[:, X.notna().any(axis=0)]
    if archive:
        archive.close()
    return X, profile
