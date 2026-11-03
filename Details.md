# Gaia in detail

Everything about Gaia in one place: what it is, why it exists, how each part works, where each part lives, and what it does not prove.

## Contents

1. [What Gaia is](#1-what-gaia-is)
2. [Why we built it and the thinking behind it](#2-why-we-built-it-and-the-thinking-behind-it)
3. [How it works](#3-how-it-works)
4. [The factory twin](#4-the-factory-twin)
5. [The seven agents](#5-the-seven-agents)
6. [Features by page](#6-features-by-page)
7. [Alerts and human overrides](#7-alerts-and-human-overrides)
8. [Roles](#8-roles)
9. [Data](#9-data)
10. [The Python backend](#10-the-python-backend)
11. [Where everything lives](#11-where-everything-lives)
12. [Design system and themes](#12-design-system-and-themes)
13. [Testing and quality](#13-testing-and-quality)
14. [Honest limits](#14-honest-limits)
15. [Glossary](#15-glossary)

---

## 1. What Gaia is

Gaia is a **digital twin of a small factory** plus a **collective of software agents** that run it. The twin is a simulation of eight machines, a grid connection and a small edge and cloud computing setup. Seven agents, each caring about a different goal, look ahead six hours, propose changes, argue with one another, and settle on a plan that the twin then carries out. A human can watch all of it and override any decision.

It has two halves that are deliberately kept apart:

| Half                          | What it is                                                                   | Where it runs            |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------ |
| **Live twin** (web app)       | A TypeScript simulation with rule-based negotiating agents that learn online | In your browser          |
| **Research backend** (Python) | Trained models, experiments on public datasets, and exported results         | On your machine, offline |

The web app shows the live twin on the Operations and Scenario pages, and shows the Python results on the Research and Evidence pages. The two meet only through two exported data files.

## 2. Why we built it and the thinking behind it

**The problem.** Factories usually manage energy, carbon, maintenance, production and compute placement as separate concerns. A choice that is good for one can quietly hurt another: running machines harder lifts output but wears them out and raises emissions; delaying maintenance saves downtime today and causes a breakdown tomorrow. Gaia puts these systems in one simulation so the trade-offs are visible.

**The idea behind it.** Several principles shaped the design:

- **Collaboration over a single boss.** Instead of one central optimizer, each agent represents one concern and speaks for it. Decisions come from negotiation, which makes the reasoning inspectable: you can read who proposed what, who objected, and why the final plan won.
- **Look before acting.** Agents do not guess. Every proposal is tested against a world model that plays the next six hours forward, so the argument is about predicted outcomes.
- **Safety is not negotiable.** Hard vetoes (deadlines, machine health, temperature, hazard index) can reject a plan no matter how many agents like it.
- **Agents learn from results.** One hour after each decision, agents compare what they predicted with what happened, then adjust their weights and how much they trust each other.
- **A human stays in charge.** Operators can throttle, service, repair and commission machines. Their choices are held for three simulated hours so the agents do not silently undo them.
- **Honest evidence.** The Research and Evidence pages report where the learned agents do well and where they do not, and the exported data carries its own caveats. Gaia would rather show a modest true result than an impressive unsupported one.
- **Real data informs, simulation decides.** Public industrial datasets (hydraulic rigs, assembly lines, power meters) shape what the agents observe. The factory itself is simulated, and every result is labelled as a simulator result.

## 3. How it works

One simulated **tick** is 10 minutes. The twin starts at 14:00. Every simulated hour (6 ticks) the agents run one **decision cycle**:

1. **Observe.** The twin reports machine health, temperature, load, power, the job queue, grid carbon and price, and compute use.
2. **Forecast.** The world model plays the next 6 hours (36 ticks) forward under the current plan to produce a baseline.
3. **Propose.** Each agent generates proposals aimed at its goal: slow a machine, defer a flexible job, service a machine early, move a workload to the edge or cloud, or expedite a job.
4. **Cross-evaluate.** Each agent scores every other agent's proposal using world-model rollouts, from its own point of view.
5. **Negotiate.** For up to 3 rounds, agents support, object to, revise or withdraw proposals. All messages are logged and shown.
6. **Resolve.** A resolver picks the plan with the best weighted global utility from the non-dominated candidates, subject to a safety floor and the hard vetoes below.
7. **Act.** The chosen actions are applied to the twin.
8. **Learn.** After one hour, realized results are compared with predictions. Agents update their utility weights and their trust in each other, and write a short plain-language lesson.

**Hard vetoes.** A plan is rejected if it would:

- cause more missed deadlines than the baseline plan (deadline floor);
- push a machine below 20% health, and worse than the baseline (health floor);
- push a machine above 118 degrees C, and hotter than the baseline (thermal limit);
- raise the safety hazard index by more than 1.5 (safety floor).

**The world model** forecasts with physics rollouts of the twin itself, corrected by exponential smoothing of recent bias and an online linear-regression residual. It reports confidence bands, which the Operations page draws as forecast ghosts.

**Two comparison baselines** exist in the code, used by the what-if lab and the scenario sweep:

- **Siloed agents:** each agent applies its own best proposal with no negotiation and no vetoes.
- **Reactive control:** no agents at all; the factory just reacts to events.

## 4. The factory twin

**Machines (8).** Five production machines and three support machines.

| Machine     | Type       | Base power | Starting health |
| ----------- | ---------- | ---------- | --------------- |
| CNC         | production | 45 kW      | 88              |
| Press       | production | 60 kW      | 52              |
| Robotic Arm | production | 18 kW      | 91              |
| Furnace     | production | 140 kW     | 74              |
| Packaging   | production | 25 kW      | 83              |
| Conveyor    | support    | 12 kW      | 79              |
| Compressor  | support    | 35 kW      | 66              |
| Chiller     | support    | 40 kW      | 85              |

Each machine has temperature, vibration, load, power, throughput, speed and a failure probability. Wear grows with load and heat; vibration rises as health falls; failure probability rises with vibration. A failed machine is down for 12 ticks unless a repair crew arrives. A service takes 3 ticks. Up to two extra CNC machines can be commissioned (see section 7).

**Computing (4 nodes, 5 workloads).** Three edge nodes (Edge A, B, C) with low latency and one Cloud Cluster with much more capacity but higher latency and a grid carbon cost. Workloads are vision inference, telemetry aggregation, predictive analytics, quality analytics and the schedule optimizer. Moving a workload trades latency against energy and carbon.

**The grid.** Carbon intensity (in g/kWh) and electricity price follow the time of day: solar lowers both at midday, an evening peak raises them, and a slow wind term varies the carbon figure. Ambient temperature follows a daily cycle.

**Jobs.** Jobs arrive for the production machines with a work amount, deadline, priority and a flag for whether they can be deferred. Missed deadlines count against the plan.

**Disruptions (7).** Grid carbon spike (x1.85 for 3h), heatwave (+13 degrees C for 6h), machine fault (a machine loses 35 health), rush order, cloud outage (3h, edge failover), energy price surge (x2.5 for 3h), supply delay (a queued job blocked for 2h).

**Agent actions (5).** `throttle`, `defer`, `service`, `offload`, `expedite`.

## 5. The seven agents

Each agent has learnable weights over ten metrics (energy, cost, emissions, downtime, machine wear, missed deadlines, throughput, latency, quality risk, safety risk), a trust score for every other agent, and an influence level.

| Agent         | Goal                                                          | Primary metrics              |
| ------------- | ------------------------------------------------------------- | ---------------------------- |
| Energy        | Minimize kWh and cost                                         | energy, cost                 |
| Carbon        | Minimize emissions, shift flexible load to clean windows      | emissions                    |
| Maintenance   | Maximize machine health, service before failure               | downtime, wear               |
| Production    | Maximize throughput and on-time jobs                          | missed deadlines, throughput |
| Orchestration | Place compute on edge or cloud for latency, energy and carbon | latency                      |
| Quality       | Keep output in spec: watch wear, heat and rush boosts         | quality risk                 |
| Safety        | Prevent thermal and failure hazards before they escalate      | safety risk, wear            |

The Python backend uses different agent sets for different purposes: the Evidence experiments use five of these (energy, carbon, maintenance, production, orchestration), and the learned policy on the Research page uses four of its own (scheduling, maintenance, energy, monitoring with edge and cloud). They are separate systems that share a name and an idea.

## 6. Features by page

### Operations (`/`)

- **KPI row:** power draw (kWh per 10 minutes), emissions with the live grid carbon intensity in g/kWh, energy cost, throughput, latency and average machine health.
- **Shop floor:** every machine with status, health bar, temperature and power. Operators can throttle, service or send a repair crew straight from the card. Held overrides are shown and can be released.
- **Forecast panel:** the next six hours with confidence bands, drawn over recent history.
- **Agent collective:** each agent, its goal, its current weights and its trust.
- **Negotiation feed:** the latest decision as a conversation (proposals, objections, revisions, consensus or veto).
- **Decision log:** the last 14 decisions with the adopted actions and the reasoning.
- **What the agents learned:** plain-language lessons written after each outcome.
- **Override log:** a record of every human action.

### Scenario desk (`/scenarios`)

- **Disruptions:** inject any of the seven disruptions into the live twin.
- **What-if lab:** replay the future from now under a disruption and compare the collective with siloed agents, the reactive control, or a decision you force.
- **Scenario sweep:** run the next 6 hours under 8 scenarios (a baseline plus seven disruptions) for the collective, siloed agents and the reactive control, with each agent's recommendation and how often it was adopted. Results are deterministic and never change the live twin.
- **Impact model:** pick disruptions and see the predicted effect on machine health, energy and deadlines.
- **Team submissions:** record a named scenario with its impact report. Submissions are stored in your browser only.

### Research (`/research`)

Results for the trained four-agent policy against three baselines (centralized, independent agents, rule-based coordination), measured over 30 held-out runs of 96 steps:

- findings computed directly from the data, so they stay accurate if the data is regenerated;
- a comparison table with the best value per metric marked;
- paired run-by-run wins and losses against each baseline;
- training curves;
- an attention heatmap showing which agent listens to which, with a warning when it is nearly uniform;
- behaviour statistics showing what the policy actually chooses;
- real-dataset evidence with each source's limitation;
- the full caveat list.

### Evidence (`/evidence`)

Held-out evaluation of the Python negotiating agents (100 evaluation runs of 96 steps) in two conditions: `default`, and `zema_prior`, which starts machine health from hydraulic-rig fault labels as a degradation-heavy stress test. It compares nine policies, shows paired differences with 95% confidence intervals, the pretrained agents' learned weights, and the caveats.

### Everywhere

- **Notification bar** with live alerts and one-click actions.
- **Playback:** step one tick, fast-forward 1 hour or 6 hours, pause or resume, speed 1x to 10x, and reset.
- **Role menu** and **Light / Dark theme button**.

## 7. Alerts and human overrides

The notification bar evaluates these rules continuously (`src/engine/alerts.ts`):

| Alert                | Severity | When                                                                                                    | Actions              |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| Machine failed       | Critical | A machine has failed                                                                                    | Send repair crew     |
| Overheating          | Critical | Temperature at or above 100 degrees C                                                                   | Throttle, service    |
| Running hot          | Warning  | At or above 92 degrees C while loaded                                                                   | Throttle, service    |
| High wear            | Warning  | Health below 40%                                                                                        | Service              |
| Failure risk         | Info     | The forecast puts a machine's failure chance above 2% with health falling below 55% in the next 6 hours | Service              |
| New machine required | Warning  | Production load above 85% with 2 or more missed jobs in the last 2 hours                                | Commission a machine |
| Repeated outages     | Info     | 8 or more machine-down ticks in the last 2 hours                                                        | None (review)        |

Alerts can be acknowledged. An acknowledged alert returns if its condition clears and then happens again.

**Human actions.**

- **Throttle:** set a machine's speed. The setting is **held for 3 simulated hours** (speed between 0.3 and 1.3), so the next agent decision does not undo it.
- **Service now:** send a machine into maintenance.
- **Send repair crew:** cuts a failed machine's outage from 12 ticks to 4 and returns it at 80% health or better. Does nothing on a machine that has not failed.
- **Commission a machine:** adds a new CNC machine at full health, up to two extra. It takes every second waiting CNC job that has not started, and receives new jobs from then on.

Every human action is logged in the override log.

## 8. Roles

The Role menu decides which pages and controls are offered. It is an **interface setting, not security**: there is no login and no server, so anyone can switch role. Its purpose is to keep each screen focused and prevent accidental actions.

| Role          | Can do                                                                | Pages                                         |
| ------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Operator      | Throttle and service machines, send repair crews, commission machines | Operations, Evidence                          |
| Planner       | Inject disruptions, use the scenario desk, reset the twin             | Operations, Scenario desk, Evidence           |
| Researcher    | Use the scenario desk, open Research, reset the twin                  | Operations, Scenario desk, Research, Evidence |
| Plant manager | Everything                                                            | All pages                                     |

A page the current role cannot open shows an explanation and offers the roles that can. The choice is remembered in your browser.

## 9. Data

Two exported files in `public/data/` feed the Research and Evidence pages. Both are generated by the backend and must not be edited by hand.

### `research.json` (Research page)

Generated by `backend/gaia/export_research.py`, which re-runs the trained policy on the saved evaluation seeds and checks that the results match the saved results exactly (maximum difference 0.0).

- **meta:** the four agents, 30 evaluation seeds, horizon of 96 steps, the seven metrics and which direction is better.
- **variants:** two checkpoints. `real_data` was trained with real-dataset evidence in its observations; `factorysim` was trained on the simulator alone. Each has policy metrics, paired comparisons against baselines, the training curve, attention weights and behaviour statistics (the older checkpoint cannot be re-run with current code, so it has saved metrics only).
- **evidence:** rows from five real datasets, each with an interpretation and a limitation.
- **caveats:** eight statements about what the results do not support.

### `evidence.json` (Evidence page)

Generated by `backend/gaia/lacd/experiment.py`.

- **meta:** 100 evaluation runs (seeds 10000 to 10099), 100 pretraining runs, horizon 96.
- **policies:** nine policies in two conditions, each with mean and standard deviation for reward, throughput, energy, energy cost, carbon, downtime, latency, maintenance and peak figures.
- **paired:** pairwise differences with 95% confidence intervals and a significance flag.
- **pretrained_agents:** learned weights, trust and influence for five agents.
- **zema_health_prior** and **zema_classifier_test:** how the hydraulic-rig data shaped starting machine health, and how well simple classifiers read its four component conditions.
- **caveats:** four statements about scope.

### The five real datasets

| Dataset                        | What it is                                       | How Gaia uses it                                        |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------- |
| ZeMA hydraulic rig             | Sensor cycles with labelled component conditions | Maintenance evidence and the health prior               |
| Future Factories               | Synchronized assembly-line channels              | Assembly-state and scheduling evidence                  |
| HIPE                           | Machine power measurements                       | One-minute-ahead energy forecasting                     |
| Smart Manufacturing            | Network, state and position events               | Unsupervised anomaly screening (no ground-truth labels) |
| Semiconductor process metadata | Static machine, route and travel-time tables     | Context only; no model is trained on it                 |

These datasets do not share labels or meaning, so each is used for its own task and never merged with the others.

## 10. The Python backend

Lives in `backend/`. It is a reproducible research starting point, not a claim that every referenced paper has been fully reproduced.

| Path                                                                                     | Purpose                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `gaia/lacd/`                                                                             | The negotiating agent system ported from the TypeScript engine, with MPC baseline, coordinator, policy and experiment runner            |
| `gaia/lacd_learning.py`                                                                  | The learned four-agent policy (role encoders, multi-head attention message passing, shared critic) in PyTorch, trained on the simulator |
| `gaia/integrate_datasets.py`                                                             | Turns the five datasets into per-agent evidence rows                                                                                    |
| `gaia/export_research.py`                                                                | Writes `public/data/research.json`                                                                                                      |
| `gaia/simulator.py`, `world_model.py`, `agents.py`                                       | The Python factory simulator, world model and earlier prototype policies                                                                |
| `gaia/train_*.py`, `zema.py`, `hipe.py`, `smart_manufacturing.py`, `future_factories.py` | Dataset loaders and trainers                                                                                                            |
| `app_pages/`, `streamlit_app.py`                                                         | Streamlit dashboards                                                                                                                    |
| `outputs/`                                                                               | Saved results and small trained checkpoints                                                                                             |
| `tests/`                                                                                 | Backend tests                                                                                                                           |
| `docs/`                                                                                  | Dataset audit, paper audit, implementation map                                                                                          |

Note that the repository contains two things called LACD: the utility, trust and negotiation system in `gaia/lacd/` and the neural policy in `gaia/lacd_learning.py`. They are separate.

## 11. Where everything lives

```text
src/
  routes/            One file per page (index, scenarios, research, evidence, operator redirect)
  components/
    AppShell.tsx       Header, navigation, role menu, theme button, playback
    NotificationBar.tsx  Alerts and their actions
    RoleGate.tsx       Blocks a page for roles without permission
    ThemeToggle.tsx    Light and dark switch
    dashboard/         Operations panels
    scenario/          Scenario desk panels and sweep
    research/          Research panels
    ui/                Shared building blocks
  engine/            The simulation core
    twin.ts            Machines, jobs, grid, physics, actions, repair and commissioning
    worldModel.ts      Six-hour forecasts and online correction
    agents.ts          The seven agents, utilities and proposals
    negotiation.ts     Multi-round negotiation
    consensus.ts       Resolver, vetoes and the siloed baseline
    learning.ts        Weight and trust updates, lessons
    alerts.ts          Alert rules
    scenarioLab.ts     Eight-scenario sweep
  scenarios/         Disruptions, counterfactuals and the impact model
  lib/
    useSimulation.ts   The simulation controller
    SimProvider.tsx    One shared simulation for all pages
    RoleProvider.tsx, roles.ts   Roles and permissions
    theme.tsx          Light and dark theme
    research.ts        Types and findings for research.json
  styles.css         Design tokens for both themes
  test/              Tests
public/data/         evidence.json and research.json (generated)
backend/             Python research pipeline
```

## 12. Design system and themes

Gaia has a dark industrial look by default: near-black background, deep green surfaces, a green primary for healthy states, a copper accent for warnings and a deep red for critical states, set in Roboto Mono. A **light theme** uses the same character on a pale background with darker greens and copper.

- Dark is the default. The **Light / Dark** button in the header switches, and the choice is remembered in your browser.
- A tiny script in the page head applies a saved light choice before the first paint, so there is no dark flash.
- Components use semantic color tokens only. Both themes are defined in `src/styles.css`.
- Light theme text and controls were checked against the WCAG AA contrast minimum of 4.5:1.
- Motion respects the reduced-motion setting. Alerts are announced to screen readers.

## 13. Testing and quality

Run `npm test`. The suite covers the engine (repair, commissioning, alerts, scenario sweep, learning), role permissions, the notification bar and machine controls, the scenario desk, research and evidence data and panels, routing, the theme, and a hygiene check on the repository. Backend tests are in `backend/tests/`.

Other gates: `npx tsc --noEmit`, `npm run build`, `npx prettier --check .`.

## 14. Honest limits

These matter when presenting Gaia. The numbers come from the data files shipped with the project.

**The live twin is a simulation.** Nothing in it is measured from a real plant. Latency and carbon figures are simulator proxies.

**The learned policy (Research page) is a prototype that has not converged.**

- Against the centralized baseline it wins on reward in only 5 of 30 runs, and its latency is worse in all 30. It is better on energy, energy cost, carbon, throughput and health risk in all 30.
- It makes the same discrete choices at every step (maintenance always on, cloud offload always off, shift scheduling always on). Its low health risk comes from always maintaining, not from reacting to conditions.
- Its agents barely differentiate whom they listen to: every attention cell lies between 0.243 and 0.259, where an even split is 0.25. No communication structure should be read from the heatmap.
- Training on real-dataset evidence did not raise reward: the simulator-only checkpoint scores 0.248 and the real-data checkpoint 0.237.

**The negotiating agents (Evidence page) trade throughput for energy.** In the default condition, centralized MPC (reward 0.504) and siloed agents (0.494) score higher reward than the LACD variants (0.21 to 0.29), mainly through higher throughput. The LACD variants use far less energy (about 0.55 to 0.61 against about 1.0) and lower peak carbon. Pretraining did not improve reward over the static or cold-start variants. The reward is a weighted blend, so the ranking depends on its weights.

**Other limits.**

- Roles are not security.
- Simulation state lives in memory and resets on reload. Team submissions are stored only in your browser.
- Agent exchange is simulated in one process. Nothing is deployed, encrypted or formally private.
- Several techniques from the referenced papers (MAPPO with an attention critic, generative augmentation, federated learning, meta-learning, causal discovery) are not implemented.

## 15. Glossary

| Term                  | Meaning                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LACD**              | Learning Agents for Collaborative Decisions: agents that learn online, can be pretrained, and control the factory to avoid over-use and extreme emissions |
| **Digital twin**      | A live simulated copy of a physical system that can be tested without risk                                                                                |
| **World model**       | The forecaster agents use to look ahead; here, physics rollouts with online correction                                                                    |
| **Tick**              | One simulation step, 10 simulated minutes                                                                                                                 |
| **Decision cycle**    | One round of propose, negotiate, resolve and act, once per simulated hour                                                                                 |
| **Veto**              | A hard safety rule that rejects a plan regardless of agent support                                                                                        |
| **Hold**              | The 3-hour period during which a human setting is protected from the agents                                                                               |
| **Siloed agents**     | Agents that act alone with no negotiation                                                                                                                 |
| **Reactive control**  | A baseline with no agents that only reacts to events                                                                                                      |
| **MPC**               | Model predictive control: a central planner that optimizes over a forecast horizon                                                                        |
| **Paired comparison** | Comparing two policies on the same random seed, run by run                                                                                                |
| **Held-out**          | Evaluated on runs never used in training                                                                                                                  |
