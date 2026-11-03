from pathlib import Path
import json

import pandas as pd
import streamlit as st

from gaia.dashboard_utils import dataset_inventory, discover_dataset_root


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = discover_dataset_root()


@st.cache_data(ttl="5m", max_entries=8)
def load_simulation_metrics(path: str):
    source = Path(path)
    if not source.exists():
        return pd.DataFrame()
    return pd.read_csv(source)


@st.cache_data(ttl="5m", max_entries=8)
def load_model_metadata(path: str):
    source = Path(path)
    if not source.exists():
        return {}
    return json.loads(source.read_text(encoding="utf-8"))


st.title("Gaia research workbench")
st.caption("Dataset-specific models · decentralized subsystem proposals · shared predictive state")

inventory = dataset_inventory(DATA_ROOT)
available = sum(item["available"] for item in inventory)
simulation = load_simulation_metrics(str(ROOT / "outputs" / "simulation" / "episode_metrics.csv"))
policy_count = int(simulation["policy"].nunique()) if not simulation.empty else 0
world_model = load_model_metadata(str(ROOT / "outputs" / "simulation" / "world_model_metadata.json"))

with st.container(horizontal=True):
    st.metric("Dataset sources", f"{available} / {len(inventory)}", border=True)
    st.metric("Compared policies", str(policy_count) if policy_count else "Not run", border=True)
    st.metric("World-model MAE", f"{world_model['held_out_episode_mae']:.4f}" if world_model else "Not run", border=True)
st.caption("Evaluation basis: simulator rollouts plus separate dataset-specific tasks.")

left, right = st.columns([1.3, 1], gap="large")
with left:
    with st.container(border=True):
        st.subheader("Policy comparison")
        if simulation.empty:
            st.write("No experiment results are saved yet.")
            st.page_link("app_pages/experiments.py", label="Open experiments", icon=":material/play_arrow:")
        else:
            objective = st.segmented_control(
                "Objective",
                ["Reward", "Energy cost", "Carbon", "Throughput", "Latency"],
                default="Reward",
                key="overview_objective",
            )
            metric_map = {
                "Reward": "reward", "Energy cost": "energy_cost", "Carbon": "carbon",
                "Throughput": "throughput", "Latency": "latency",
            }
            summary = simulation.groupby("policy", as_index=False)[metric_map[objective]].agg("mean")
            st.bar_chart(summary, x="policy", y=metric_map[objective], horizontal=True)
            st.dataframe(summary.rename(columns={metric_map[objective]: f"Mean {objective.lower()}"}), hide_index=True)
            st.caption("All policy values are simulator proxies. Compare paired episode seeds; they are not factory measurements.")
with right:
    with st.container(border=True):
        st.subheader("Research boundary")
        st.write("The supplied data sources have different labels and units. Gaia keeps each task separate and connects them only through normalized subsystem signals.")
        st.badge("Decentralized prototype", icon=":material/hub:", color="green")
        st.caption("Agents exchange bounded action proposals. The current simulator is single-process and does not provide deployed distributed execution or a privacy guarantee.")
        st.badge("LACD is not paper-faithful yet", icon=":material/info:", color="orange")
        st.caption("The deck does not define the exact learned LACD algorithm. The prototype is rule-based; it is not trained MAPPO or an attention critic.")

st.subheader("Dataset registry")
columns = st.columns(2, gap="small")
for index, item in enumerate(inventory):
    with columns[index % 2]:
        with st.container(border=True):
            label = ":green-badge[Available]" if item["available"] else ":gray-badge[Not found]"
            st.markdown(f"**{item['name']}**  {label}")
            st.caption(item["task"])
            st.write(item["label_status"])
            if item["archive_mb"] is not None:
                st.caption(f"{item['archive_mb']:.1f} MB · {Path(item['path']).name}")

st.caption(f"Data auto-detected at `{DATA_ROOT}`. Use the Datasets view to inspect or process an archive.")
