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
# Shared label constants
# =====================================================================

# Source connector type → short Korean label (used in results, history, preview)
SOURCE_TYPE_SHORT: dict[str, str] = {
    "csv": "CSV",
    "json_import": "JSON",
    "google_business": "GBP",
    "mock": "Mock",
}

# Source connector type → full Korean label (used in source management list)
SOURCE_TYPE_FULL: dict[str, str] = {
    "csv": "CSV 업로드",
    "json_import": "JSON 업로드",
    "google_business": "Google Business (API)",
    "mock": "Mock (개발용)",
}

# Source connection status → Korean
SOURCE_STATUS_KO: dict[str, str] = {
    "active": "활성",
    "inactive": "비활성",
    "error": "오류",
}

# Job / refresh result status → Korean
JOB_STATUS_KO: dict[str, str] = {
    "completed": "완료",
    "partial": "부분 성공",
    "failed": "실패",
    "running": "실행 중",
    "pending": "대기 중",
}

# Sync mode → Korean
SYNC_MODE_KO: dict[str, str] = {
    "manual": "수동",
    "api": "API",
    "auto": "자동",
}

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
_backend_ok = True
try:
    entities_resp = _api("GET", "/v1/entities", timeout=5)
    entities = entities_resp.json().get("entities", []) if entities_resp.status_code == 200 else []
except Exception:
    entities = []
    _backend_ok = False

entity_names = {e["entity_id"]: e["display_name"] for e in entities}
entity_options = list(entity_names.keys())


def _entity_status_hint(eid: str) -> str:
    """Derive a short status hint from the already-loaded entity data."""
    ent = next((e for e in entities if e["entity_id"] == eid), None)
    if ent is None:
        return ""
    if ent.get("refresh_count", 0) == 0 and not ent.get("last_refreshed_at"):
        if ent.get("connector", "mock") == "mock":
            return " [설정 필요]"
        return " [새로고침 필요]"
    return ""


selected_entity_id = st.sidebar.selectbox(
    "모니터링 대상 선택",
    options=entity_options,
    format_func=lambda eid: f"{entity_names[eid]}{_entity_status_hint(eid)}",
    index=0 if entity_options else None,
    key="entity_select",
) if entity_options else None

# --- Entity overview ---
if len(entities) > 1:
    with st.sidebar.expander("대상 현황", expanded=False):
        for _ent in entities:
            _eid = _ent["entity_id"]
            _ename = _ent["display_name"]
            _last = _ent.get("last_refreshed_at")
            _rcount = _ent.get("refresh_count", 0)
            _conn = _ent.get("connector", "mock")

            # Status determination
            if _rcount == 0 and not _last:
                if _conn == "mock":
                    _tag = "설정 필요"
                else:
                    _tag = "새로고침 필요"
            elif _last:
                _tag = f"최근: {_last[:10]}"
            else:
                _tag = f"새로고침 {_rcount}회"

            _selected_mark = "▸ " if _eid == selected_entity_id else "  "
            st.caption(f"{_selected_mark}**{_ename}** — {_tag}")

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

if not _backend_ok:
    st.error(
        f"백엔드 서버에 연결할 수 없습니다 ({API_BASE_URL}). "
        f"서버가 실행 중인지 확인하세요: `python -m src.voc.api`"
    )
    st.stop()

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

# --- Source readiness pre-check (lightweight, no network from backend) ---
_USABLE_READINESS = {"ready", "manual_ready"}

try:
    _src_resp = _api("GET", f"/v1/entities/{selected_entity_id}/sources")
    _sources_for_check = _src_resp.json() if _src_resp.status_code == 200 else []
except Exception:
    _sources_for_check = []

_readiness_counts: dict[str, int] = {}
_source_validations: list[tuple[dict, str]] = []  # (source_dict, readiness)
for _src in _sources_for_check:
    try:
        _v = _api(
            "POST",
            f"/v1/entities/{selected_entity_id}/sources/{_src['connection_id']}/validate",
            timeout=10,
        )
        _r = _v.json().get("readiness", "unknown") if _v.status_code == 200 else "unknown"
    except Exception:
        _r = "unknown"
    _readiness_counts[_r] = _readiness_counts.get(_r, 0) + 1
    _source_validations.append((_src, _r))

