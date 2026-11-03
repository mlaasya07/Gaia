from pathlib import Path
import json
import zipfile

import pandas as pd
import streamlit as st

from gaia.dashboard_utils import DATASET_SPECS, dataset_inventory, discover_dataset_root

ROOT = Path(__file__).resolve().parents[1]


@st.cache_data(ttl="1h", max_entries=16)
def archive_members(path: str):
    with zipfile.ZipFile(path) as archive:
        return [{"file": item.filename, "compressed_mb": round(item.compress_size / 1_000_000, 2),
                 "expanded_mb": round(item.file_size / 1_000_000, 2)}
                for item in archive.infolist() if not item.is_dir()]


@st.cache_data(ttl="1h", max_entries=8)
def csv_preview(path: str, member: str):
    with zipfile.ZipFile(path) as archive, archive.open(member) as handle:
        frame = pd.read_csv(handle, nrows=40, low_memory=False)
    return frame


auto_root = discover_dataset_root()
with st.sidebar:
    st.subheader("Data location")
    root_text = st.text_input("Dataset folder", value=str(auto_root), help="The project automatically checks the sibling Gaia-Code/Dataset folder.")
    max_rows = st.slider("Maximum labeled rows", min_value=1_000, max_value=50_000, value=10_000, step=1_000)

data_root = Path(root_text).expanduser()
inventory = dataset_inventory(data_root)
st.title("Dataset workbench")
st.caption("Inspect source files and labels before running a task-specific pipeline. Archives remain in place; large inputs are streamed.")

available_specs = [item for item in inventory if item["available"]]
if not available_specs:
    st.warning(f"No recognized dataset archives found under {data_root}.")
    st.stop()

source_names = [item["name"] for item in available_specs]
selected_name = st.selectbox("Dataset", source_names)
selected = next(item for item in available_specs if item["name"] == selected_name)
source = Path(selected["path"])

with st.container(horizontal=True):
    st.metric("Task", selected["task"], border=True)
    st.metric("Archive size", f"{selected['archive_mb']:.1f} MB", border=True)
    st.metric("Label status", "Labeled" if "No verified" not in selected["label_status"] and "No anomaly" not in selected["label_status"] and "no fault" not in selected["label_status"] else "Unlabeled / metadata", border=True)

st.write(selected["label_status"])
st.caption(selected["processing"])

if source.suffix.lower() == ".zip":
    with st.expander("Archive contents", icon=":material/folder_open:"):
        members = archive_members(str(source))
        st.dataframe(pd.DataFrame(members), hide_index=True, height=280)
        csv_members = [row["file"] for row in members if row["file"].lower().endswith(".csv")]
        if csv_members:
            chosen_member = st.selectbox("CSV preview", csv_members, key=f"preview_{selected['key']}")
            preview = csv_preview(str(source), chosen_member)
            st.caption(f"First {len(preview)} rows · {len(preview.columns)} columns")
            st.dataframe(preview, hide_index=True, height=260)

st.subheader("Process this source")
if selected["key"] == "future_factories":
    st.caption(f"Uses at most {max_rows:,} labeled rows sampled across the full timeline; unlabeled records are excluded.")
button_text = "Inspect route tables" if selected["key"] == "process_metadata" else "Process and train baseline"
if st.button(button_text, type="primary", icon=":material/play_arrow:", key=f"process_{selected['key']}"):
    with st.status(f"Processing {selected['name']}…", expanded=True) as status:
        try:
            if selected["key"] == "zema":
                from gaia.train_maintenance import train_maintenance
                result = train_maintenance(source, ROOT / "outputs" / "maintenance")
                status.write("Trained four separately labeled component models.")
            elif selected["key"] == "future_factories":
                from gaia.train_future_factories import train_future_factory_classifier
                result = train_future_factory_classifier(source, ROOT / "outputs" / "future_factories", max_rows=max_rows)
                status.write("Joined aligned channels, built time windows, and evaluated grouped time blocks.")
            elif selected["key"] == "hipe":
                from gaia.train_energy import train_energy_forecaster
                result = train_energy_forecaster(source, ROOT / "outputs" / "energy")
                status.write("Aggregated machine power and trained a chronological forecast.")
            elif selected["key"] == "smart_manufacturing":
                from gaia.train_monitoring import train_monitoring_model
                result = train_monitoring_model(source, ROOT / "outputs" / "monitoring")
                status.write("Aggregated event traces and trained an unlabeled screening baseline.")
            else:
                from gaia.process_metadata import load_process_metadata
                tables = load_process_metadata(source)
                result = {"tables": {name: {"rows": len(frame), "columns": list(frame.columns)} for name, frame in tables.items()},
                          "interpretation": "Static route/machine configuration; not model training data."}
                output = ROOT / "outputs" / "process_metadata"
                output.mkdir(parents=True, exist_ok=True)
                (output / "inventory.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
                status.write("Parsed machine, process, storage, and travel-time tables.")
            status.update(label="Processing complete", state="complete", expanded=False)
            st.session_state[f"result_{selected['key']}"] = result
            st.success("Results saved under the project outputs folder.")
        except Exception as error:
            status.update(label="Processing failed", state="error", expanded=True)
            st.exception(error)

result = st.session_state.get(f"result_{selected['key']}")
if result:
    st.subheader("Latest run")
    if selected["key"] == "future_factories":
        st.json({"dataset": result["dataset"], "split": result["split"], "validation": result["validation"], "test": {key: value for key, value in result["test"].items() if key != "classification_report"}})
    elif selected["key"] == "zema":
        st.json({"rows": result["rows"], "features": result["features"], "targets": {key: {"test_macro_f1": value["test_macro_f1"], "test_accuracy": value["test_accuracy"]} for key, value in result["targets"].items()}})
    else:
        st.json(result)
