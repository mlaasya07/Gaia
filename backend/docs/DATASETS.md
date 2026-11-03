# Dataset audit and acquisition

This is based on inspection of the eight PDFs supplied in `ALL Papers.zip`. Access status is stated honestly; a paper mentioning a dataset does not guarantee it is bundled or downloadable.

## Supplied local archives (`../Gaia-Code/Dataset`)

The dashboard auto-detects this sibling folder. The five archives are separate sources and are not concatenated into one training table.

| Archive                                                | Verified contents                                                                                                                                                                                                        | Supported use in Gaia                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.zip`                                             | ZeMA hydraulic rig; 2,205 cycles, 17 sensor matrices, five columns in `profile.txt`; archive integrity verified.                                                                                                         | Separate component-condition classifiers.                                                                                                                         |
| `archive (15).zip`                                     | Future Factories analog; seven synchronized CSV channels, 974,836 timestamps from 2023-12-11 to 2023-12-12; exact timestamp/Description alignment. 492,728 nonblank labels in three classes; 482,108 rows are unlabeled. | Five-timestep assembly-description classifier, sampled labeled rows, contiguous grouped train/validation/test. Blank labels are excluded, never labeled “normal.” |
| `hipe_cleaned_v1.0.1_geq_2017-10-23_lt_2017-10-30.zip` | Eleven electrical telemetry CSVs, 1,239,845 rows across 11 machines, power and electrical-quality features, Oct 23–30, 2017. No verified fault labels.                                                                   | Per-machine minute aggregation and one-minute-ahead `P_kW` forecasting with a chronological split. This is energy forecasting, not fault classification.          |
| `Smart-Manufacturing-Dataset-0.1.0.zip`                | Nested archive with 12,757,920 communications, 832,930 position updates, and 213,056 state events over about 68,524 seconds.                                                                                             | Chunked minute-level monitoring and unsupervised screening. `Latency` is a message requirement, not observed network delay; no anomaly ground truth is included.  |
| `dataset.zip`                                          | Six static semiconductor process/configuration tables, including 100 machines, 40 process steps, storage and travel-time data.                                                                                           | Route/machine metadata inspection only. No time-series observations or prediction labels are present.                                                             |

HIPE and the local semiconductor dataset are additions supplied in `Gaia-Code`; they are not asserted to be the exact datasets from any of the eight reviewed papers. Confirm the original HIPE source before claiming its provenance in the final report.

## 1) ZeMA hydraulic condition monitoring — DOWNLOADABLE, primary dataset

- Official Zenodo record: https://zenodo.org/records/1323611
- Direct archive: https://zenodo.org/record/1323611/files/data.zip?download=1
- Alternative UCI record: https://doi.org/10.24432/C5CW21
- License on UCI listing: CC BY 4.0; cite the dataset and follow the official record's terms.
- Contains 2,205 cycles of multivariate sensor data and `profile.txt` labels for cooler, valve, pump, accumulator, and stability. Sensor signals have different sampling rates. Rows correspond to cycles; columns are samples in each cycle.
- Used by Paper 3 (ML2MAS) and is the main public maintenance dataset.

Run `python scripts/download_zema.py`. Expected files include `profile.txt` and sensor text files such as `PS1.txt`, `EPS1.txt`, `FS1.txt`, `TS1.txt`, `VS1.txt`.

Suggested split: split by contiguous cycle blocks, not individual time points, to avoid leakage. The current pipeline keeps 64-cycle groups disjoint across training, validation and test partitions.

## 2) Future Factories (FF) manufacturing data — supplied local archive

- Paper dataset page: https://arxiv.org/abs/2401.15544
- V2 paper: https://arxiv.org/abs/2502.05020
- Public analog dataset mirror linked from research repositories: https://www.kaggle.com/datasets/ramyharik/ff-2023-12-12-analog-dataset
- The supplied CausalPulse PDF identifies the public Future Factories dataset from the University of South Carolina. The local analog archive has seven synchronized sensor CSVs with `Description` values such as `NoNose` and `NoNose,NoBody2`; it does not include image data in this archive.
- The supplied `archive (15).zip` is read directly from `../Gaia-Code/Dataset/`; it does not need extraction. Do not upload proprietary Planar Sensor Element data; it is not public.
- The Future Factories papers describe different runs/versions (2023 30-hour run and 2024 8-hour V2 run). Record exactly which version/file you use in your report.

## 3) FLUIDOS energy predictor / workload data — PUBLIC CODE, data have prerequisites

- Repository: https://github.com/fluidos-project/fluidos-energy-predictor
- The repo README describes Google Cluster Data v3 workload traces and SPECpower_ssj2008 machine power profiles. Sample files are in repository releases; full Google Cluster Data retrieval may require Google Cloud access and considerable processing.
- The paper also discusses Boavizta embodied-carbon data and electricity carbon-intensity sources. These are not automatically merged into the ZeMA dataset.
- This is a reference for Paper 4's workload/energy prediction component, not a factory maintenance dataset.

## 4) World Models (Paper 1)

- Paper and demos: https://worldmodels.github.io/
- Original experiments use CarRacing-v0 and VizDoom. These are simulation environments, not factory measurements. Gaia uses the _idea_ of learning a compact/predictive state model; it does not train its industrial maintenance model on racing images.

## 5) Steel-powder energy-management paper (Paper 2)

The supplied paper's data availability statement says: **“Data will be made available on request.”** We cannot download the authors' case-study data without permission. The code includes a simulator-based comparison and marks it as simulated.

## 6) Digital twin + edge computing + federated learning (Paper 5)

The supplied paper says its data are available from the corresponding author on reasonable request. No paper-specific raw dataset was included in the ZIP. The prototype's simulated edge/cloud experiments are not a reproduction of the paper's private experiment.

## 7) Hybrid digital twin / wafer-inspection paper (Paper 6)

The paper describes a synthetic dataset and reports a split/training setup, but the supplied PDF does not provide a verifiable download URL or exact dataset artifact. A generator created independently for this project would be _our synthetic simulation_, not the paper's dataset. Keep this distinction explicit.

## 8) MARL review (Paper 8)

This is a review of multi-agent RL in smart factories and has no single dataset to download.

## Reproducibility rules

1. Keep ZeMA and Future Factories as separate tasks/data sources.
2. Never concatenate unrelated datasets into one training table without a documented schema and justified shared target.
3. Do not claim to reproduce private data results or paper-reported scores.
4. Save dataset source, version, file names, row counts, split seed and preprocessing settings alongside every run.