_usable_count = sum(_readiness_counts.get(r, 0) for r in _USABLE_READINESS)
_total_sources = len(_sources_for_check)
_unusable_count = _total_sources - _usable_count
_has_usable = _usable_count > 0
_legacy_connector = entity.get("connector", "mock")

# --- Source readiness summary ---
if _total_sources == 0 and _legacy_connector == "mock":
    st.warning(
        "등록된 소스가 없습니다. 현재 새로고침하면 개발용 Mock 데이터만 사용됩니다. "
        "아래 '소스 연결 관리'에서 CSV/JSON 파일을 업로드하세요."
    )
elif _total_sources == 0:
    st.info(
        f"등록된 소스 연결이 없습니다. "
        f"레거시 커넥터 ({_legacy_connector})로 새로고침됩니다."
    )
elif _has_usable and _unusable_count > 0:
    st.info(
        f"사용 가능한 소스 **{_usable_count}개** / "
        f"설정 미완료 {_unusable_count}개"
    )
elif _has_usable:
    st.success(f"사용 가능한 소스 **{_usable_count}개** — 새로고침 준비 완료")
else:
    # Sources exist but none are usable
    _detail_parts = []
    for _k, _v_count in sorted(_readiness_counts.items()):
        _label = {
            "config_incomplete": "설정 미완료",
            "auth_missing": "인증 없음",
            "file_missing": "파일 없음",
            "not_implemented": "검증 미구현",
        }.get(_k, _k)
        _detail_parts.append(f"{_label} {_v_count}개")
    st.warning(
        f"현재 새로고침 가능한 소스가 없습니다 ({', '.join(_detail_parts)}). "
        f"아래 '소스 연결 관리'에서 업로드 또는 설정을 먼저 완료하세요."
    )

# --- Operator action recommendations ---
_actions: list[str] = []

# Fetch recent jobs for failure pattern detection
try:
    _hist_resp = _api("GET", f"/v1/entities/{selected_entity_id}/jobs?limit=5")
    _recent_jobs = _hist_resp.json() if _hist_resp.status_code == 200 else []
except Exception:
    _recent_jobs = []

# P1: No sources, mock fallback
if _total_sources == 0 and _legacy_connector == "mock":
    _actions.append(
        "아래 '소스 연결 관리'에서 CSV/JSON 파일을 업로드하세요."
    )

# P2: Sources exist but none usable
elif _total_sources > 0 and not _has_usable:
    _actions.append(
        "등록된 소스가 모두 사용 불가 상태입니다. "
        "아래 '소스 연결 관리'에서 상태를 확인하고 설정을 완료하세요."
    )

else:
    # P3: auth_missing on specific source(s)
    for _sv_src, _sv_r in _source_validations:
        if _sv_r == "auth_missing":
            _actions.append(
                f"'{_sv_src.get('display_name', '')}' 소스에 인증 정보가 없습니다. "
                f"토큰 또는 자격 증명을 설정하세요."
            )
            break  # one is enough

    # P4: file_missing on specific source(s)
    for _sv_src, _sv_r in _source_validations:
        if _sv_r == "file_missing":
            _actions.append(
                f"'{_sv_src.get('display_name', '')}' 소스의 파일이 없습니다. "
                f"파일을 다시 업로드하세요."
            )
            break

    # P5: Repeated source failure from recent jobs
    _fail_counts: dict[str, int] = {}
    for _rj in _recent_jobs:
        if _rj.get("status") not in ("completed", "partial", "failed"):
            continue
        for _rss in _rj.get("metadata", {}).get("source_summary", []):
            if _rss.get("status") == "failed":
                _fname = _rss.get("display_name", _rss.get("connector_type", "?"))
                _fail_counts[_fname] = _fail_counts.get(_fname, 0) + 1
    for _fname, _fcount in _fail_counts.items():
        if _fcount >= 2:
            _actions.append(
                f"'{_fname}' 소스가 최근 {_fcount}회 실패했습니다. "
                f"소스를 검증하거나 비활성화하세요."
            )
            break

    # P6: Usable sources exist, never refreshed
    if _has_usable and not entity.get("last_refreshed_at"):
        _actions.append(
            "사용 가능한 소스가 준비되어 있습니다. 첫 새로고침을 실행하세요."
        )

