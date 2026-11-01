# Gaia

A factory digital twin where a team of seven software agents negotiates energy, carbon, maintenance, production, compute placement, quality and safety decisions together, with a human operator able to step in at any moment.

Everything runs in your browser. No accounts, keys or servers are needed.

## Run it on your computer

### 1. Install the tools

- **Node.js 20.19 or newer** from [nodejs.org](https://nodejs.org) (tested on Node 22). This also installs `npm`.
- **VS Code** from [code.visualstudio.com](https://code.visualstudio.com). Optional but recommended extensions: ESLint, Prettier, Tailwind CSS IntelliSense.

### 2. Open the project in VS Code

1. Unzip the project.
2. In VS Code choose **File > Open Folder** and select the unzipped folder.
3. Open a terminal with **Terminal > New Terminal** (or press Ctrl+\`). It opens in the project folder.

### 3. Install and start

```sh
npm install
npm run dev
```

Open **http://localhost:8080**. The page reloads when you save a file. Press Ctrl+C in the terminal to stop.

Prefer [Bun](https://bun.sh)? Use `bun install` and `bun run dev` instead.

## Commands

| Command            | What it does                           |
| ------------------ | -------------------------------------- |
| `npm run dev`      | Start the app at http://localhost:8080 |
| `npm test`         | Run the tests                          |
| `npm run build`    | Make a production build                |
| `npm run lint`     | Check the code with ESLint             |
| `npm run format`   | Format everything with Prettier        |
| `npx tsc --noEmit` | Check types                            |

## What is in the app

| Page                       | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| Operations `/`             | Live factory: KPIs, machines, agents, negotiation, what the agents learned |
| Scenario desk `/scenarios` | Inject disruptions, run what-if comparisons, sweep eight scenarios         |
| Research `/research`       | The trained four-agent policy against baselines, with its limits stated    |
| Evidence `/evidence`       | Held-out results for the negotiating agents                                |

A notification bar on every page raises alerts and offers one-click actions. Use the **Role** menu to switch between Operator, Planner, Researcher and Plant manager, and the **Light / Dark** button to change theme. Roles are an interface setting, not a login.

## Optional: the Python research backend

Only needed to regenerate the data behind `/evidence` and `/research`. Requires Python 3.10 or newer.

```sh
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS or Linux
pip install -r requirements.txt
python -m gaia.export_research  # rewrites ../public/data/research.json
streamlit run streamlit_app.py  # backend dashboards
```

## Troubleshooting

- **`npm install` fails.** The project ships an `.npmrc` that handles this. Make sure you run the command in the project folder.
- **Port 8080 is busy.** Close the other program, or run `npx vite dev --port 3000`.
- **`/research` or `/evidence` shows an error.** Check that `public/data/research.json` and `evidence.json` exist.
- **Page looks stale.** Hard refresh with Ctrl+Shift+R. Simulation state lives in memory and resets on reload.

## More

- [Details.md](Details.md): what Gaia is, why it exists, how every part works and where it lives.
- [ARCHITECTURE.md](ARCHITECTURE.md): the rules to follow when changing the code.
- [BUGS.md](BUGS.md): bugs found and fixed, and known limitations.
- [CHANGELOG.md](CHANGELOG.md): version history.


## Contributors
- M Laasya (@mlaasya07) - 23XV1M6729
- Chaitanya K (@Chaitanya-kandagaddala-2006) - 23XV1M6717
- 
