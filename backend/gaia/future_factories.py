"""Loading and validation for synchronized Future Factories analog CSV channels."""
from __future__ import annotations

from pathlib import Path
import zipfile

import numpy as np
import pandas as pd
from pandas.api.types import is_bool_dtype
from sklearn.model_selection import StratifiedGroupKFold


def _members(source: Path, archive: zipfile.ZipFile | None) -> list[str]:
    if archive is not None:
        return sorted(name for name in archive.namelist() if name.lower().endswith(".csv"))
    return sorted(str(path) for path in source.rglob("*.csv"))


def _open_member(source: Path, archive: zipfile.ZipFile | None, name: str):
    return archive.open(name) if archive is not None else Path(name).open("rb")


def _text(values: pd.Series) -> pd.Series:
    return values.fillna("").astype("string").str.strip()


def _numeric_values(values: pd.Series) -> np.ndarray:
    text = values.astype("string").str.lower()
    if text.isin(["true", "false"]).all():
        return text.map({"true": 1., "false": 0.}).to_numpy(dtype=np.float32)
    return pd.to_numeric(values, errors="coerce").to_numpy(dtype=np.float32)


def load_future_factory_data(
    source_path: str | Path,
    max_labeled_rows: int = 50_000,
    group_rows: int = 8_192,
    chunk_rows: int = 100_000,
    window_size: int = 5,
) -> tuple[pd.DataFrame, pd.Series, np.ndarray, dict]:
    """Load aligned sensor features and labels from a ZIP archive or CSV directory.

    Files are synchronized sensor channels, not independent samples. This loader
    verifies timestamp and label equality before joining their numeric features.
    Empty descriptions remain unlabeled and are excluded from supervised training.
    """
    source = Path(source_path).expanduser().resolve()
    if max_labeled_rows < 100:
        raise ValueError("max_labeled_rows must be at least 100.")
    if group_rows < window_size or chunk_rows < 1 or window_size < 1:
        raise ValueError("group_rows must cover a positive window_size and chunk_rows must be positive.")
    if not source.exists():
        raise FileNotFoundError(f"Dataset source does not exist: {source}")

    archive = zipfile.ZipFile(source) if source.is_file() and source.suffix.lower() == ".zip" else None
    try:
        members = _members(source, archive)
        if not members:
            raise FileNotFoundError(f"No CSV files found in {source}")

        reference_name = members[0]
        with _open_member(source, archive, reference_name) as handle:
            columns = pd.read_csv(handle, nrows=0).columns
        if not {"_time", "Description"}.issubset(columns):
            raise ValueError(f"{reference_name} must contain _time and Description columns.")
        with _open_member(source, archive, reference_name) as handle:
            reference = pd.read_csv(
                handle,
                usecols=["_time", "Description"],
                dtype="string",
                keep_default_na=False,
                low_memory=False,
            )

        reference_times = _text(reference["_time"])
        reference_labels = _text(reference["Description"])
        labels = reference_labels.mask(reference_labels.eq(""), pd.NA)
        labeled_positions = np.flatnonzero(labels.notna().to_numpy())
        if not len(labeled_positions):
            raise ValueError("No non-empty Description labels were found.")

        eligible_positions = labeled_positions[
            labeled_positions % group_rows >= window_size - 1
        ]
        selected_count = min(len(eligible_positions), max_labeled_rows)
        selected_positions = eligible_positions[
            np.linspace(0, len(eligible_positions) - 1, selected_count, dtype=np.int64)
        ]
        y = labels.iloc[selected_positions].reset_index(drop=True)
        groups = (selected_positions // group_rows).astype(np.int64)
        channel_features = []

        for member in members:
            offset = 0
            carry = None
            sampled_chunks = []
            with _open_member(source, archive, member) as handle:
                for chunk in pd.read_csv(
                    handle,
                    dtype={"_time": "string", "Description": "string"},
                    keep_default_na=False,
                    chunksize=chunk_rows,
                    low_memory=False,
                ):
                    end = offset + len(chunk)
                    expected_times = reference_times.iloc[offset:end].reset_index(drop=True)
                    expected_labels = reference_labels.iloc[offset:end].reset_index(drop=True)
                    if not _text(chunk["_time"]).reset_index(drop=True).equals(expected_times):
                        raise ValueError(f"Timestamp alignment failed for {member}.")
                    if not _text(chunk["Description"]).reset_index(drop=True).equals(expected_labels):
                        raise ValueError(f"Description alignment failed for {member}.")

                    combined = pd.concat([carry, chunk], ignore_index=True) if carry is not None else chunk.reset_index(drop=True)
                    combined_start = offset - (len(carry) if carry is not None else 0)
                    first = np.searchsorted(selected_positions, offset, side="left")
                    last = np.searchsorted(selected_positions, end, side="left")
                    if first < last:
                        positions = selected_positions[first:last]
                        local_positions = positions - combined_start
                        sampled = combined.iloc[local_positions]
                        numeric_columns = {}
                        for column in sampled.columns.difference(["_time", "Description"]):
                            values = _numeric_values(combined[column])
                            for lag in range(window_size):
                                lagged = values[local_positions - lag]
                                if np.isfinite(lagged).any():
                                    suffix = "current" if lag == 0 else f"lag_{lag}"
                                    numeric_columns[f"{Path(member).stem}__{column}__{suffix}"] = lagged
                        sampled_chunks.append(pd.DataFrame(numeric_columns, index=positions))
                    carry = combined.tail(window_size - 1).copy() if window_size > 1 else None
                    offset = end

            if offset != len(reference):
                raise ValueError(f"Row count mismatch for {member}: expected {len(reference)}, found {offset}.")
            if sampled_chunks:
                channel_features.append(pd.concat(sampled_chunks).sort_index())

        if not channel_features:
            raise ValueError("No numeric sensor features were found in the CSV files.")
        X = pd.concat(channel_features, axis=1).replace([np.inf, -np.inf], np.nan)
        X = X.loc[:, X.notna().any(axis=0)].reset_index(drop=True)
        if X.empty:
            raise ValueError("No usable numeric sensor features remain after processing.")

        timestamps = pd.to_datetime(reference_times, utc=True, errors="coerce")
        metadata = {
            "source": str(source),
            "source_files": members,
            "rows_total": int(len(reference)),
            "rows_labeled": int(len(labeled_positions)),
            "rows_unlabeled": int(len(reference) - len(labeled_positions)),
            "rows_used": int(len(X)),
            "features": int(X.shape[1]),
            "class_counts": {str(k): int(v) for k, v in labels.dropna().value_counts().sort_index().items()},
            "timestamp_start": str(timestamps.min()),
            "timestamp_end": str(timestamps.max()),
            "join_validation": "exact _time and Description match for each source file",
            "split_group_rows": int(group_rows),
            "window_size": int(window_size),
        }
        return X, y, groups, metadata
    finally:
        if archive is not None:
            archive.close()


def grouped_train_validation_test_split(y: pd.Series, groups: np.ndarray, seed: int = 42):
    """Create three disjoint grouped folds, keeping contiguous source blocks intact."""
    splitter = StratifiedGroupKFold(n_splits=10, shuffle=True, random_state=seed)
    folds = list(splitter.split(np.zeros(len(y)), y, groups))
    for test_fold, validation_fold in ((0, 1), (1, 0), (2, 3), (3, 2)):
        test_indexes = folds[test_fold][1]
        validation_indexes = folds[validation_fold][1]
        train_indexes = np.concatenate(
            [indexes for fold_number, (_, indexes) in enumerate(folds)
             if fold_number not in {test_fold, validation_fold}]
        )
        if (y.iloc[train_indexes].nunique() == y.nunique()
                and y.iloc[validation_indexes].nunique() == y.nunique()
                and y.iloc[test_indexes].nunique() == y.nunique()):
            return train_indexes, validation_indexes, test_indexes
    raise ValueError("Could not find grouped train/validation/test folds containing every class.")