if _actions:
    st.markdown("**권장 조치:**")
    for _a in _actions[:3]:
        st.info(f"→ {_a}")

# --- Pre-refresh execution preview ---
if _total_sources > 0:
    _will_run = [
        (s, r) for s, r in _source_validations if s.get("status") == "active"
    ]
    _will_skip = [
        (s, r) for s, r in _source_validations if s.get("status") != "active"
    ]
    _run_parts = []
    for _ws, _wr in _will_run:
        _run_parts.append(SOURCE_TYPE_SHORT.get(_ws.get("connector_type", ""), "?"))
    _skip_parts = []
    for _ws, _wr in _will_skip:
        _wt = SOURCE_TYPE_SHORT.get(_ws.get("connector_type", ""), "?")
        _skip_parts.append(f"{_wt}({_ws.get('display_name', '')[:15]})")

    preview = f"실행 예상: {', '.join(_run_parts) if _run_parts else '없음'}"
    if _skip_parts:
        preview += f" / 제외: {', '.join(_skip_parts)}"
    st.caption(preview)

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
                        st.warning("일부 소스/키워드 실패 — 상세 결과를 확인하세요.")
                    else:
                        st.error(f"새로고침 실패: {job_data.get('errors', [])}")

                    # Source-level summary
                    job_meta = job_data.get("metadata", {})
                    ingest_mode = job_meta.get("ingest_mode")
                    source_summary = job_meta.get("source_summary", [])

                    if ingest_mode == "legacy_fallback":
                        st.caption(
                            "소스 연결 없이 레거시 커넥터로 새로고침되었습니다."
                        )

                    if source_summary:
                        st.markdown("**소스별 결과:**")
                        for ss in source_summary:
                            ss_type = SOURCE_TYPE_SHORT.get(
                                ss.get("connector_type", ""), ss.get("connector_type", ""),
                            )
                            ss_status = ss.get("status", "unknown")
                            ss_status_ko = JOB_STATUS_KO.get(ss_status, ss_status)
                            ss_icon = {
                                "completed": "+",
                                "partial": "!",
                                "failed": "-",
                            }.get(ss_status, "?")

                            # Main result line
                            line = (
                                f"  [{ss_icon}] {ss_type} — {ss.get('display_name', '')} · "
                                f"수집 {ss.get('collected', 0)}건 · "
                                f"인덱싱 {ss.get('indexed', 0)}건 · "
                                f"{ss_status_ko}"
                            )
                            error_summary = ss.get("error_summary", "")
                            if error_summary and ss_status != "completed":
                                line += f" · {error_summary}"
                            st.caption(line)

                            # Per-source errors (only for failed/partial)
                            ss_errors = ss.get("errors", [])
                            if ss_errors and ss_status != "completed":
                                for err in ss_errors:
                                    err_display = err if len(err) <= 150 else err[:147] + "..."
                                    st.caption(f"    ⚠ {err_display}")

                    # Skipped sources
                    skipped_sources = job_meta.get("skipped_sources", [])
                    if skipped_sources:
                        for sk in skipped_sources:
                            sk_type = SOURCE_TYPE_SHORT.get(
                                sk.get("connector_type", ""), sk.get("connector_type", ""),
                            )
                            sk_reason = sk.get("reason", "")
                            if "inactive" in sk_reason:
                                sk_reason_ko = "비활성"
                            else:
                                sk_reason_ko = sk_reason or "비활성"
                            st.caption(
                                f"  [—] {sk_type} — {sk.get('display_name', '')} · "
                                f"제외 ({sk_reason_ko})"
                            )

                    st.caption("새로고침 후 아래 '모니터링 리포트 생성' 버튼을 다시 눌러야 최신 분석 결과가 반영됩니다.")

                    with st.expander("새로고침 상세 결과"):
                        st.json(job_data)
                else:
                    st.warning("새로고침이 아직 진행 중입니다. 잠시 후 다시 확인해주세요.")

            elif dispatch_data:
                st.error(f"새로고침 실패: {dispatch_data}")

with col_meta:
    last_refreshed = entity.get("last_refreshed_at")
    refresh_count = entity.get("refresh_count", 0)
    if last_refreshed:
        st.markdown(f"마지막 새로고침: **{last_refreshed[:19]}** UTC · 총 **{refresh_count}**회")
    else:
        st.markdown("아직 새로고침하지 않았습니다. 위 버튼을 눌러 리뷰를 수집하세요.")

