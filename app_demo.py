"""Thin Streamlit client for the VOC Intelligence API.

This is a presentation shell only. All logic lives in the FastAPI backend.
Run: streamlit run app_demo.py
Requires the backend running at the configured API_BASE_URL.
"""

import httpx
import streamlit as st

API_BASE_URL = st.sidebar.text_input("API Base URL", value="http://localhost:8000")

st.title("VOC Intelligence")
st.caption("Multi-channel Voice of Customer analysis — powered by FastAPI backend")

tab_ingest, tab_query, tab_lookup = st.tabs(["Ingest", "Query", "Run Lookup"])

# --- Ingest ---
with tab_ingest:
    st.subheader("Run Ingestion Pipeline")
    keyword = st.text_input("Product / Brand Keyword", value="에어팟 프로", key="ingest_kw")
    if st.button("Run Pipeline", key="btn_ingest"):
        with st.spinner("Running ingestion..."):
            try:
                r = httpx.post(
                    f"{API_BASE_URL}/v1/pipeline/run",
                    json={"keyword": keyword},
                    timeout=60,
                )
                data = r.json()
            except Exception as e:
                st.error(f"Request failed: {e}")
                st.stop()

        if data.get("overall_status") == "completed":
            st.success(f"Completed — run_id: `{data['run_id']}`")
        else:
            st.warning(f"Status: {data.get('overall_status', 'unknown')}")

        # Stage cards
        for stage in data.get("stages", []):
            icon = "✓" if stage["status"] == "ok" else "✗"
            st.markdown(
                f"**{icon} {stage['name']}** — "
                f"{stage['count']} items, {stage['duration_ms']}ms"
            )
            if stage.get("errors"):
                for err in stage["errors"]:
                    st.caption(f"  error: {err}")

        with st.expander("Raw response"):
            st.json(data)

# --- Query ---
with tab_query:
    st.subheader("Query VOC Insights")
    question = st.text_input("Question", value="배터리 관련 불만사항은?", key="query_q")
    top_k = st.slider("Top K", min_value=1, max_value=30, value=10, key="query_k")

    if st.button("Run Query", key="btn_query"):
        with st.spinner("Retrieving + generating..."):
            try:
                r = httpx.post(
                    f"{API_BASE_URL}/v1/query",
                    json={"question": question, "top_k": top_k},
                    timeout=120,
                )
                data = r.json()
            except Exception as e:
                st.error(f"Request failed: {e}")
                st.stop()

        st.markdown(f"**Status:** {data.get('status')} — `{data.get('run_id')}`")

        # Insight
        insight = data.get("insight")
        if insight:
            st.markdown("---")
            st.markdown(f"### {insight.get('summary', '')}")

            themes = insight.get("themes", [])
            if themes:
                st.markdown("**Themes**")
                for t in themes:
                    sentiment_color = {"positive": "🟢", "negative": "🔴", "mixed": "🟡"}.get(
                        t.get("sentiment"), "⚪"
                    )
                    st.markdown(
                        f"- {sentiment_color} **{t['label']}** — {t.get('description', '')}"
                    )

            pain_points = insight.get("pain_points", [])
            if pain_points:
                st.markdown("**Pain Points**")
                for pp in pain_points:
                    severity_badge = {"critical": "🔴", "major": "🟠", "minor": "🟡"}.get(
                        pp.get("severity"), "⚪"
                    )
                    st.markdown(f"- {severity_badge} {pp.get('description', '')}")

            recs = insight.get("recommendations", [])
            if recs:
                st.markdown("**Recommendations**")
                for rec in recs:
                    st.markdown(f"- {rec.get('action', '')} — _{rec.get('rationale', '')}_")

            caveats = insight.get("caveats", [])
            if caveats:
                st.markdown("**Caveats**")
                for c in caveats:
                    st.caption(f"⚠ {c}")
        elif data.get("message"):
            st.info(data["message"])

        # Retrieved evidence
        evidence = data.get("retrieved_evidence", [])
        if evidence:
            with st.expander(f"Retrieved Evidence ({len(evidence)} chunks)"):
                for chunk in evidence:
                    st.markdown(
                        f"**#{chunk['rank']}** (score: {chunk['score']}) — "
                        f"`{', '.join(chunk.get('evidence_ids', []))}`"
                    )
                    st.caption(chunk.get("text", ""))

        # Retrieval meta
        meta = data.get("retrieval_meta", {})
        if meta:
            cols = st.columns(3)
            cols[0].metric("Chunks Retrieved", meta.get("chunks_retrieved", "—"))
            cols[1].metric("Top Score", meta.get("top_score", "—"))
            cols[2].metric(
                "Generation ms",
                f"{meta.get('generation_ms', '—')}",
            )

        with st.expander("Raw response"):
            st.json(data)

# --- Run Lookup ---
with tab_lookup:
    st.subheader("Look Up a Run")
    run_id = st.text_input("Run ID", key="lookup_rid")

    if st.button("Look Up", key="btn_lookup"):
        if not run_id.strip():
            st.warning("Enter a run_id")
            st.stop()

        try:
            r = httpx.get(f"{API_BASE_URL}/v1/runs/{run_id.strip()}", timeout=10)
        except Exception as e:
            st.error(f"Request failed: {e}")
            st.stop()

        if r.status_code == 404:
            st.warning("Run not found")
        else:
            data = r.json()
            st.success(f"Found: `{data.get('run_id', run_id)}`")
            st.json(data)
