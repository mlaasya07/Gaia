"""Update a copy of the Team 15 review deck from saved Gaia experiment artifacts.

Requires Microsoft PowerPoint and pywin32 on Windows. The source deck is never
modified; the output is written beside it.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from shutil import copy2

import pandas as pd
import win32com.client as win32


def _rgb(red: int, green: int, blue: int) -> int:
    return red | (green << 8) | (blue << 16)


def _set_text(presentation, slide_no, shape_no, text, size=None, bold=None):
    shape = presentation.Slides(slide_no).Shapes(shape_no)
    text_range = shape.TextFrame.TextRange
    text_range.Text = text
    if size is not None:
        text_range.Font.Size = size
    if bold is not None:
        text_range.Font.Bold = -1 if bold else 0
    return shape


def _set_table(presentation, slide_no, shape_no, rows, font_size=9, add_rows=False):
    table = presentation.Slides(slide_no).Shapes(shape_no).Table
    if len(rows[0]) != table.Columns.Count:
        raise ValueError(f"Slide {slide_no} table has {table.Columns.Count} columns; received {len(rows[0])}.")
    if len(rows) > table.Rows.Count and not add_rows:
        raise ValueError(f"Slide {slide_no} table needs {len(rows)} rows; it has {table.Rows.Count}.")
    while table.Rows.Count < len(rows):
        table.Rows.Add()
    for row_index, values in enumerate(rows, start=1):
        for column_index, value in enumerate(values, start=1):
            cell_text = table.Cell(row_index, column_index).Shape.TextFrame.TextRange
            cell_text.Text = str(value)
            cell_text.Font.Name = "Calibri"
            cell_text.Font.Size = font_size
            if row_index == 1:
                cell_text.Font.Bold = -1
    return table


def _add_text(slide, x, y, width, height, text, size, color, bold=False):
    shape = slide.Shapes.AddTextbox(1, x, y, width, height)
    shape.TextFrame.MarginLeft = 0
    shape.TextFrame.MarginRight = 0
    shape.TextFrame.MarginTop = 0
    shape.TextFrame.MarginBottom = 0
    shape.TextFrame.WordWrap = -1
    text_range = shape.TextFrame.TextRange
    text_range.Text = text
    text_range.Font.Name = "Calibri"
    text_range.Font.Size = size
    text_range.Font.Color.RGB = color
    text_range.Font.Bold = -1 if bold else 0
    return shape


def update_deck(source: Path, output: Path, project: Path) -> None:
    outputs = project / "outputs"
    maintenance = json.loads((outputs / "maintenance" / "metrics.json").read_text(encoding="utf-8"))
    future = json.loads((outputs / "future_factories" / "metrics.json").read_text(encoding="utf-8"))
    energy = json.loads((outputs / "energy" / "metrics.json").read_text(encoding="utf-8"))
    world_model = json.loads((outputs / "simulation" / "world_model_metadata.json").read_text(encoding="utf-8"))
    policy = pd.read_csv(outputs / "simulation" / "episode_metrics.csv")
    transitions = pd.read_csv(outputs / "simulation" / "evaluation_transitions.csv")
    summary = policy.groupby("policy").mean(numeric_only=True)
    health_risk = (1 - transitions.groupby("policy")["next_s0"].mean()).to_dict()

    output.parent.mkdir(parents=True, exist_ok=True)
    copy2(source, output)
    app = win32.DispatchEx("PowerPoint.Application")
    presentation = app.Presentations.Open(str(output), ReadOnly=False, WithWindow=False)
    try:
        _set_table(presentation, 18, 2, [
            ["Field", "ZeMA hydraulic rig", "Future Factories analog", "HIPE electrical telemetry"],
            ["Dataset name", "ZeMA condition monitoring", "Future Factories 2023 analog", "HIPE cleaned 2017-10-23 to 2017-10-30"],
            ["Source / file", "Gaia-Code/Dataset/data.zip", "Gaia-Code/Dataset/archive (15).zip", "Gaia-Code/Dataset/hipe_cleaned_...zip"],
            ["Samples / variables", "2,205 cycles; 17 sensor matrices", "974,836 timestamps; 7 synchronized CSVs", "1,239,845 raw rows; 11 machines"],
            ["Input format", "Tab-separated sensor matrices + profile labels", "Seven timestamp-aligned analog CSV channels", "Wide electrical telemetry CSVs"],
            ["Train / val / test", "64-cycle grouped, disjoint splits", "80 / 10 / 10 grouped blocks; 10k labeled rows", "70 / 15 / 15 chronological; 78,056 / 16,731 / 16,731"],
            ["Preprocessing", "Per-cycle statistics; train-only impute/scale", "Five-timestep windows; blank labels excluded", "Per-machine minute aggregation; exact lags; train-only scaling"],
        ], font_size=8.5)
        _set_text(presentation, 18, 3,
            "Also processed Smart Manufacturing: 12,757,920 communications, 832,930 positions and 213,056 state events; no anomaly labels. The semiconductor archive contains 100 machines and 40 process steps (metadata only). Full archive inventory: Gaia_Paper_Aligned/docs/DATASETS.md.",
            size=10)

        _set_table(presentation, 20, 2, [
            ["Model", "Description", "Purpose"],
            ["B1: Centralized baseline", "One heuristic controller sees the shared simulator state.", "Reference baseline"],
            ["B2: Independent agents", "Subsystem heuristics act without proposal exchange.", "Coordination baseline"],
            ["B3: Without world model", "Decentralized monitoring, scheduling, maintenance, energy and edge agents; no prediction.", "LACD-inspired rule baseline"],
            ["B4: Without LACD", "Independent proposals with GRU-based candidate-action scoring.", "World-model ablation"],
            ["Full Gaia prototype", "Bounded peer proposals + shared GRU prediction + safety penalties.", "Prototype; not trained MAPPO/LACD"],
        ], font_size=9)
        _set_text(presentation, 20, 3,
            "Measured simulator means per step; 30 paired evaluation seeds x 96 steps. E/C/L/H are proxies (lower is better); P is throughput (higher is better).",
            size=10)

        policy_labels = [
            ("B1 central", "B1_centralized_baseline"),
            ("B2 independent", "B2_independent_agents"),
            ("B3 no WM", "B3_without_world_model"),
            ("B4 no LACD", "B4_without_LACD"),
            ("Full Gaia", "full_Gaia_prototype"),
        ]
        results = [["Policy", "E", "C", "L", "H", "P"]]
        for label, key in policy_labels:
            row = summary.loc[key]
            results.append([label, f"{row['energy']:.4f}", f"{row['carbon']:.4f}",
                            f"{row['latency']:.4f}", f"{health_risk[key]:.4f}",
                            f"{row['throughput']:.4f}"])
        result_table = _set_table(presentation, 20, 4, results, font_size=9, add_rows=True)
        for row_index in range(1, result_table.Rows.Count + 1):
            result_table.Rows(row_index).Height = 19.5

        _set_text(presentation, 21, 3,
            "Initial implementation and baseline runs are complete. Results below are measured from supplied datasets or the synthetic simulator; they are not paper-reported scores.",
            size=13)
        _set_table(presentation, 21, 4, [
            ["Item", "Status", "Evidence"],
            ["Literature study (8 papers) and comparison", "Completed", "Comparative analysis slides"],
            ["Problem, objectives and methodology refined", "Completed", "Review 2 methodology slides"],
            ["Environment and tools set up", "Completed", "Python 3.12, PyTorch, scikit-learn, Streamlit"],
            ["Five supplied archives inspected", "Completed", "Schema, timestamps, labels and sizes documented"],
            ["Preprocessing and subsystem baselines", "Completed", "ZeMA, Future Factories, HIPE and monitoring outputs"],
            ["Five-policy simulator evaluation", "Completed", "30 paired seeds; 96 steps; saved episode metrics"],
        ], font_size=8.5, add_rows=True)

        _set_text(presentation, 22, 3,
            "• E: energy consumption and price-weighted cost proxies\r• C: simulated carbon proxy\r• L: simulated decision latency\r• H: simulator health-risk proxy\r• P: simulated throughput\r• Shared GRU next-state MAE: 0.0750 on held-out simulator episodes",
            size=12)
        _set_text(presentation, 22, 5,
            "• B1 centralized heuristic\r• B2 independent agents\r• B3 decentralized agents without world model\r• B4 world-model scoring without LACD coordination\r• Full Gaia prototype\r• Same 30 evaluation seeds and 96-step horizon for every policy",
            size=12)
        _set_text(presentation, 22, 6, "Observed result and interpretation", size=16, bold=True)
        _set_text(presentation, 22, 7,
            "• Mean reward: full Gaia 0.2579 ± 0.0392; B1 0.2539 ± 0.0219; B4 0.2599 ± 0.0350.\r• Full Gaia did not beat B4. It traded higher throughput than B1 (0.6026 vs 0.5798) for higher energy cost (0.7020 vs 0.6607) and carbon proxy (0.4192 vs 0.4053).\r• Descriptive simulator results only; no significance test or weighted J(a) is claimed because objective weights are unspecified.",
            size=12)

        _set_table(presentation, 23, 2, [
            ["Activity", "Status"],
            ["Problem identification", "Completed"],
            ["Literature review", "Completed"],
            ["Research gap", "Completed"],
            ["Methodology design", "Implemented as prototype"],
            ["Dataset identification", "Completed: five sources inspected"],
            ["Data preprocessing", "Completed: task-specific pipelines"],
            ["Baseline implementation", "Completed: ZeMA / FF / HIPE / monitoring"],
            ["Proposed model (world model + decentralized agents)", "Prototype; not trained MAPPO/LACD"],
            ["Evaluation", "Completed: 30 paired seeds + held-out dataset tests"],
        ], font_size=9.5)
        _set_text(presentation, 23, 3, "Status reflects code and experiment artifacts generated on 2026-10-27.", size=10)

        _set_text(presentation, 24, 2,
            "Studied 8 papers and prepared a comparative analysis\rRefined the problem statement and wrote 5 objectives\rSharpened the research gap and stated the proposed contribution\rDetailed the methodology (What / Why / How) and defined 4 baselines\rDefined evaluation metrics and the multi-objective cost J(a)\rImplemented five dataset-specific inspection / preprocessing paths\rTrained ZeMA, Future Factories and HIPE baselines; ran unlabeled Smart Manufacturing screening\rRan 30 paired simulator seeds and saved model, metrics and split metadata\rFaculty feedback: not supplied in the project files; update after supervisor review.",
            size=14)

        remaining = presentation.Slides(25).Shapes(2).Table
        remaining_rows = [
            ["Phase", "Activity", "Next checkpoint", "Status"],
            ["1", "Confirm provenance and cite each supplied dataset", "Source pages / dataset papers", "In progress"],
            ["2", "Repeat dataset evaluation with robust temporal/block splits", "Multiple seeds and full labeled data", "Next"],
            ["3", "Specify LACD equations, message schema and safety constraints", "Approved algorithm definition", "Not started"],
            ["4", "Train MAPPO-style agents after LACD is specified", "Compare against rule prototype", "Not started"],
            ["5", "Validate edge/cloud latency on real devices or traces", "Measured network and compute delay", "Not started"],
            ["6", "Set objective weights and hard safety limits", "Define E/C/L/H/P weights", "Not started"],
            ["7", "Run larger paired-seed tests and statistical analysis", "100+ seeds; uncertainty estimates", "Not started"],
            ["8", "Integrate factory data and write final limitations", "External validation and reproducibility pack", "Not started"],
        ]
        for row_index, values in enumerate(remaining_rows, start=1):
            for column_index, value in enumerate(values, start=1):
                cell = remaining.Cell(row_index, column_index).Shape.TextFrame.TextRange
                cell.Text = value
                cell.Font.Name = "Calibri"
                cell.Font.Size = 8.5
                if row_index == 1: cell.Font.Bold = -1
        _set_text(presentation, 25, 3, "Next work depends on data access and a formal LACD specification.", size=10)

        final_slide = presentation.Slides(44)
        for index in range(final_slide.Shapes.Count, 0, -1):
            final_slide.Shapes(index).Delete()
        header = final_slide.Shapes.AddShape(1, 0, 0, 960, 58)
        header.Fill.ForeColor.RGB = _rgb(48, 44, 139)
        header.Line.Visible = 0
        header.TextFrame.TextRange.Text = "Results and conclusion"
        header.TextFrame.TextRange.Font.Name = "Calibri"
        header.TextFrame.TextRange.Font.Size = 25
        header.TextFrame.TextRange.Font.Bold = -1
        header.TextFrame.TextRange.Font.Color.RGB = _rgb(255, 255, 255)
        header.TextFrame.MarginLeft = 36
        header.TextFrame.MarginTop = 9

        cards = [
            ("Paired simulator study",
             "30 evaluation seeds x 96 steps; same seeds for all policies.\rFull Gaia reward: 0.2579 ± 0.0392\rB1: 0.2539 ± 0.0219 | B4: 0.2599 ± 0.0350"),
            ("Dataset baselines",
             f"Future Factories: test macro-F1 {future['test']['macro_f1']:.3f} (10k labeled windows).\rHIPE: next-minute power MAE {energy['test']['mae_kw']:.4f} kW.\rZeMA test macro-F1: cooler {maintenance['targets']['cooler_condition']['test_macro_f1']:.3f}; valve {maintenance['targets']['valve_condition']['test_macro_f1']:.3f}; pump {maintenance['targets']['pump_leakage']['test_macro_f1']:.3f}; accumulator {maintenance['targets']['accumulator_pressure']['test_macro_f1']:.3f}."),
            ("Interpretation",
             "Full Gaia did not outperform B4. Throughput rose versus B1, with higher energy and carbon proxies.\rSmart Manufacturing screening is unlabeled (5/172 test minutes flagged); it is not fault accuracy."),
        ]
        for x, (title, body) in zip([36, 342, 648], cards):
            card = final_slide.Shapes.AddShape(5, x, 82, 276, 166)
            card.Fill.ForeColor.RGB = _rgb(247, 249, 248)
            card.Line.ForeColor.RGB = _rgb(214, 223, 219)
            card.TextFrame.MarginLeft = 13
            card.TextFrame.MarginRight = 13
            card.TextFrame.MarginTop = 10
            card.TextFrame.MarginBottom = 8
            card.TextFrame.WordWrap = -1
            text_range = card.TextFrame.TextRange
            text_range.Text = title + "\r" + body
            text_range.Font.Name = "Calibri"
            text_range.Font.Size = 10
            text_range.Font.Color.RGB = _rgb(33, 47, 47)
            text_range.Paragraphs(1).Font.Size = 13
            text_range.Paragraphs(1).Font.Bold = -1

        _add_text(final_slide, 36, 270, 888, 26, "Conclusion", 19, _rgb(48, 44, 139), True)
        _add_text(final_slide, 36, 302, 888, 98,
            "The implementation demonstrates end-to-end feasibility for separate industrial data tasks, a shared GRU state-prediction prototype, and decentralized proposal exchange between subsystem agents. Current evidence does not establish that Gaia is superior, production-ready, safer, or privacy-preserving. LACD remains a rule-based prototype because its exact learned algorithm is not specified in the supplied materials. No weighted overall J(a) is reported because the objective weights have not been defined.",
            13, _rgb(33, 47, 47))
        _add_text(final_slide, 36, 416, 888, 54,
            "Next: validate with real factory observations, formalize and train LACD/MAPPO, test edge/cloud performance, define objective weights, and repeat evaluations with larger seed counts and statistical uncertainty.",
            11, _rgb(78, 91, 88))
        _add_text(final_slide, 36, 500, 300, 18, "Team 15 · Gaia research prototype · 2026", 8, _rgb(100, 110, 108))
        _add_text(final_slide, 885, 518, 59, 18, "44 / 44", 8, _rgb(0, 0, 0))

        presentation.Save()
    finally:
        presentation.Close()
        app.Quit()
    print(f"Updated deck saved: {output}")


def main():
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=project.parent / "Review_2_Team_15_Gaia (1).pptx")
    parser.add_argument("--output", type=Path, default=project.parent / "Review_2_Team_15_Gaia_Results_Updated.pptx")
    args = parser.parse_args()
    update_deck(args.source.resolve(), args.output.resolve(), project)


if __name__ == "__main__":
    main()
