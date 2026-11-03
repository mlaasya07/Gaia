"""Checks on the research export that the /research page depends on.

The structural tests read the committed public/data/research.json. The reproduction
test re-runs the trained checkpoint and needs torch, so it is skipped without it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RESEARCH_JSON = ROOT.parent / "public" / "data" / "research.json"


@pytest.fixture(scope="module")
def data():
    return json.loads(RESEARCH_JSON.read_text())


def test_variants_and_agents(data):
    assert set(data["variants"]) == {"factorysim", "real_data"}
    assert len(data["meta"]["agents"]) == 4
    assert len(data["meta"]["evaluation_seeds"]) == 30


def test_attention_rows_are_distributions(data):
    for row in data["variants"]["real_data"]["attention"]["mean"]:
        assert sum(row) == pytest.approx(1.0, abs=1e-2)


def test_checkpoint_that_cannot_be_rerun_has_no_invented_attention(data):
    old = data["variants"]["factorysim"]
    assert old["rerun_available"] is False
    assert old["attention"] is None and old["behaviour"] is None


def test_reproduction_matches_saved_evaluation(data):
    gap = data["meta"]["reproduction_check"]["real_data"]["max_abs_diff_vs_saved_csv"]
    assert gap["reward"] == 0


def test_paired_rows_cover_every_baseline_and_metric(data):
    rows = data["variants"]["real_data"]["paired_vs_baselines"]
    assert len(rows) == 3 * len(data["meta"]["metrics"])
    assert all(0 <= r["learned_better_in"] <= r["n"] for r in rows)


def test_rerun_reproduces_saved_rewards(tmp_path):
    pytest.importorskip("torch")
    from argparse import Namespace

    from gaia.export_research import export

    args = Namespace(
        root=str(ROOT),
        world_model="outputs/simulation/shared_world_model.pt",
        dataset_evidence="outputs/dataset_integration/agent_evidence.csv",
        episodes=3,
        horizon=96,
    )
    out = export(args)
    gap = out["meta"]["reproduction_check"]["real_data"]["max_abs_diff_vs_saved_csv"]["reward"]
    assert gap == 0
