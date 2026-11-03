# Gaia implementation map

## Data flow

1. ZeMA raw sensor matrices + `profile.txt` -> per-cycle statistical features -> four separate component-condition classifiers.
2. Future Factories synchronized channels -> timestamp/label integrity validation -> five-sample windows -> grouped train/validation/test classifier; blank labels are excluded.
3. HIPE power samples -> per-machine minute aggregation and exact-offset lag features -> one-minute-ahead energy forecast with chronological splits.
4. Smart Manufacturing network/state/position events -> streaming one-minute aggregation -> train-only Isolation Forest and unlabeled screening scores.
5. Semiconductor process archive -> machine, route, storage and travel-time metadata tables; no predictive model is trained without observations/labels.
6. Simulator state -> local energy/maintenance/scheduling/edge-cloud proposals -> bounded action exchange -> decentralized LACD-inspired conflict resolution -> next state and reward.
7. World-model calibration rollouts -> shared MLP encoder + GRU dynamics -> held-out episode MAE. Policy evaluation uses separate simulator seeds.
8. B1 centralized, B2 independent, B3 no world model, B4 no LACD, and full prototype run on the same evaluation seeds -> episode metrics and mean/std comparison.

Agent exchange is currently simulated in one process. It passes action proposals rather than raw sensor records, but it does not provide deployed distributed execution, cryptographic protection, or a formal privacy guarantee.

## Why separate sources?

ZeMA is a hydraulic rig, Future Factories is an assembly-line testbed, Google Cluster Data is datacenter workload telemetry, and the steel-powder case-study data are not publicly downloadable from the supplied paper. They do not share labels or row semantics. They support different modules, not one naïvely concatenated table.

## Planned fair evaluation

- Maintenance: accuracy, macro-F1, per-class precision/recall/F1, confusion matrix; report class counts and split seed.
- Future Factories assembly-state classification: validation/test macro-F1 and per-class metrics on the exact supplied version; blank descriptions are not ground truth.
- HIPE energy forecasting: chronological held-out MAE/RMSE for one-minute-ahead active power.
- Smart Manufacturing monitoring: anomaly screening fraction and score distribution only; there are no verified anomaly labels for accuracy/F1.
- Coordination: 30+ episode seeds (increase to 100 for final), identical seeds across policy variants; mean ± std for reward, throughput, energy, carbon proxy, latency, downtime and maintenance count.
- Ablations: B1 centralized heuristic; B2 independent agents; B3 without world model; B4 without LACD; full model-guided decentralized prototype.
- Predictive world model: held-out-episode MAE, not in-sample MAE.
- Edge/cloud: label all latency and carbon values as simulator proxies unless measured from actual devices/traces.

## Not yet a paper-faithful reproduction

- MAPPO with attention critic from Paper 2 is not implemented; LACD uses a rule-based message-proposal prototype.
- BNN/GAN augmentation from ML2MAS is not implemented.
- Federated learning and FMI co-simulation from Paper 5 are not implemented.
- Meta-learning/Q-learning from Paper 6 is not implemented.
- CausalPulse's full agent protocol, causal discovery and operator-in-the-loop pipeline are not implemented.
- LACD is now defined as Learning Agents for Collaborative Decisions (agents that learn online and can be pretrained, controlling machines to avoid over-usage and extreme emissions) and implemented in `gaia/lacd/`. It is still a hand-built rule/utility system, not MAPPO or an attention critic.
