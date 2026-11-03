"""Streaming analysis for the Smart Manufacturing network/event archive."""
from __future__ import annotations

from collections import defaultdict
from io import BytesIO
from pathlib import Path
import zipfile

import pandas as pd


def _nested_archive(source: Path):
    with zipfile.ZipFile(source) as outer:
        nested_names = [name for name in outer.namelist() if name.lower().endswith(".zip")]
        if not nested_names:
            raise ValueError(f"No inner dataset ZIP was found in {source}")
        nested_bytes = outer.read(nested_names[0])
    return zipfile.ZipFile(BytesIO(nested_bytes)), nested_names[0]


def _minute_summary(archive: zipfile.ZipFile, member: str, chunksize: int) -> pd.DataFrame:
    partials = []
    with archive.open(member) as handle:
        for chunk in pd.read_csv(handle, chunksize=chunksize, low_memory=False):
            if member.endswith("data_communications.csv"):
                chunk["time_bin"] = (pd.to_numeric(chunk["Timestamp"], errors="coerce") // 60).astype("Int64")
                chunk["Data Size"] = pd.to_numeric(chunk["Data Size"], errors="coerce")
                chunk["Latency"] = pd.to_numeric(chunk["Latency"], errors="coerce")
                chunk["Reliability"] = pd.to_numeric(chunk["Reliability"], errors="coerce")
                chunk["aperiodic"] = chunk["Communication Type"].astype(str).str.lower().eq("a").astype("int8")
                summary = chunk.groupby("time_bin", dropna=True).agg(
                    message_count=("Iteration", "size"),
                    payload_total=("Data Size", "sum"),
                    latency_requirement_ms_sum=("Latency", "sum"),
                    reliability_requirement_pct_sum=("Reliability", "sum"),
                    aperiodic_message_count=("aperiodic", "sum"),
                )
            elif member.endswith("data_states.csv"):
                chunk["time_bin"] = (pd.to_numeric(chunk["TimeStamp"], errors="coerce") // 60).astype("Int64")
                state = chunk["State"].astype("string").str.lower()
                chunk["is_blocked"] = state.eq("blocked").fillna(False).astype("int8")
                chunk["is_busy"] = state.str.startswith("busy", na=False).astype("int8")
                summary = chunk.groupby("time_bin", dropna=True).agg(
                    state_event_count=("Component", "size"),
                    blocked_state_events=("is_blocked", "sum"),
                    busy_state_events=("is_busy", "sum"),
                )
            elif member.endswith("data_position.csv"):
                time_column = "Time" if "Time" in chunk.columns else "TimeStamp"
                chunk["time_bin"] = (pd.to_numeric(chunk[time_column], errors="coerce") // 60).astype("Int64")
                for column in ("Position_X", "Position_Y", "Position_Z"):
                    chunk[column] = pd.to_numeric(chunk[column], errors="coerce")
                summary = chunk.groupby("time_bin", dropna=True).agg(
                    position_event_count=("Name", "size"),
                    position_x_sum_mm=("Position_X", "sum"),
                    position_y_sum_mm=("Position_Y", "sum"),
                )
            else:
                continue
            partials.append(summary)
    if not partials:
        return pd.DataFrame()
    return pd.concat(partials).groupby(level=0).sum(min_count=1)


def load_smart_manufacturing_data(
    source_path: str | Path, chunksize: int = 250_000
) -> tuple[pd.DataFrame, dict]:
    """Aggregate network, state, and position events into one-minute rows."""
    source = Path(source_path).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != ".zip":
        raise FileNotFoundError(f"Expected a Smart Manufacturing dataset ZIP, found {source}")
    archive, nested_name = _nested_archive(source)
    try:
        members = {Path(name).name: name for name in archive.namelist() if name.lower().endswith(".csv")}
        required = {"data_communications.csv", "data_position.csv", "data_states.csv"}
        if not required.issubset(members):
            raise ValueError(f"Dataset archive is missing {sorted(required - set(members))}")
        reports = {}
        series = []
        for short_name in sorted(required):
            member = members[short_name]
            reports[short_name] = {
                "rows": sum(1 for _ in archive.open(member)) - 1,
                "bytes": archive.getinfo(member).file_size,
            }
            series.append(_minute_summary(archive, member, chunksize))
        minute_data = pd.concat(series, axis=1).sort_index().fillna(0.0)
        if {"latency_requirement_ms_sum", "message_count"}.issubset(minute_data.columns):
            minute_data["latency_requirement_ms_mean"] = (
                minute_data["latency_requirement_ms_sum"] / minute_data["message_count"].clip(lower=1)
            )
            minute_data["reliability_requirement_pct_mean"] = (
                minute_data["reliability_requirement_pct_sum"] / minute_data["message_count"].clip(lower=1)
            )
            minute_data = minute_data.drop(columns=["latency_requirement_ms_sum", "reliability_requirement_pct_sum"])
        if {"position_x_sum_mm", "position_event_count"}.issubset(minute_data.columns):
            minute_data["mean_position_x_mm"] = (
                minute_data["position_x_sum_mm"] / minute_data["position_event_count"].clip(lower=1)
            )
            minute_data["mean_position_y_mm"] = (
                minute_data["position_y_sum_mm"] / minute_data["position_event_count"].clip(lower=1)
            )
            minute_data = minute_data.drop(columns=["position_x_sum_mm", "position_y_sum_mm"])
        minute_data.index.name = "minute_from_start"
        minute_data = minute_data.reset_index()
        metadata = {
            "source": str(source),
            "nested_archive": nested_name,
            "source_files": reports,
            "minute_rows": int(len(minute_data)),
            "timestamp_start_seconds": 0,
            "timestamp_end_seconds": int(minute_data["minute_from_start"].max() * 60),
            "message_latency_is_requirement_not_observed_latency": True,
            "labels_available": False,
        }
        return minute_data, metadata
    finally:
        archive.close()