# =====================================================================
# Source connections
# =====================================================================

with st.expander("소스 연결 관리", expanded=False):
    # Fetch source connections for this entity
    try:
        sources_resp = _api("GET", f"/v1/entities/{selected_entity_id}/sources")
        sources = sources_resp.json() if sources_resp.status_code == 200 else []
    except Exception:
        sources = []

    if not sources:
        st.caption("등록된 소스가 없습니다. 아래에서 파일을 업로드하거나 소스를 등록하세요.")
    else:
        for src in sources:
            conn_id = src["connection_id"]
            conn_type = src.get("connector_type", "unknown")
            display = src.get("display_name", conn_id)

            type_badge = SOURCE_TYPE_FULL.get(conn_type, conn_type)

            status = src.get("status", "unknown")
            status_label = SOURCE_STATUS_KO.get(status, status)

            with st.container():
                st.markdown(f"**{type_badge}** [{status_label}] — {display}")

                # Show file info for upload-based sources
                config = src.get("config", {})
                if conn_type in ("csv", "json_import") and config.get("filename"):
                    detail_parts = [f"파일: {config['filename']}"]
                    if config.get("row_count"):
                        detail_parts.append(f"{config['row_count']}행")
                    if config.get("review_count"):
                        detail_parts.append(f"{config['review_count']}건")
                    st.caption(" · ".join(detail_parts))

                # Show GBP config summary (no token value)
                if conn_type == "google_business":
                    gbp_parts = []
                    if config.get("account_id"):
                        gbp_parts.append(f"account: {config['account_id']}")
                    if config.get("location_id"):
                        gbp_parts.append(f"location: {config['location_id']}")
                    gbp_parts.append(
                        "token: 설정됨" if config.get("access_token") else "token: 없음"
                    )
                    st.caption(" · ".join(gbp_parts))

                last_synced = src.get("last_synced_at")
                if last_synced:
                    st.caption(f"마지막 동기화: {last_synced[:19]} UTC")

                # Action buttons row
                btn_cols = st.columns([1, 1, 1])

                with btn_cols[0]:
                    if st.button("상태 확인", key=f"validate_{conn_id}"):
                        try:
                            v_resp = _api(
                                "POST",
                                f"/v1/entities/{selected_entity_id}/sources/{conn_id}/validate",
                            )
                            if v_resp.status_code == 200:
                                st.session_state[f"validation_{conn_id}"] = v_resp.json()
                            else:
                                st.error(f"상태 확인 실패: {v_resp.text}")
                        except Exception as e:
                            st.error(f"요청 실패: {e}")

                with btn_cols[1]:
                    toggle_label = "비활성화" if status == "active" else "활성화"
                    new_status = "inactive" if status == "active" else "active"
                    if st.button(toggle_label, key=f"toggle_{conn_id}"):
                        try:
                            t_resp = _api(
                                "PATCH",
                                f"/v1/entities/{selected_entity_id}/sources/{conn_id}",
                                json={"status": new_status},
                            )
                            if t_resp.status_code == 200:
                                st.rerun()
                            else:
                                st.error(f"변경 실패: {t_resp.text}")
                        except Exception as e:
                            st.error(f"요청 실패: {e}")

                with btn_cols[2]:
                    if st.button("삭제", key=f"delete_{conn_id}"):
                        st.session_state[f"confirm_delete_{conn_id}"] = True

                # Delete confirmation
                if st.session_state.get(f"confirm_delete_{conn_id}"):
                    st.warning(f"'{display}' 소스를 삭제하시겠습니까?")
                    confirm_cols = st.columns([1, 1, 3])
                    with confirm_cols[0]:
                        if st.button("확인", key=f"confirm_yes_{conn_id}"):
                            try:
                                d_resp = _api(
                                    "DELETE",
                                    f"/v1/entities/{selected_entity_id}/sources/{conn_id}",
                                )
                                if d_resp.status_code == 204:
                                    st.session_state.pop(f"confirm_delete_{conn_id}", None)
                                    st.session_state.pop(f"validation_{conn_id}", None)
                                    st.rerun()
                                else:
                                    st.error(f"삭제 실패: {d_resp.text}")
                            except Exception as e:
                                st.error(f"요청 실패: {e}")
                    with confirm_cols[1]:
                        if st.button("취소", key=f"confirm_no_{conn_id}"):
                            st.session_state.pop(f"confirm_delete_{conn_id}", None)
                            st.rerun()

                # Show cached validation result
                vdata = st.session_state.get(f"validation_{conn_id}")
                if vdata:
                    readiness = vdata.get("readiness", "unknown")
                    readiness_label = {
                        "ready": "준비 완료",
                        "manual_ready": "수동 소스 — 준비됨",
                        "config_incomplete": "설정 미완료",
                        "auth_missing": "인증 정보 없음",
                        "file_missing": "파일 없음",
                        "not_implemented": "검증 미구현 (스파이크)",
                    }.get(readiness, readiness)

                    readiness_color = {
                        "ready": "green",
                        "manual_ready": "blue",
                        "config_incomplete": "orange",
                        "auth_missing": "red",
                        "file_missing": "red",
                        "not_implemented": "gray",
                    }.get(readiness, "gray")

                    _sync_ko = SYNC_MODE_KO.get(vdata.get("sync_mode", ""), vdata.get("sync_mode", "?"))
                    st.markdown(
                        f"상태: :{readiness_color}[**{readiness_label}**] "
                        f"(동기화: {_sync_ko})"
                    )

                    # Checks
                    checks = vdata.get("checks", [])
                    if checks:
                        for check in checks:
                            icon = "+" if check.get("passed") else "-"
                            detail = f" — {check['detail']}" if check.get("detail") else ""
                            st.caption(f"  [{icon}] {check['name']}{detail}")

                    # Warnings
                    for w in vdata.get("warnings", []):
                        st.caption(f"  [!] {w}")

                    # Next steps
                    next_steps = vdata.get("next_steps", [])
                    if next_steps:
                        st.markdown("**다음 단계:**")
                        for step in next_steps:
                            st.caption(f"  → {step}")

                st.markdown("---")

    # --- File upload ---
    st.markdown("**파일 업로드**")
    upload_type = st.radio(
        "파일 형식",
        ["CSV", "JSON"],
        horizontal=True,
        key="upload_type",
    )
    expected_ext = ".csv" if upload_type == "CSV" else ".json"
    uploaded_file = st.file_uploader(
        f"{upload_type} 파일 선택",
        type=[expected_ext.lstrip(".")],
        key="file_uploader",
    )

    if uploaded_file is not None:
        if st.button("업로드", key="btn_upload"):
            upload_path = (
                f"/v1/entities/{selected_entity_id}/upload"
                if upload_type == "CSV"
                else f"/v1/entities/{selected_entity_id}/upload/json"
            )
            try:
                resp = _api(
                    "POST",
                    upload_path,
                    files={"file": (uploaded_file.name, uploaded_file.getvalue())},
                )
                if resp.status_code == 200:
                    result = resp.json()
                    count_key = "row_count" if upload_type == "CSV" else "review_count"
                    st.success(
                        f"업로드 완료: {result.get('filename')} "
                        f"({result.get(count_key, '?')}건)"
                    )
                    st.rerun()
                else:
                    st.error(f"업로드 실패: {resp.text}")
            except Exception as e:
                st.error(f"요청 실패: {e}")

    # --- Google Business Profile source creation ---
    st.markdown("---")
    st.markdown("**Google Business Profile 소스 등록**")
    st.caption(
        "GBP 커넥터는 스파이크/실험 단계입니다. "
        "access_token은 수동으로 발급받아야 하며 약 1시간 후 만료됩니다. "
        "OAuth Playground 또는 CLI를 통해 토큰을 발급받으세요."
    )
    gbp_name = st.text_input(
        "소스 이름", value="Google Business Profile", key="gbp_name",
    )
    gbp_account = st.text_input(
        "Account ID (예: accounts/123456789)", key="gbp_account",
    )
    gbp_location = st.text_input(
        "Location ID (예: locations/987654321)", key="gbp_location",
    )
    gbp_token = st.text_input(
        "Access Token", type="password", key="gbp_token",
    )

    if st.button("GBP 소스 등록", key="btn_gbp_create"):
        if not gbp_name.strip():
            st.warning("소스 이름을 입력하세요.")
        else:
            gbp_config = {}
            if gbp_account.strip():
                gbp_config["account_id"] = gbp_account.strip()
            if gbp_location.strip():
                gbp_config["location_id"] = gbp_location.strip()
            if gbp_token.strip():
                gbp_config["access_token"] = gbp_token.strip()
            try:
                resp = _api(
                    "POST",
                    f"/v1/entities/{selected_entity_id}/sources",
                    json={
                        "connector_type": "google_business",
                        "display_name": gbp_name.strip(),
                        "config": gbp_config,
                        "capabilities": {
                            "sync_mode": "api",
                            "requires_auth": True,
                            "supports_incremental": False,
                            "operator_assisted": True,
                        },
                    },
                )
                if resp.status_code == 201:
                    st.success(f"GBP 소스 등록 완료: {resp.json().get('connection_id')}")
                    st.rerun()
                else:
                    st.error(f"등록 실패: {resp.text}")
            except Exception as e:
                st.error(f"요청 실패: {e}")

