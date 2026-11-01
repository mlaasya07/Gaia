# Gaia — paper-aligned smart-factory multi-agent prototype

This repository is a **reproducible starting implementation**, not a claim that every paper's full experiment has been reproduced. It uses the public datasets that can be obtained and keeps unavailable/private data clearly separated.

## Research alignment (the eight supplied papers)

1. **World Models (Ha & Schmidhuber, 2018):** a learned next-state predictor is included as a *world-model baseline/prototype*. CarRacing/VizDoom are not factory data, so they are not mixed into industrial training.
2. **Multi-agent energy management for steel-powder manufacturing (Applied Energy, 2025):** represented by an energy/production simulator and baseline policies. The paper states its case-study data are available on request; no private data are fabricated.
3. **ML2MAS (2025):** the ZeMA hydraulic condition-monitoring dataset is the main public predictive-maintenance dataset. The paper's BNN/GAN/MARL combination is not falsely claimed to be fully reproduced here; the baseline is an interpretable feature pipeline + Random Forest.
4. **Carbon-aware spatio-temporal workload shifting (2025):** uses the paper-linked FLUIDOS energy predictor repository as a reference, plus a transparent toy edge/cloud scheduling simulation. The paper says the proposed full algorithm was not fully implemented.
5. **Digital twin + edge AI + federated learning (Scientific Reports, 2025):** represented by a local digital-twin simulator and edge/cloud latency/cost fields. Its experimental data are available from authors on request.
6. **Hybrid digital twin + meta-learning + RL (2025):** the paper describes a synthetic wafer-inspection dataset but does not provide a downloadable dataset in the supplied PDF. No synthetic data are passed off as the paper's original data. A simulation adapter is included for later reproduction.
7. **CausalPulse (2026):** Future Factories public manufacturing data is the intended anomaly/diagnostic dataset. Download/access instructions are in `docs/DATASETS.md`; use the analog CSV first. Causal discovery in this prototype is a transparent correlation/conditional-association diagnostic, not a reproduction of CausalPulse's full neurosymbolic pipeline.
8. **MARL in smart factories review (2022):** informs the multi-agent/baseline comparison; it has no single dataset of its own.

## Important implementation boundary

The slide deck names a coordination idea **LACD**, but the supplied material does not specify its full expansion or exact algorithm. This repository therefore uses an explicitly labelled **prototype coordination policy** and compares it against centralized and independent policies. Replace the prototype with the exact LACD algorithm only after its definition is confirmed. Do not report the prototype as a faithful LACD reproduction.

## Quick start (Windows PowerShell)

```powershell
cd Gaia_Paper_Aligned
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m gaia.train_maintenance --data ..\Gaia-Code\Dataset\data.zip
python -m gaia.train_future_factories --source "..\Gaia-Code\Dataset\archive (15).zip" --max-rows 10000
python -m gaia.train_energy --source "..\Gaia-Code\Dataset\hipe_cleaned_v1.0.1_geq_2017-10-23_lt_2017-10-30.zip"
python -m gaia.train_monitoring --source "..\Gaia-Code\Dataset\Smart-Manufacturing-Dataset-0.1.0.zip"
python -m gaia.run_experiment --episodes 30 --world-model-episodes 30 --horizon 96
python -m streamlit run streamlit_app.py
```

`Gaia-Code\Dataset` is auto-detected when it is a sibling of `Gaia_Paper_Aligned`. Each pipeline reads its own archive directly; no dataset is merged with an unrelated source. To use the downloader instead, `python scripts\download_zema.py` still places ZeMA under `data/raw/zema`.

To inspect/process a different Future Factories release, pass its ZIP or extracted CSV folder explicitly:
```powershell
python -m gaia.train_future_factories --source path\to\future_factories.zip --max-rows 50000
```

The Overview page is a project dashboard for saved dataset/model results, evidence-based insights, a LACD workbench (policy evaluation, training curves, dataset-to-agent evidence and predictions, and implementation source), and a browser for files under `outputs/`. Dataset-linked artifacts are shown by dataset and agent role; they do not imply that the learned LACD checkpoint was trained or validated on heterogeneous real-factory data. The dashboard previews tabular/JSON artifacts and avoids loading large model checkpoints into memory. The Datasets page offers archive previews and task-specific training actions; Policy experiments provides paired simulator comparisons. Results, splits, model files and provenance metadata are saved under `outputs/`. No notebook is included in the current project folder.

## What is implemented

- ZeMA cycle-level sensor feature extraction and per-component maintenance classifiers.
- A small factory digital-twin simulator with machine health, production demand, energy price/carbon intensity, workload and edge/cloud options.
- Five PPT-aligned policies: B1 centralized baseline, B2 independent agents, B3 without world model, B4 without LACD, and full Gaia prototype, all evaluated on identical seeds.
- Shared latent-state encoder + GRU dynamics model trained on separate simulator calibration episodes and evaluated on held-out episodes.
- LACD-inspired decentralized agents for scheduling, maintenance, energy and edge/cloud, exchanging bounded proposals. This is a rule-based prototype, not trained MAPPO/attention-critic LACD or a deployed distributed system.
- Source-specific loaders and tasks for ZeMA, Future Factories, HIPE, Smart Manufacturing, and semiconductor process metadata.
- Episode-level energy, price-weighted energy-cost proxy, carbon, throughput, downtime, latency, maintenance and reward outputs as CSV.
- Future Factories label-aware classifier that excludes missing descriptions and validates synchronized sensor channels.
- Dataset manifest, provenance notes, and limitations.

## Reproducibility / reporting

Do not compare raw accuracy across ZeMA and Future Factories as if they were the same task. Keep dataset-specific train/validation/test splits and report macro-F1, per-class metrics, confusion matrices, and class imbalance. For the simulator report mean and standard deviation across seeds and compare identical environment seeds for each policy. Report measured results from your actual run; the repository does not include invented result numbers.

## Directory layout

- `gaia/` model, preprocessing, simulator, agents and experiment runner
- `scripts/` data acquisition helper
- `docs/DATASETS.md` dataset availability and citations
- `data/` downloaded datasets and generated outputs (not committed)
