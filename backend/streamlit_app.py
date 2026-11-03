from pathlib import Path
import streamlit as st

st.set_page_config(
    page_title="Gaia research workbench",
    page_icon=":material/factory:",
    layout="wide",
    initial_sidebar_state="expanded",
)

pages = st.navigation([
    st.Page("app_pages/overview.py", title="Overview", icon=":material/dashboard:", default=True),
    st.Page("app_pages/datasets.py", title="Datasets", icon=":material/database:"),
    st.Page("app_pages/experiments.py", title="Experiments", icon=":material/query_stats:"),
])

with st.sidebar:
    st.markdown("### GAIA / LAB")
    st.caption("Collaborative industrial intelligence")
    st.space("small")
    st.caption(f"Workspace · {Path.cwd().name}")

pages.run()