st.markdown("---")

# =====================================================================
# Monitoring report
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

    # --- Fetch previous snapshot for delta computation ---
    _prev_snap = None
    try:
        _snap_resp = _api(
            "GET", f"/v1/entities/{selected_entity_id}/snapshots?limit=2"
        )
        _recent_snaps = _snap_resp.json() if _snap_resp.status_code == 200 else []
        if len(_recent_snaps) >= 2:
            _prev_snap = _recent_snaps[1]  # index 0 is latest, 1 is previous
    except Exception:
        pass

    # --- Section 2: Quick metrics with deltas ---
    stats = dashboard.get("review_stats", {})
    m1, m2, m3, m4 = st.columns(4)

    _cur_total = stats.get("total_reviews", 0)
    _cur_avg = stats.get("avg_rating")
    _cur_neg = stats.get("negative_count", 0)
    _cur_ratio = stats.get("low_rating_ratio", 0)

    if _prev_snap:
        _d_total = _cur_total - (_prev_snap.get("total_reviews") or 0)
        _p_avg = _prev_snap.get("avg_rating")
        _d_avg = round(_cur_avg - _p_avg, 2) if _cur_avg is not None and _p_avg is not None else None
        _d_neg = _cur_neg - (_prev_snap.get("negative_count") or 0)
        _p_ratio = _prev_snap.get("low_rating_ratio") or 0
        _d_ratio_pp = round((_cur_ratio - _p_ratio) * 100)

        m1.metric("총 리뷰 수", _cur_total, delta=f"{_d_total:+d}건" if _d_total != 0 else None)
        m2.metric(
            "평균 평점",
            f"{_cur_avg}" if _cur_avg is not None else "—",
            delta=f"{_d_avg:+.2f}" if _d_avg and _d_avg != 0 else None,
        )
        m3.metric(
            "부정 리뷰", _cur_neg,
            delta=f"{_d_neg:+d}건" if _d_neg != 0 else None,
            delta_color="inverse",
        )
        m4.metric(
            "부정 비율", f"{round(_cur_ratio * 100)}%",
            delta=f"{_d_ratio_pp:+d}%p" if _d_ratio_pp != 0 else None,
            delta_color="inverse",
        )
    else:
        m1.metric("총 리뷰 수", _cur_total)
        m2.metric("평균 평점", f"{_cur_avg}" if _cur_avg is not None else "—")
        m3.metric("부정 리뷰", _cur_neg)
        m4.metric("부정 비율", f"{round(_cur_ratio * 100)}%")

    # --- Section 3: Top customer issue callout ---
    action_items = dashboard.get("what_to_fix_first", [])
    _top_item = action_items[0] if action_items else None
    if _top_item and _top_item.get("priority", 3) <= 2:
        _top_urgency = _top_item.get("why_urgent", "")
        _top_action = _top_item.get("suggested_action", "")
        _callout = f"**고객 관점 최우선 이슈:** {_top_item.get('issue', '')}"
        if _top_urgency:
            _callout += f"\n\n{_top_urgency}"
        if _top_action:
            _callout += f"\n\n→ 권장 조치: {_top_action}"
        if _top_item.get("priority") == 1:
            st.error(_callout)
        else:
            st.warning(_callout)

    # --- Section 4: Monitoring summary ---
    st.markdown("### 현재 상황 요약")
    st.info(dashboard.get("monitoring_summary", ""))

    # --- Section 5: What to fix first (customer/review issues) ---
    if action_items:
        st.markdown("### 고객/리뷰 — 우선 대응 필요")
        for item in action_items:
            priority = item.get("priority", 3)
            badge = {1: "🔴 긴급", 2: "🟠 중요", 3: "🟡 보통"}.get(priority, "⚪")
            st.markdown(f"**{badge}** — {item.get('issue', '')}")
            why = item.get("why_urgent", "")
            if why:
                st.caption(f"이유: {why}")
            if item.get("suggested_action"):
                st.caption(f"권장 조치: {item['suggested_action']}")
            with st.expander("근거 보기", expanded=False):
                st.caption(f"evidence: {', '.join(item.get('evidence_ids', []))}")

    # --- Section 6: Recurring issues ---
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

    # --- Section 7: Reviews needing attention ---
    flagged = dashboard.get("reviews_needing_attention", [])
    if flagged:
        st.markdown("### 확인이 필요한 리뷰")
        for review in flagged:
            rating = review.get("rating")
            if rating is not None:
                rating_badge = f"[{rating:.0f}점]" if rating == int(rating) else f"[{rating}점]"
            else:
                rating_badge = "[평점 없음]"
            st.markdown(f"{rating_badge} **{review.get('reason', '')}**")
            st.caption(f"「{review.get('review_text_snippet', '')}」")

    with st.expander("전체 리포트 데이터"):
        st.json(dashboard)

