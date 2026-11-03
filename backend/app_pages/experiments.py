from pathlib import Path
import pandas as pd
import streamlit as st

from gaia.run_experiment import run_experiment

ROOT = Path(__file__).resolve().parents[1]

st.title("Policy experiments")
st.caption("Paired seeds · separated model-calibration episodes · five PPT-aligned comparisons")

with st.container(border=True):
    st.subheader("Run configuration")
    with st.form("experiment_form"):
        left, right, third = st.columns(3)
        episodes = left.number_input("Evaluation episodes", min_value=5, max_value=500, value=30, step=5)
        calibration_episodes = right.number_input("World-model calibration episodes", min_value=10, max_value=500, value=30, step=5)
        horizon = third.number_input("Steps per episode", min_value=8, max_value=500, value=96, step=8)
        seed = st.number_input("Random seed", min_value=0, max_value=2_000_000_000, value=42, step=1)
        submitted = st.form_submit_button("Run paired comparison", type="primary", icon=":material/play_arrow:")

if submitted:
    result_slot = st.container()
    with st.status("Training calibration model and running paired policies…", expanded=True) as status:
        try:
            result = run_experiment(
                episodes=int(episodes),
                world_model_episodes=int(calibration_episodes),
                horizon=int(horizon),
                seed=int(seed),
                out_dir=ROOT / "outputs" / "simulation",
            )
            st.session_state["latest_experiment_metrics"] = result["metrics"]
            st.session_state["latest_world_model_metrics"] = result["world_model"]
            status.write(f"Saved CSVs and model artifacts to {result['output_dir']}.")
            status.update(label="Experiment complete", state="complete", expanded=False)
        except Exception as error:
            status.update(label="Experiment failed", state="error", expanded=True)
            st.exception(error)

metrics = st.session_state.get("latest_experiment_metrics")
if metrics is None:
    path = ROOT / "outputs" / "simulation" / "episode_metrics.csv"
    if path.exists():
        metrics = pd.read_csv(path)

if metrics is not None and not metrics.empty:
    world_model_metrics = st.session_state.get("latest_world_model_metrics", {})
    mean_table = metrics.groupby("policy", as_index=False).mean(numeric_only=True)
    metric_options = ["reward", "energy_cost", "energy", "carbon", "throughput", "latency", "downtime", "maintenance"]
    chosen_metric = st.selectbox("Compare metric", metric_options, index=0)
    chart = mean_table[["policy", chosen_metric]].sort_values(chosen_metric, ascending=chosen_metric not in {"reward", "throughput"})
    st.bar_chart(chart, x="policy", y=chosen_metric, horizontal=True)
    st.dataframe(mean_table, hide_index=True)

    if world_model_metrics:
        with st.container(border=True):
            st.subheader("Shared recurrent world model")
            st.metric("Held-out episode MAE", f"{world_model_metrics['held_out_episode_mae']:.4f}")
            st.caption("Trained on separate random-action simulator rollouts; its test episodes do not enter policy calibration.")

    st.subheader("What is being compared")
    st.dataframe(pd.DataFrame([
        {"model": "B1 centralized", "definition": "Single heuristic baseline; retained for comparison."},
        {"model": "B2 independent", "definition": "Subsystem agents with no proposal exchange."},
        {"model": "B3 without world model", "definition": "Decentralized LACD-inspired agents; no learned prediction."},
        {"model": "B4 without LACD", "definition": "Independent proposals with model-based candidate scoring."},
        {"model": "Full Gaia prototype", "definition": "Decentralized proposals plus GRU-predicted-state candidate scoring."},
    ]), hide_index=True)
    st.warning("The coordinated policy is a rule-based prototype, not trained MAPPO/attention-critic LACD. Simulator improvements do not establish factory performance or data privacy.")
else:
    st.info("No simulation results yet. Configure a run above to compare B1–B4 and the full prototype.", icon=":material/info:")
