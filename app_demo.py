"""Seller / Store Owner Review Monitoring Demo.

Thin Streamlit client for the VOC monitoring backend.
All business logic lives in the FastAPI backend.

Run: streamlit run app_demo.py
Requires the backend running at the configured API base URL.
"""

import time

import httpx
import streamlit as st

st.set_page_config(page_title="리뷰 모니터링", layout="wide")

# =====================================================================
# Sidebar — entity management + settings
# =====================================================================

st.sidebar.title("모니터링 대상")

with st.sidebar.expander("API 설정", expanded=False):
    API_BASE_URL = st.text_input("API Base URL", value="http://localhost:8000", key="api_url")


def _api(method: str, path: str, **kwargs):
    """Thin wrapper for backend HTTP calls."""
    url = f"{API_BASE_URL}{path}"
    kwargs.setdefault("timeout", 120)
    r = httpx.request(method, url, **kwargs)
    return r


# --- Load entities ---
try:
    entities_resp = _api("GET", "/v1/entities")
    entities = entities_resp.json().get("entities", []) if entities_resp.status_code == 200 else []
except Exception:
    entities = []

entity_names = {e["entity_id"]: e["display_name"] for e in entities}
entity_options = list(entity_names.keys())

selected_entity_id = st.sidebar.selectbox(
    "모니터링 대상 선택",
    options=entity_options,
    format_func=lambda eid: f"{entity_names[eid]} ({eid})",
    index=0 if entity_options else None,
    key="entity_select",
) if entity_options else None

# --- Register new entity ---
st.sidebar.markdown("---")
with st.sidebar.expander("새 모니터링 대상 등록"):
    reg_name = st.text_input("이름 (예: 에어팟 프로)", key="reg_name")
    reg_type = st.selectbox("유형", ["product", "store", "business"], key="reg_type")
    reg_keywords = st.text_input("검색 키워드 (쉼표 구분)", key="reg_keywords")
    reg_desc = st.text_input("설명 (선택)", key="reg_desc")
    reg_entity_id = st.text_input("ID (선택, 비워두면 자동 생성)", key="reg_id")

    if st.button("등록", key="btn_register"):
        keywords = [k.strip() for k in reg_keywords.split(",") if k.strip()]
        if not reg_name or not keywords:
            st.warning("이름과 키워드를 입력해주세요.")
        else:
            body = {
                "display_name": reg_name,
                "entity_type": reg_type,
                "product_keywords": keywords,
                "description": reg_desc,
            }
            if reg_entity_id.strip():
                body["entity_id"] = reg_entity_id.strip()
            try:
                resp = _api("POST", "/v1/entities", json=body)
                if resp.status_code == 201:
                    st.success(f"등록 완료: {resp.json()['entity_id']}")
                    st.rerun()
                elif resp.status_code == 409:
                    st.warning("이미 존재하는 ID입니다.")
                else:
                    st.error(f"등록 실패: {resp.text}")
            except Exception as e:
                st.error(f"요청 실패: {e}")

# =====================================================================
# Main page — monitoring dashboard
# =====================================================================

st.title("리뷰 모니터링")

if not selected_entity_id:
    st.info("왼쪽 사이드바에서 모니터링 대상을 등록하거나 선택해주세요.")
    st.stop()

# --- Fetch entity details ---
try:
    entity_resp = _api("GET", f"/v1/entities/{selected_entity_id}")
    entity = entity_resp.json() if entity_resp.status_code == 200 else None
except Exception:
    entity = None

if entity is None:
    st.error("모니터링 대상 정보를 불러올 수 없습니다.")
    st.stop()

# =====================================================================
# Section 1: Entity header + refresh
# =====================================================================

st.header(entity["display_name"])

type_label = {"product": "제품", "store": "매장", "business": "비즈니스"}.get(
    entity.get("entity_type", "product"), "제품"
)
st.caption(
    f"{type_label} · "
    f"키워드: {', '.join(entity.get('product_keywords', []))} · "
    f"{entity.get('description', '') or '설명 없음'}"
)

col_refresh, col_meta = st.columns([1, 2])

with col_refresh:
    if st.button("리뷰 새로고침", key="btn_refresh", type="primary"):
        with st.spinner("리뷰를 수집하고 있습니다..."):
            try:
                resp = _api("POST", f"/v1/entities/{selected_entity_id}/refresh")
                dispatch_data = resp.json()
            except Exception as e:
                st.error(f"새로고침 실패: {e}")
                dispatch_data = None

            # Poll job until completion
            if dispatch_data and dispatch_data.get("status") == "accepted":
                job_id = dispatch_data["job_id"]
                job_data = None
                for _ in range(120):  # up to ~2 minutes
                    time.sleep(1)
                    try:
                        poll_resp = _api(
                            "GET",
                            f"/v1/entities/{selected_entity_id}/jobs/{job_id}",
                            timeout=10,
                        )
                        job_data = poll_resp.json()
                        if job_data.get("status") in ("completed", "partial", "failed"):
                            break
                    except Exception:
                        pass

                if job_data:
                    status = job_data.get("status", "unknown")
                    if status == "completed":
                        st.success(
                            f"수집 완료 — {job_data.get('total_collected', 0)}건 수집, "
                            f"{job_data.get('total_indexed', 0)}건 인덱싱"
                        )
                    elif status == "partial":
                        st.warning(f"일부 키워드 실패 — {job_data.get('errors', [])}")
                    else:
                        st.error(f"새로고침 실패: {job_data.get('errors', [])}")

                    st.caption("새로고침 후 아래 '모니터링 리포트 생성' 버튼을 다시 눌러야 최신 분석 결과가 반영됩니다.")

                    with st.expander("새로고침 상세 결과"):
                        st.json(job_data)
                else:
                    st.warning("새로고침이 아직 진행 중입니다. 잠시 후 다시 확인해주세요.")

            elif dispatch_data:
                st.error(f"새로고침 실패: {dispatch_data}")

            st.rerun()