else:
    st.caption("위 버튼을 눌러 모니터링 리포트를 생성하세요.")

# =====================================================================
# Refresh history
# =====================================================================

with st.expander("최근 새로고침 이력", expanded=False):
    try:
        jobs_resp = _api(
            "GET", f"/v1/entities/{selected_entity_id}/jobs?limit=5"
        )
        jobs = jobs_resp.json() if jobs_resp.status_code == 200 else []
    except Exception:
        jobs = []

    if not jobs:
        st.caption("새로고침 이력이 없습니다.")
    else:
        # Job-to-job delta for the latest two completed jobs
        _completed_jobs = [j for j in jobs if j.get("status") in ("completed", "partial")]
        if len(_completed_jobs) >= 2:
            _j_cur = _completed_jobs[0]
            _j_prev = _completed_jobs[1]
            _dj_collected = _j_cur.get("total_collected", 0) - _j_prev.get("total_collected", 0)
            _dj_indexed = _j_cur.get("total_indexed", 0) - _j_prev.get("total_indexed", 0)
            delta_parts = []
            if _dj_collected != 0:
                delta_parts.append(f"수집 {_dj_collected:+d}건")
            if _dj_indexed != 0:
                delta_parts.append(f"인덱싱 {_dj_indexed:+d}건")
            if delta_parts:
                st.caption(f"직전 대비: {', '.join(delta_parts)}")
            else:
                st.caption("직전 대비: 변동 없음")

        # Repeated source failure detection
        _src_fail_counts: dict[str, int] = {}
        for _jj in _completed_jobs[:5]:
            for _ss in _jj.get("metadata", {}).get("source_summary", []):
                if _ss.get("status") == "failed":
                    _key = _ss.get("display_name", _ss.get("connector_type", "?"))
                    _src_fail_counts[_key] = _src_fail_counts.get(_key, 0) + 1
        _repeated = {k: v for k, v in _src_fail_counts.items() if v >= 2}
        if _repeated:
            for _name, _count in _repeated.items():
                st.caption(f"    ⚠ {_name}: 최근 {_count}회 연속 실패")

        st.markdown("---")

        for job in jobs:
            j_status = job.get("status", "unknown")
            j_status_ko = JOB_STATUS_KO.get(j_status, j_status)
            j_icon = {
                "completed": "+", "partial": "!", "failed": "-",
                "running": "~", "pending": ".",
            }.get(j_status, "?")
            j_time = job.get("started_at", "")[:19]
            j_collected = job.get("total_collected", 0)
            j_indexed = job.get("total_indexed", 0)

            j_meta = job.get("metadata", {})
            j_mode = j_meta.get("ingest_mode", "")
            mode_label = {
                "source_connections": "소스",
                "legacy_fallback": "레거시",
            }.get(j_mode, "")

            st.caption(
                f"[{j_icon}] {j_time} · {j_status_ko} · "
                f"수집 {j_collected} · 인덱싱 {j_indexed}"
                + (f" · {mode_label}" if mode_label else "")
            )

            # Compact source summary from metadata
            src_summary = j_meta.get("source_summary", [])
            if src_summary:
                for ss in src_summary:
                    ss_type = SOURCE_TYPE_SHORT.get(
                        ss.get("connector_type", ""), ss.get("connector_type", ""),
                    )
                    ss_status = ss.get("status", "")
                    ss_status_ko = JOB_STATUS_KO.get(ss_status, ss_status)
                    ss_err = ss.get("error_summary", "")
                    line = f"    {ss_type}: {ss.get('collected', 0)}건 · {ss_status_ko}"
                    if ss_err and ss_status != "completed":
                        line += f" · {ss_err}"
                    st.caption(line)
            j_skipped = j_meta.get("skipped_sources", [])
            if j_skipped:
                for sk in j_skipped:
                    sk_type = SOURCE_TYPE_SHORT.get(
                        sk.get("connector_type", ""), sk.get("connector_type", ""),
                    )
                    sk_reason = sk.get("reason", "")
                    if "inactive" in sk_reason:
                        sk_reason_ko = "비활성"
                    else:
                        sk_reason_ko = sk_reason or "비활성"
                    st.caption(f"    {sk_type}: 제외 ({sk_reason_ko})")

