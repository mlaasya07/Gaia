# Changelog

## v3.0 - 2026-11-01

Summary: Light and dark themes, machine commissioning, full documentation, and a cleanup pass.

- Added: light theme and a Light / Dark button (src/lib/theme.tsx, ThemeToggle, token sets in src/styles.css). Dark stays the default and a saved choice is applied before first paint.
- Added: twin.commissionMachine, a role permission and a "Commission a machine" button on the capacity alert. Up to two extra CNC machines; they take half of the waiting CNC jobs and receive new work.
- Added: Details.md (every part of Gaia explained), BUGS.md (bugs found and known limits) and a concise README with local run instructions.
- Added: src/test/theme.test.tsx and src/test/hygiene.test.ts; commissioning tests. The suite now covers the engine, roles, alerts, UI, research data, routing, theme and repository hygiene.
- Added: .npmrc so plain `npm install` works.
- Modified: the no-agent baseline is now called the reactive control everywhere (code, labels and docs).
- Modified: ARCHITECTURE.md now holds all application rules; the separate agent-rules file was removed.
- Modified: .prettierignore skips generated data; all other files were formatted.
- Fixed: page metadata and docs said five agents; the engine runs seven.
- Fixed: backend docs and a docstring pointed at paths that do not exist in this layout.
- Fixed: package name was the template placeholder; it is now `gaia`.

## v2.1 - 2026-11-01

Summary: Operator alerts and overrides, role-based access, a research dashboard for the learned policy, and tests.

- Added: src/components/NotificationBar.tsx and src/engine/alerts.ts, live alerts with throttle, service and repair-crew actions.
- Added: twin.dispatchRepair and twin.holdThrottle. Human speed settings are now held against the agents for three simulated hours; before, the next hourly decision silently undid them.
- Added: src/lib/roles.ts, RoleProvider and RoleGate. Roles are an interface setting, not authentication.
- Added: src/lib/SimProvider.tsx. One shared simulation across pages; previously each route created its own.
- Added: /scenarios (scenario desk with the new eight-scenario sweep). /operator redirects to it.
- Added: /research, fed by public/data/research.json from backend/gaia/export_research.py.
- Added: backend/gaia/lacd_learning.py and integrate_datasets.py with their small checkpoints and outputs.
- Modified: / is now the operations dashboard; scenario tools moved to the scenario desk. /evidence uses the shared shell.
- Modified: vite.config.ts uses host true instead of an IPv6-only host.
- Fixed: the activity log claimed a repair crew was dispatched even when the machine had not failed.
- Fixed: Safety Agent label was unreadable (dark red text on a dark background).
- Added: 67 frontend tests and 6 backend tests.

## v2.0 - 2026-10-28

Summary: Merge into the Gaia monorepo, remove the hosted-editor tooling, add the evidence page.

- Removed: the hosted-editor vite config wrapper, its project folder, its agent-rules block and its error-reporting module.
- Modified: vite.config.ts, plain Vite with TanStack Start, React, Tailwind and tsconfig-paths plugins.
- Modified: src/routes/__root.tsx, error component no longer reports to an external editor.
- Added: src/routes/evidence.tsx, results page fed by public/data/evidence.json from the Python backend.
- Added: ARCHITECTURE.md, the application rules.

## v1.2 - 2026-10-08

Summary: Apply the requested design system, remove em dashes, and clarify simulation playback controls.

- Modified: src/styles.css, semantic palette tokens, Roboto Mono font tokens, body typography, and radius.
- Modified: src/routes/__root.tsx, Route.head and ErrorComponent, font stylesheet and punctuation.
- Modified: src/routes/index.tsx, Route.head, Header, ForecastPanel, WhatIfPanel, and EventsPanel, punctuation, shared buttons, labeled pause/resume/reset and playback icons.
- Modified: src/engine/negotiation.ts, negotiate, proposal text punctuation only.
- Modified: src/server.ts and src/lib/error-capture.ts, comment punctuation only.
- Modified: src/routes/README.md and the architecture rules, punctuation and application architecture rules.
- Modified: README.md, project documentation, file inventory, design system, local run instructions, and version.
- Added: CHANGELOG.md, initial build record and current change record.
- Added: roadmap.md, requested change checklist.
- Fixed: Dashboard styling used colors and fonts outside the supplied design system.

## v1.1 - 2026-10-06

Summary: Initial local Gaia simulation implementation, recorded retrospectively from the existing project.

- Added: src/engine/agents.ts, createAgents, deltas, utility, makeContext, evaluateProposal, propose, local factory simulation and agent logic.
- Added: src/engine/consensus.ts, resolve, decideCollaborative, decideSiloed, local factory simulation and agent logic.
- Added: src/engine/learning.ts, realizedSummary, learnFromOutcome, local factory simulation and agent logic.
- Added: src/engine/negotiation.ts, formatMetricDiff, worstMetric, bestMetric, negotiate, resolverMessage, local factory simulation and agent logic.
- Added: src/engine/twin.ts, rand, hourOf, clockLabel, gridProfile, makeJob, createWorld, addEvent, activeJob, step, applyAction, resetTransient, actionTarget, describeAction, local factory simulation and agent logic.
- Added: src/engine/worldModel.ts, cloneWorld, rollout, createWorldModel, correctSummary, forecast, recordPending, observe, local factory simulation and agent logic.
- Added: src/scenarios/counterfactual.ts, runCounterfactual, disruptions and counterfactual comparisons.
- Added: src/scenarios/events.ts, injectEvent, disruptions and counterfactual comparisons.
- Added: src/lib/useSimulation.ts, SimApi and useSimulation, playback, decisions, learning, events and what-if state.
- Modified: src/routes/index.tsx, Route, Index, Header, KpiRow, Sparkline, ForecastPanel, MachineGrid, AgentPanel, NegotiationFeed, DecisionLog, EventsPanel and WhatIfPanel, local live simulation screen.
- Modified: src/routes/__root.tsx, Route.head, Gaia metadata.
- Modified: src/styles.css, initial dark industrial theme.
- Added: framer-motion dependency.
