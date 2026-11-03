"""Reader and consistency checks for semiconductor route/process metadata."""
from __future__ import annotations

from pathlib import Path
import zipfile

import pandas as pd


def load_process_metadata(source_path: str | Path) -> dict[str, pd.DataFrame]:
    """Load route, machine, processing-time, and storage tables from ZIP or folder."""
    source = Path(source_path).expanduser().resolve()
    tables = {}
    if source.is_file() and source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as archive:
            for name in archive.namelist():
                if name.lower().endswith(".txt"):
                    with archive.open(name) as handle:
                        tables[Path(name).stem.lower()] = pd.read_csv(handle, sep=r"\s+", engine="python")
    elif source.is_dir():
        for path in source.rglob("*.txt"):
            tables[path.stem.lower()] = pd.read_csv(path, sep=r"\s+", engine="python")
    else:
        raise FileNotFoundError(f"Expected a ZIP archive or directory, found {source}")
    if not tables:
        raise ValueError(f"No process metadata tables found in {source}")
    if "machineinfo" in tables and "machine" in tables["machineinfo"]:
        tables["machineinfo"] = tables["machineinfo"].drop_duplicates("Machine").reset_index(drop=True)
    if "processstepinfo" in tables and "No" in tables["processstepinfo"]:
        tables["processstepinfo"] = tables["processstepinfo"].sort_values("No").reset_index(drop=True)
    return tables