with col_meta:
    last_refreshed = entity.get("last_refreshed_at")
    refresh_count = entity.get("refresh_count", 0)
    if last_refreshed:
        st.markdown(f"마지막 새로고침: **{last_refreshed[:19]}** UTC · 총 **{refresh_count}**회")
    else:
        st.markdown("아직 새로고침하지 않았습니다. 위 버튼을 눌러 리뷰를 수집하세요.")

st.markdown("---")

# =====================================================================
# Section 2–6: Monitoring report
# =====================================================================

if st.button("모니터링 리포트 생성", key="btn_monitoring", type="primary"):
    with st.spinner("리뷰를 분석하고 있습니다... (30초~1분 소요)"):
        try:
            resp = _api("GET", f"/v1/entities/{selected_entity_id}/monitoring")
            if resp.status_code == 200:
                st.session_state["dashboard"] = resp.json()
            else:
                st.error(f"리포트 생성 실패: {resp.text}")
        except Exception as e:
            st.error(f"요청 실패: {e}")

dashboard = st.session_state.get("dashboard")

if dashboard and dashboard.get("entity_id") == selected_entity_id:

    # --- Section 2: Quick metrics ---
    stats = dashboard.get("review_stats", {})
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("총 리뷰 수", stats.get("total_reviews", 0))
    m2.metric("평균 평점", f"{stats.get('avg_rating', '—')}")
    m3.metric("부정 리뷰", stats.get("negative_count", 0))
    m4.metric("부정 비율", f"{round(stats.get('low_rating_ratio', 0) * 100)}%")

    # --- Section 3: Monitoring summary ---
    st.markdown("### 현재 상황 요약")
    st.info(dashboard.get("monitoring_summary", ""))

    # --- Section 4: What to fix first ---
    action_items = dashboard.get("what_to_fix_first", [])
    if action_items:
        st.markdown("### 우선 대응 필요")
        for item in action_items:
            priority = item.get("priority", 3)
            badge = {1: "🔴 긴급", 2: "🟠 중요", 3: "🟡 보통"}.get(priority, "⚪")
            st.markdown(f"**{badge}** — {item.get('issue', '')}")
            if item.get("suggested_action"):
                st.caption(f"권장 조치: {item['suggested_action']}")
            with st.expander("근거 보기", expanded=False):
                st.caption(f"evidence: {', '.join(item.get('evidence_ids', []))}")

    # --- Section 5: Recurring issues ---
    recurring = dashboard.get("recurring_issues", [])
    if recurring:
        st.markdown("### 반복 이슈")
        for issue in recurring:
            freq_label = {"high": "빈번", "medium": "보통", "low": "낮음"}.get(
                issue.get("frequency", "low"), "—"
            )
            sentiment_icon = {"negative": "🔴", "mixed": "🟡"}.get(
                issue.get("sentiment", "mixed"), "⚪"
            )
            st.markdown(f"- {sentiment_icon} **{issue.get('issue', '')}** (빈도: {freq_label})")

    # --- Section 6: Reviews needing attention ---
    flagged = dashboard.get("reviews_needing_attention", [])
    if flagged:
        st.markdown("### 확인이 필요한 리뷰")
        for review in flagged:
            st.markdown(f"**{review.get('reason', '')}**")
            st.caption(f"「{review.get('review_text_snippet', '')}」")

    with st.expander("전체 리포트 데이터"):
        st.json(dashboard)

else:
    st.caption("위 버튼을 눌러 모니터링 리포트를 생성하세요.")

# =====================================================================
# Section 7: Deep dive (secondary, collapsed)
# =====================================================================

st.markdown("---")

with st.expander("상세 질문하기 (자유 질문)"):
    st.warning(
        "현재 자유 질문은 선택된 모니터링 대상에 한정되지 않고, "
        "인덱싱된 전체 리뷰를 대상으로 검색합니다. "
        "대상별 검색은 추후 업데이트 예정입니다."
    )
    question = st.text_input("질문", value="배터리 관련 불만사항은?", key="deep_q")
    top_k = st.slider("검색 범위", min_value=1, max_value=30, value=10, key="deep_k")

    if st.button("질문 실행", key="btn_deep"):
        with st.spinner("분석 중..."):
            try:
                resp = _api(
                    "POST", "/v1/query",
                    json={"question": question, "top_k": top_k},
                )
                data = resp.json()
            except Exception as e:
                st.error(f"요청 실패: {e}")
                st.stop()

        st.markdown(f"**상태:** {data.get('status')}")

        insight = data.get("insight")
        if insight:
            st.markdown(f"### {insight.get('summary', '')}")

            for t in insight.get("themes", []):
                icon = {"positive": "🟢", "negative": "🔴", "mixed": "🟡"}.get(
                    t.get("sentiment"), "⚪"
                )
                st.markdown(f"- {icon} **{t['label']}** — {t.get('description', '')}")

            for pp in insight.get("pain_points", []):
                badge = {"critical": "🔴", "major": "🟠", "minor": "🟡"}.get(
                    pp.get("severity"), "⚪"
                )
                st.markdown(f"- {badge} {pp.get('description', '')}")

            for rec in insight.get("recommendations", []):
                st.markdown(f"- {rec.get('action', '')} — _{rec.get('rationale', '')}_")

        elif data.get("message"):
            st.info(data["message"])

        with st.expander("전체 응답 데이터"):
            st.json(data)
