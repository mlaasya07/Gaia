"""HIPE electrical telemetry loading and energy forecasting features."""
from __future__ import annotations

from pathlib import Path
import zipfile

import numpy as np
import pandas as pd


_REQUIRED_COLUMNS = {"SensorDateTime", "Machine", "P_kW"}
_OPTIONAL_COLUMNS = ["F_Hz", "IAVR_A", "UAVR_V"]


def load_hipe_energy_data(source_path: str | Path, chunk_rows: int = 100_000) -> tuple[pd.DataFrame, dict]:
    """Aggregate machine power telemetry into one-minute rows without extracting the ZIP."""
    source = Path(source_path).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != ".zip":
        raise FileNotFoundError(f"Expected a HIPE ZIP archive, found {source}")

    partials = []
    file_names = []
    raw_rows = 0
    with zipfile.ZipFile(source) as archive:
        for member in sorted(archive.namelist()):
            if not member.lower().endswith(".csv"):
                continue
            with archive.open(member) as handle:
                columns = set(pd.read_csv(handle, nrows=0).columns)
            if not _REQUIRED_COLUMNS.issubset(columns):
                continue
            usecols = ["SensorDateTime", "Machine", "P_kW"] + [
                column for column in _OPTIONAL_COLUMNS if column in columns
            ]
            file_names.append(member)
            with archive.open(member) as handle:
                for chunk in pd.read_csv(handle, usecols=usecols, chunksize=chunk_rows, low_memory=False):
                    raw_rows += len(chunk)
                    chunk["timestamp"] = pd.to_datetime(chunk.pop("SensorDateTime"), utc=True, errors="coerce")
                    chunk["P_kW"] = pd.to_numeric(chunk["P_kW"], errors="coerce")
                    chunk = chunk.dropna(subset=["timestamp", "Machine", "P_kW"])
                    if chunk.empty:
                        continue
                    chunk["time_bin"] = chunk["timestamp"].dt.floor("min")
                    numeric = ["P_kW"] + [column for column in _OPTIONAL_COLUMNS if column in chunk.columns]
                    for column in numeric:
                        chunk[column] = pd.to_numeric(chunk[column], errors="coerce")
                    aggregations = {column: (column, "mean") for column in numeric}
                    aggregations["power_kw_std"] = ("P_kW", "std")
                    aggregations["reading_count"] = ("P_kW", "size")
                    grouped = chunk.groupby(["Machine", "time_bin"], observed=True).agg(**aggregations).reset_index()
                    partials.append(grouped)

    if not partials:
        raise ValueError("No HIPE CSVs with SensorDateTime, Machine, and P_kW were found.")
    minute_data = pd.concat(partials, ignore_index=True)
    numeric_cols = [column for column in minute_data.columns if column not in {"Machine", "time_bin"}]
    minute_data = minute_data.groupby(["Machine", "time_bin"], as_index=False, observed=True)[numeric_cols].mean()
    minute_data = minute_data.rename(columns={"time_bin": "timestamp", "P_kW": "power_kw"})
    minute_data["power_kw_std"] = minute_data["power_kw_std"].fillna(0.0)
    minute_data = minute_data.sort_values(["Machine", "timestamp"]).reset_index(drop=True)
    minute_data["hour_sin"] = np.sin(2 * np.pi * minute_data["timestamp"].dt.hour / 24)
    minute_data["hour_cos"] = np.cos(2 * np.pi * minute_data["timestamp"].dt.hour / 24)
    for lag in (1, 2, 5):
        grouped = minute_data.groupby("Machine", observed=True)
        lag_value = grouped["power_kw"].shift(lag)
        lag_time = grouped["timestamp"].shift(lag)
        exact_offset = minute_data["timestamp"].sub(lag_time).eq(pd.Timedelta(minutes=lag))
        minute_data[f"power_lag_{lag}"] = lag_value.where(exact_offset)
    minute_data["power_roll_mean_5"] = (
        minute_data.groupby("Machine", observed=True)["power_kw"].transform(
            lambda values: values.shift(1).rolling(5, min_periods=3).mean()
        )
    )
    grouped = minute_data.groupby("Machine", observed=True)
    next_power = grouped["power_kw"].shift(-1)
    next_timestamp = grouped["timestamp"].shift(-1)
    exact_next_minute = next_timestamp.sub(minute_data["timestamp"]).eq(pd.Timedelta(minutes=1))
    minute_data["target_next_minute_kw"] = next_power.where(exact_next_minute)
    metadata = {
        "source": str(source),
        "source_files": file_names,
        "raw_rows_read": int(raw_rows),
        "minute_rows": int(len(minute_data)),
        "machines": sorted(minute_data["Machine"].dropna().unique().tolist()),
        "timestamp_start": str(minute_data["timestamp"].min()),
        "timestamp_end": str(minute_data["timestamp"].max()),
        "target": "next-minute mean active power (P_kW)",
        "source_has_fault_labels": False,
    }
    return minute_data, metadata