# =====================================================================
# Snapshot history
# =====================================================================

with st.expander("스냅샷 이력", expanded=False):
    try:
        snaps_resp = _api(
            "GET", f"/v1/entities/{selected_entity_id}/snapshots?limit=5"
        )
        snaps = snaps_resp.json() if snaps_resp.status_code == 200 else []
    except Exception:
        snaps = []

    if not snaps:
        st.caption("스냅샷 이력이 없습니다.")
    else:
        # Snapshot-to-snapshot delta summary at top
        if len(snaps) >= 2:
            _s_cur = snaps[0]
            _s_prev = snaps[1]
            _ds_parts = []

            _ds_total = (_s_cur.get("total_reviews") or 0) - (_s_prev.get("total_reviews") or 0)
            if _ds_total != 0:
                _ds_parts.append(f"리뷰 {_ds_total:+d}건")

            _ds_avg_c = _s_cur.get("avg_rating")
            _ds_avg_p = _s_prev.get("avg_rating")
            if _ds_avg_c is not None and _ds_avg_p is not None:
                _ds_avg = round(_ds_avg_c - _ds_avg_p, 2)
                if _ds_avg != 0:
                    _ds_parts.append(f"평균 {_ds_avg:+.2f}")

            _ds_neg = (_s_cur.get("negative_count") or 0) - (_s_prev.get("negative_count") or 0)
            if _ds_neg != 0:
                _ds_parts.append(f"부정 {_ds_neg:+d}건")

            _ds_ratio = round(
                ((_s_cur.get("low_rating_ratio") or 0) - (_s_prev.get("low_rating_ratio") or 0)) * 100
            )
            if _ds_ratio != 0:
                _ds_parts.append(f"부정률 {_ds_ratio:+d}%p")

            if _ds_parts:
                st.caption(f"최근 변화: {', '.join(_ds_parts)}")
            else:
                st.caption("최근 변화: 변동 없음")
            st.markdown("---")

        for snap in snaps:
            s_time = snap.get("captured_at", "")[:19]
            s_total = snap.get("total_reviews")
            s_avg = snap.get("avg_rating")
            s_neg = snap.get("negative_count")
            s_ratio = snap.get("low_rating_ratio")

            parts = [s_time]
            if s_total is not None:
                parts.append(f"리뷰 {s_total}건")
            if s_avg is not None:
                parts.append(f"평균 {s_avg:.1f}")
            if s_neg is not None:
                parts.append(f"부정 {s_neg}건")
            if s_ratio is not None:
                parts.append(f"부정률 {round(s_ratio * 100)}%")

            st.caption(" · ".join(parts))

            if snap.get("summary_text"):
                st.caption(f"    요약: {snap['summary_text'][:100]}...")

# =====================================================================
# Deep dive (secondary, collapsed)
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
                data = None

        if data is not None:
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
