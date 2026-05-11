"""OliveYoung browser-driven API connector — Phase 1.

Two independently testable layers:

  Layer A (pure, sync-friendly):
      parse_response_body(body, code_mapper, keyword, collected_at) → [RawReview]
      _normalize_oy_date, _parse_review_record, ProfileCodeMapper
    Tests: tests/test_connectors/test_oliveyoung_browser_api.py

  Layer B (runtime loop):
      OliveYoungBrowserAPIConnector.collect(keyword, params) → [RawReview]
      Wraps a Playwright session, intercepts `/review/api/v2/reviews/cursor`,
      drives infinite-scroll pagination, classifies blocked / auth / rate_limited
      responses, and flows every OK response through Layer A unchanged.
      DOM parsing is deliberately NOT implemented — the JSON response IS the
      source of truth. If OY removes the JSON API we will rebuild the connector,
      not graft DOM fallbacks on top.
    Tests: tests/test_connectors/test_oliveyoung_browser_api_runtime.py
           (use the `BrowserReviewSession` protocol to inject a fake queue of
            pre-recorded responses — no real Playwright needed.)

Source of truth: OliveYoung's `/review/api/v2/reviews/cursor` JSON response.
Endpoint envelope shape (observed 2026-04-21):

    {
      "status": "SUCCESS", "code": 200, "message": "...", "pagination": null,
      "data": {
        "goodsReviewList": [ { ...record... }, ... ],
        "nextCursorId": <int>, "nextCursorScore": <float>,
        "nextCursorCount": null, "hasNext": <bool>, "loginRequired": <bool>
      },
      "totalCnt": null, "pageData": null
    }

Per-record fields used (see `_parse_review_record`):
    - reviewId               → RawReview.source_id (stable, the entire reason
                                Decision 7's fingerprint fallback is moot for OY)
    - content                → RawReview.raw_text
    - reviewScore            → RawReview.raw_rating
    - createdDateTime        → RawReview.raw_date (after YYYY.MM.DD → YYYY-MM-DD)
    - profileDto.memberNickname → RawReview.raw_author (and raw_metadata)
    - goodsDto.optionName    → raw_metadata['product_option_raw'] (promoted)
    - goodsDto.goodsNumber   → raw_metadata['product_external_id'] (promoted to row)
    - profileDto.skinType    → raw_metadata['skin_type'] (promoted; code → label)
    - age_group              → raw_metadata['age_group'] = None (NOT exposed by OY)
    - profileDto.skinTone    → raw_metadata['oy_skin_tone_raw'] (non-promoted)
    - profileDto.skinTrouble → raw_metadata['oy_skin_trouble_raw'] (non-promoted, list)
    - + various oy_* audit fields (review_type, useful_point, recommend_count,
        has_photo, is_repurchase, is_top_reviewer, is_shutterbrity, etc.)

Profile codes (Axx/Bxx/Cxx) are translated via
`data/option_dictionary/oliveyoung_profile_codes.json`. Missing codes log a
warning and yield None — the downstream segment_normalizer's `bucket="unknown"`
fallback handles None cleanly without breaking the pipeline.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import sys
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from src.voc.app.connector_run_summary import ConnectorRunSummary
from src.voc.connectors.base import CollectParams
from src.voc.schemas.raw import RawReview

logger = logging.getLogger(__name__)

# Empirically confirmed via /tmp/oliveyoung_sort_probe.py against
# A000000238646 (see docs/oliveyoung_sort_crawl_probe.md §3.1). The five values
# correspond to the five sort buttons OY exposes on the review tab. The page's
# JS issues these via the request body's `sortType` field; we never construct
# that body — we let the JS issue it after we click the matching button.
_VALID_SORT_TYPES: frozenset[str] = frozenset({
    "USEFUL_SCORE_DESC",   # 유용한 순  (page default; what cold-start fires)
    "RECOMMENDED_DESC",    # 도움순
    "DATETIME_DESC",       # 최신순
    "RATING_DESC",         # 평점 높은순
    "RATING_ASC",          # 평점 낮은순
})
DEFAULT_SORT_TYPE = "USEFUL_SCORE_DESC"

# Static role assignment for the Phase 2E multi-sort plan, mirrored from
# scripts/run_phase2e_pipeline.py. Stamped per row as
# raw_metadata["oy_sort_role"] when sort_type is set, so downstream
# consumers can filter "primary corpus" rows from "signal evidence" rows
# without re-deriving the role from sort_type at every call site.
#
#   - "primary": chronological backbone (DATETIME_DESC). The corpus for
#     all distribution and time-series analysis. Cap=all in plan.
#   - "signal": top-N tail probes (the other four). Evidence pool only
#     — must NOT be used to claim overall distribution.
#
# Single-sort runs of any non-default sort_type still get the same role
# stamp; the role is a property of the sort, not of the plan instance.
_SORT_ROLE_BY_SORT_TYPE: dict[str, str] = {
    "DATETIME_DESC":     "primary",
    "RATING_ASC":        "signal",
    "RATING_DESC":       "signal",
    "USEFUL_SCORE_DESC": "signal",
    "RECOMMENDED_DESC":  "signal",
}

# Promoted keys for OY rows. Same value as oliveyoung_csv.OLIVEYOUNG_PROMOTED_KEYS;
# duplicated (not imported) so the live API connector and the CSV-replay path
# can diverge later without forcing a cross-import.
OLIVEYOUNG_PROMOTED_KEYS: set[str] = {
    "skin_type",
    "age_group",
    "product_option_raw",
}

# Dimensions the profile-code mapper handles. Order is documentation, not API.
PROFILE_DIMENSIONS: tuple[str, ...] = ("skin_type", "skin_tone", "skin_trouble")


class ProfileCodeMapper:
    """Resolve OY profileDto codes (Axx/Bxx/Cxx) → Korean labels via JSON dictionary.

    Dictionary shape (see `data/option_dictionary/oliveyoung_profile_codes.json`):
        {
          "skin_type":    {"A01": "건성", "A02": null, ...},
          "skin_tone":    {"B01": "봄웜톤", ...},
          "skin_trouble": {"C01": "잡티",   ...}
        }
    A null value means "code observed but Korean label not yet curated"; lookup
    returns None and logs a warning ONCE per (dimension, code) per process so
    the operator can extend the dictionary without spamming logs.

    Comment-style top-level keys (anything not in PROFILE_DIMENSIONS or whose
    value isn't a dict) are ignored at load time.
    """

    def __init__(self, dictionary_path: str | Path | None = None):
        self._dict: dict[str, dict[str, str | None]] = {}
        self._warned_codes: set[tuple[str, str]] = set()
        if dictionary_path:
            path = Path(dictionary_path)
            if path.is_file():
                raw = json.loads(path.read_text(encoding="utf-8"))
                self._dict = {
                    k: v for k, v in raw.items()
                    if k in PROFILE_DIMENSIONS and isinstance(v, dict)
                }
            else:
                logger.warning("OY profile-code dictionary not found at %s", path)

    def to_label(self, code: str | None, dimension: str) -> str | None:
        if code is None:
            return None  # legitimate "user didn't fill in" — no warning
        if dimension not in self._dict:
            self._warn_once(dimension, code)
            return None
        label = self._dict[dimension].get(code)
        if label is None:
            self._warn_once(dimension, code)
            return None
        return label

    def to_labels(self, codes: list[str] | None, dimension: str) -> list[str]:
        """Resolve a multi-valued dimension (skin_trouble). Drops unresolved codes."""
        if not codes:
            return []
        out: list[str] = []
        for c in codes:
            label = self.to_label(c, dimension)
            if label is not None:
                out.append(label)
        return out

    def _warn_once(self, dimension: str, code: str) -> None:
        key = (dimension, code)
        if key in self._warned_codes:
            return
        self._warned_codes.add(key)
        logger.warning("Unmapped OY profile code: dimension=%r code=%r", dimension, code)


def parse_response_body(
    body: dict[str, Any],
    *,
    code_mapper: ProfileCodeMapper,
    keyword: str,
    collected_at: datetime,
    sort_type: str | None = None,
    target_goods_no: str | None = None,
) -> list[RawReview]:
    """Extract RawReview list from one /review/api/v2/reviews/cursor response.

    Iterates `data.goodsReviewList`. Records that fail individual parsing are
    skipped with a warning; the function never raises. Defensive against
    arbitrary upstream payload shape (returns [] on missing data/list).

    `sort_type`, when set, is recorded as `raw_metadata["oy_sort_type"]` for
    every parsed row. Used by the multi-sort merge path to attribute each
    review to the sort that surfaced it. None = absent key (legacy behavior).

    `target_goods_no`, when set, filters records whose
    `goodsDto.goodsNumber` differs from the target. Required for
    "기획 set" / multi-option products where one cursor response returns
    reviews from multiple sub-products (e.g., A000000171426 + A000000171427
    in the same payload). Records with no goodsDto.goodsNumber are KEPT
    (defensive default — that record's payload didn't carry the
    discriminator). When None, no filtering is applied (legacy behavior).

    Use `parse_response_body_with_telemetry` to get filter counts.
    """
    parsed, _telemetry = parse_response_body_with_telemetry(
        body,
        code_mapper=code_mapper,
        keyword=keyword,
        collected_at=collected_at,
        sort_type=sort_type,
        target_goods_no=target_goods_no,
    )
    return parsed


def parse_response_body_with_telemetry(
    body: dict[str, Any],
    *,
    code_mapper: ProfileCodeMapper,
    keyword: str,
    collected_at: datetime,
    sort_type: str | None = None,
    target_goods_no: str | None = None,
) -> tuple[list[RawReview], dict[str, int]]:
    """Same as `parse_response_body` but returns telemetry counts.

    Telemetry fields:
      - `total_before_filter`         : `len(data.goodsReviewList)` BEFORE
        any filter; equals the legacy `raw_records_seen` increment.
      - `kept_after_goods_no_filter`  : records that passed the goods
        filter AND parsed successfully.
      - `filtered_by_goods_no`        : records dropped because
        `goodsDto.goodsNumber != target_goods_no`. 0 when no filter.
      - `dropped_unparseable`         : records the per-record parser
        rejected (missing reviewId / content / etc.).

    Sum invariant:
      `total_before_filter == kept_after_goods_no_filter
        + filtered_by_goods_no + dropped_unparseable`
    """
    telemetry = {
        "total_before_filter": 0,
        "kept_after_goods_no_filter": 0,
        "filtered_by_goods_no": 0,
        "dropped_unparseable": 0,
    }
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict):
        logger.warning("OY response body has no 'data' object")
        return [], telemetry
    records = data.get("goodsReviewList")
    if not isinstance(records, list):
        logger.warning("OY response 'data.goodsReviewList' is not a list")
        return [], telemetry

    telemetry["total_before_filter"] = len(records)
    parsed: list[RawReview] = []
    for record in records:
        # Goods-number filter — applied BEFORE per-record parse so a
        # cheap dict lookup avoids the heavier parse_review_record path.
        # Records missing goodsNumber are kept (defensive default).
        if target_goods_no and isinstance(record, dict):
            gd = record.get("goodsDto")
            actual_goods = (gd or {}).get("goodsNumber") if isinstance(gd, dict) else None
            if (
                isinstance(actual_goods, str)
                and actual_goods
                and actual_goods != target_goods_no
            ):
                telemetry["filtered_by_goods_no"] += 1
                continue
        try:
            raw = _parse_review_record(
                record,
                code_mapper=code_mapper,
                keyword=keyword,
                collected_at=collected_at,
                sort_type=sort_type,
            )
        except Exception as e:
            # Defensive: never let one malformed record break the batch.
            logger.warning("Skipping unparseable OY review record: %s", e)
            telemetry["dropped_unparseable"] += 1
            continue
        if raw is None:
            telemetry["dropped_unparseable"] += 1
            continue
        parsed.append(raw)
        telemetry["kept_after_goods_no_filter"] += 1
    return parsed, telemetry


def _parse_review_record(
    record: dict[str, Any],
    *,
    code_mapper: ProfileCodeMapper,
    keyword: str,
    collected_at: datetime,
    sort_type: str | None = None,
) -> RawReview | None:
    """Convert one OY review JSON record to a RawReview; None if record can't be parsed.

    Required fields for a record to parse: `reviewId` and non-empty `content`.
    All other fields degrade to None / [] / passthrough as appropriate.
    """
    if not isinstance(record, dict):
        return None

    review_id = record.get("reviewId")
    content = record.get("content")
    if review_id is None or not content:
        return None

    goods = record.get("goodsDto") or {}
    profile = record.get("profileDto") or {}

    skin_type_code = profile.get("skinType")
    skin_type_label = code_mapper.to_label(skin_type_code, "skin_type")
    skin_tone_code = profile.get("skinTone")
    skin_tone_label = code_mapper.to_label(skin_tone_code, "skin_tone")
    skin_trouble_codes = profile.get("skinTrouble") or []
    if not isinstance(skin_trouble_codes, list):
        skin_trouble_codes = []
    skin_trouble_labels = code_mapper.to_labels(skin_trouble_codes, "skin_trouble")

    raw_metadata: dict[str, Any] = {
        # ---- promoted to channel_meta by the Phase 1 pipeline ----
        "skin_type": skin_type_label,
        "age_group": None,                       # OY API does not expose
        "product_option_raw": goods.get("optionName") or None,
        # ---- promoted to phase1_reviews row column by the pipeline ----
        "product_external_id": goods.get("goodsNumber") or None,
        # ---- non-promoted: audit + future-promotion staging ----
        "oy_review_id": review_id,
        "oy_skin_type_code": skin_type_code,
        "oy_skin_tone_code": skin_tone_code,
        "oy_skin_tone_raw": skin_tone_label,
        "oy_skin_trouble_codes": list(skin_trouble_codes),
        "oy_skin_trouble_raw": skin_trouble_labels,
        "oy_review_type": record.get("reviewType"),
        "oy_useful_point": record.get("usefulPoint"),
        "oy_recommend_count": record.get("recommendCount"),
        "oy_has_photo": record.get("hasPhoto"),
        "oy_is_repurchase": record.get("isRepurchase"),
        "oy_is_top_reviewer": profile.get("isTopReviewer"),
        "oy_is_shutterbrity": profile.get("isShutterbrity"),
        "oy_member_nickname": profile.get("memberNickname"),
        "oy_goods_name": goods.get("goodsName"),
        "oy_item_number": goods.get("itemNumber"),
        "oy_is_skin_type_matched": profile.get("isSkinTypeMatched"),
        "oy_is_skin_tone_matched": profile.get("isSkinToneMatched"),
    }
    # Sort provenance: when the connector was invoked with a non-default
    # sort, attribute every row surfaced under that sort. Stored under
    # `raw_metadata` (= the JSON column raw_metadata_json on phase1_reviews)
    # for downstream filtering. Absent key = legacy / unspecified.
    #
    # `oy_sort_role` mirrors the Phase 2E plan's primary/signal split so
    # consumers can filter the corpus without re-deriving the role from
    # the sort_type. See `_SORT_ROLE_BY_SORT_TYPE` above for the mapping.
    #
    # NOTE: cross-sort multi-membership (i.e., recording every sort that
    # observed a given review_id when the same row appears in multiple
    # sort runs) is NOT yet implemented. INSERT OR IGNORE in the
    # persistence layer means subsequent sorts skip writing, so only the
    # FIRST sort to surface a row is recorded here. Tracking multi-
    # membership would require either per-sort review_id sidecars
    # written by the connector + a post-merge UPDATE pass in the
    # orchestrator, or an UPSERT-with-merge persistence change. Deferred
    # to follow-up: TODO(oy-multi-sort-membership).
    if sort_type is not None:
        raw_metadata["oy_sort_type"] = sort_type
        role = _SORT_ROLE_BY_SORT_TYPE.get(sort_type)
        if role is not None:
            raw_metadata["oy_sort_role"] = role

    return RawReview(
        source_channel="oliveyoung",
        source_id=str(review_id),
        source_url=None,    # OY review API does not return a per-review URL
        raw_text=str(content),
        raw_rating=record.get("reviewScore"),
        raw_author=profile.get("memberNickname"),
        raw_date=_normalize_oy_date(record.get("createdDateTime")),
        raw_language="ko",
        raw_metadata=raw_metadata,
        collected_at=collected_at,
        keyword_used=keyword,
    )


def _normalize_oy_date(raw: str | None) -> str | None:
    """Convert OY's `'YYYY.MM.DD'` to ISO `'YYYY-MM-DD'`.

    Returns None on parse failure; the caller (connector layer) may count as
    parse_warning. Same shape as Coupang's date format — duplicated here rather
    than imported to keep PR4B parser standalone; promote to shared helper if a
    third channel ever wants it.
    """
    if not raw:
        return None
    raw = raw.strip()
    parts = raw.split(".")
    if len(parts) != 3:
        return None
    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if y < 1900 or y > 2100 or not (1 <= m <= 12) or not (1 <= d <= 31):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


# ============================================================================
# Layer B: runtime loop
# ============================================================================
#
# Response classification taxonomy — the five tags below are the full domain of
# `_classify_http_response`. `ConnectorRunSummary` today carries only the two
# booleans `blocked` and `auth_error`, so the connector collapses:
#
#     'blocked' and 'rate_limited' → summary.blocked = True
#     'auth_error'                 → summary.auth_error = True
#     'malformed'                  → summary.parse_warnings += 1  (not fatal)
#     'ok'                         → feed into Layer A parser
#
# The collapse happens in one place (`collect`) so if we ever want a distinct
# `rate_limited` field on the summary, the classifier does not move.

_ResponseTag = str  # one of: "ok" | "auth_error" | "blocked" | "rate_limited" | "malformed"

_MAX_MALFORMED_STREAK = 3


def _classify_http_response(status: int, body: dict | None) -> _ResponseTag:
    """Tag a single intercepted `/reviews/cursor` response.

    HTTP 401                                    → 'auth_error'
    HTTP 403                                    → 'blocked'
    HTTP 429                                    → 'rate_limited'
    HTTP 200 with `data.loginRequired=True`     → 'auth_error' (session expired)
    HTTP 200 with well-shaped goodsReviewList   → 'ok'
    Any other 200 / non-dict / bad shape / body None → 'malformed'
    """
    if status == 401:
        return "auth_error"
    if status == 403:
        return "blocked"
    if status == 429:
        return "rate_limited"
    if status != 200 or not isinstance(body, dict):
        return "malformed"
    data = body.get("data")
    if isinstance(data, dict) and data.get("loginRequired") is True:
        return "auth_error"
    if not isinstance(data, dict) or not isinstance(data.get("goodsReviewList"), list):
        return "malformed"
    return "ok"


def _should_stop_pagination(
    last_body: dict, parsed_so_far: int, max_results: int,
) -> bool:
    """Stop when quota reached OR server signals end-of-stream.

    Only continues on `hasNext is True`. Any other value (False / None / missing)
    stops — conservative so a malformed continuation doesn't spin forever.
    """
    if parsed_so_far >= max_results:
        return True
    data = last_body.get("data") if isinstance(last_body, dict) else None
    has_next = data.get("hasNext") if isinstance(data, dict) else None
    return has_next is not True


# ---------------------------------------------------------------------------
# PR-4 request-side capture: header redaction + per-call record builder.
# ---------------------------------------------------------------------------

# Headers that may carry credentials or session tokens. Redacted by default
# in any captured trace artifact. Comparison is case-insensitive.
_SENSITIVE_HEADER_NAMES: frozenset[str] = frozenset({
    "cookie",
    "authorization",
    "proxy-authorization",
    "x-csrf-token",
    "x-api-key",
    "set-cookie",
})

# Allow-list of safe headers we keep verbatim (case-insensitive). Anything
# not on this list and not on the sensitive list is dropped from the trace
# entirely (avoids accidentally surfacing custom auth-bearing headers).
_SAFE_HEADER_NAMES: frozenset[str] = frozenset({
    "accept",
    "accept-encoding",
    "accept-language",
    "user-agent",
    "referer",
    "content-type",
    "host",
    "origin",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
})


def _redact_request_headers(headers: dict[str, str]) -> dict:
    """Return a sanitized header summary for trace artifacts.

    - Sensitive headers are NOT included verbatim; presence is recorded as
      booleans (`cookie_present`, `auth_header_present`).
    - Safe headers (per `_SAFE_HEADER_NAMES`) are kept verbatim.
    - Any other header is dropped (defensive — avoids accidental leak of
      custom auth-bearing headers we haven't reviewed).
    """
    cookie_present = False
    auth_header_present = False
    redacted: list[str] = []
    safe_subset: dict[str, str] = {}
    for k, v in headers.items():
        kl = k.lower()
        if kl == "cookie" or kl == "set-cookie":
            cookie_present = True
            redacted.append(kl)
            continue
        if kl == "authorization" or kl == "proxy-authorization" or kl == "x-csrf-token" or kl == "x-api-key":
            auth_header_present = True
            redacted.append(kl)
            continue
        if kl in _SENSITIVE_HEADER_NAMES:
            redacted.append(kl)
            continue
        if kl in _SAFE_HEADER_NAMES:
            safe_subset[kl] = v
    return {
        "headers_sample": safe_subset,
        "cookie_present": cookie_present,
        "auth_header_present": auth_header_present,
        "redacted_headers": sorted(redacted),
    }


def _extract_query_params(url: str) -> dict[str, str]:
    """Pull query params out of a URL. Returns first value for each key."""
    from urllib.parse import urlparse, parse_qs

    try:
        q = parse_qs(urlparse(url).query, keep_blank_values=True)
    except Exception:
        return {}
    return {k: (v[0] if v else "") for k, v in q.items()}


def _extract_response_cursor_meta(body: dict | None, status: int) -> dict:
    """Pull cursor / pagination metadata out of a `/reviews/cursor` response.

    Returns a dict with `next_cursor_id`, `has_next`, `record_count`,
    `login_required`. Each field is None when not extractable. Never raises.
    """
    out: dict = {
        "next_cursor_id": None,
        "has_next": None,
        "record_count": None,
        "login_required": None,
    }
    if status != 200 or not isinstance(body, dict):
        return out
    data = body.get("data")
    if not isinstance(data, dict):
        return out
    nc = data.get("nextCursorId")
    if nc is not None:
        out["next_cursor_id"] = str(nc)
    hn = data.get("hasNext")
    if isinstance(hn, bool):
        out["has_next"] = hn
    lr = data.get("loginRequired")
    if isinstance(lr, bool):
        out["login_required"] = lr
    records = data.get("goodsReviewList")
    if isinstance(records, list):
        out["record_count"] = len(records)
    return out


# ---------------------------------------------------------------------------
# Total review count extraction (Phase 2E coverage_ratio support)
#
# OliveYoung surfaces the product's total review count in two places:
#   1. The product page DOM near the review tab — text like
#      "리뷰 (1,234)" or "1,234건". Most reliable when present.
#   2. Some `/reviews/cursor` API responses populate `body.totalCnt` or
#      `body.data.totalCnt`. Many do not (the canonical endpoint
#      returns null per the module docstring), so this is opportunistic.
#
# Both helpers are PURE and never raise — total-count capture is
# metadata for interpretation only and must NOT alter scraping
# behavior, pagination, or any quality gate. None on failure.
# ---------------------------------------------------------------------------


_TOTAL_COUNT_TEXT_RE = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)")


# Breadcrumb separators OY uses across product-page layouts. The DOM
# scan reads either a single combined breadcrumb string ("뷰티 > 스킨케어 >
# 토너패드") OR an enumerated list of nodes; the parser below normalizes
# both. Match "any run of separator chars + horizontal whitespace +
# vertical whitespace" so `"a > b"`, `"a\nb"`, `"a > \n b"` all split
# correctly without breaking nodes that contain a single internal
# space (e.g. hypothetical "색조 메이크업" survives intact because no
# separator char sits in it).
_BREADCRUMB_SEPARATORS_RE = re.compile(r"[ \t]*[>›/›»→\n\r|][ \t\n\r>›/›»→|]*")


def _extract_total_count_from_response_body(
    body: dict | None,
) -> int | None:
    """Best-effort total-count extraction from one cursor API response.

    Looks at `body.totalCnt` and `body.data.totalCnt`. Returns the first
    positive integer found. None when the field is absent, null, or
    non-numeric. Tolerates None / non-dict input.
    """
    if not isinstance(body, dict):
        return None
    candidates: list[object] = []
    candidates.append(body.get("totalCnt"))
    data = body.get("data")
    if isinstance(data, dict):
        candidates.append(data.get("totalCnt"))
    for v in candidates:
        if isinstance(v, bool):
            # bool is a subclass of int — exclude explicitly so True/False
            # never get coerced into 1/0.
            continue
        if isinstance(v, int) and v > 0:
            return v
        if isinstance(v, str):
            digits = v.replace(",", "").strip()
            if digits.isdigit():
                n = int(digits)
                if n > 0:
                    return n
    return None


def normalize_breadcrumb_path(nodes: "list[str] | tuple[str, ...] | None") -> list[str]:
    """Normalize an already-list breadcrumb path: strip each node,
    drop empties, dedupe preserving first-occurrence order.

    Used by both the connector's enumerated-DOM capture path and the
    pipeline's `derive_breadcrumb` helper so legacy raw_metadata rows
    with duplicates / newline contamination get cleaned on read.

    A single element may itself contain breadcrumb separators (newline,
    `>`, `/`, etc.) when the DOM was captured as a single anchor whose
    text was joined with newlines. We re-split each element through
    the separator regex so the legacy form
    `["마스크팩\n패드\n패드"]` is normalized identically to the
    string form `"마스크팩\n패드\n패드"`.

    Examples:
        ["마스크팩", "패드", "패드"]              → ["마스크팩", "패드"]
        ["", " 뷰티 ", "스킨케어", "스킨케어"]   → ["뷰티", "스킨케어"]
        ["마스크팩\\n패드\\n패드"]                → ["마스크팩", "패드"]
        ["뷰티 > 스킨케어", "토너패드"]           → ["뷰티", "스킨케어", "토너패드"]
        None                                     → []
    """
    if not nodes:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for n in nodes:
        if not isinstance(n, str):
            continue
        # Re-split on the canonical breadcrumb separator set so a
        # single element carrying internal separators is decomposed
        # into atomic nodes.
        for piece in _BREADCRUMB_SEPARATORS_RE.split(n.strip()):
            s = piece.strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
    return out


def parse_breadcrumb_text(text: str | None) -> list[str]:
    """Split a single breadcrumb DOM string into a list of nodes.

    Accepts the formats OY ships in across product-page layouts:
        "뷰티 > 스킨케어 > 토너패드"
        "뷰티 / 스킨케어 / 토너패드"
        "마스크팩\\n패드\\n패드"            (newline-joined inline anchors)
        " 뷰티  >  스킨케어  >  토너패드 " (extra whitespace)

    Always strips each node, drops empties, and dedupes preserving
    first-occurrence order — the same contract as
    `normalize_breadcrumb_path`. NEVER raises — this runs inside a
    best-effort DOM capture and must not break the scrape.
    """
    if not text:
        return []
    parts = _BREADCRUMB_SEPARATORS_RE.split(text.strip())
    return normalize_breadcrumb_path(parts)


def _extract_total_count_from_dom_text(text: str | None) -> int | None:
    """Parse a Korean review-tab badge string for the total count.

    Accepts strings shaped like:
        "리뷰 (1,234)"
        "1,234건"
        "리뷰 1234"
        "총 1,234건"
        "리뷰 (12345)"

    Returns the first integer >= 1 the regex finds, or None when the
    text is empty / contains no parseable integer. Comma thousand
    separators are tolerated. Decimals are NOT — a "4.7점" rating
    would otherwise spuriously match.
    """
    if not text:
        return None
    m = _TOTAL_COUNT_TEXT_RE.search(text)
    if not m:
        return None
    digits = m.group(1).replace(",", "")
    try:
        n = int(digits)
    except ValueError:
        return None
    if n < 1:
        return None
    return n


class BrowserReviewSession(Protocol):
    """Minimal seam between the runtime loop and the real browser.

    Implementations own page navigation, response interception, and scroll
    gestures. The runtime loop only ever calls the four methods below. Tests
    inject a fake that pops from a pre-recorded queue; the default factory in
    `OliveYoungBrowserAPIConnector` returns a real Playwright-backed session.

    Method contracts:
      - `open(product_url)`: navigate, install interceptor, click review tab
        if present. Must NOT block waiting for the first JSON response — the
        runtime loop is responsible for cold-start timeout accounting.
      - `wait_for_next_response(timeout_s)`: pop the next intercepted response
        or return None on timeout. Each response is (http_status, json_body_or_None).
      - `scroll_for_next()`: best-effort scroll gesture to provoke the next
        batch. Must not raise on failure.
      - `close()`: release browser resources. Idempotent.
    """

    async def open(self, product_url: str) -> None: ...
    async def wait_for_next_response(
        self, *, timeout_s: float,
    ) -> tuple[int, dict | None] | None: ...
    async def scroll_for_next(self) -> None: ...
    async def close(self) -> None: ...

    # PR-4: per-API-call records captured during the session. Each entry is
    # a dict with `request` (method/url/query_params/headers metadata) and
    # `response` (status/cursor metadata). Implementations append in
    # request-order; `wait_for_next_response` parity is preserved (one
    # response → one log entry). Returns an empty list when capture is
    # disabled or no calls were observed.
    def get_request_log(self) -> list[dict]: ...

    # PR-4: best-effort login-state probe. Returns one of "logged_in" /
    # "logged_out" / "unknown" / None. None means the probe was not run
    # (e.g., non-CDP mode where login state is irrelevant). Informational
    # only; quality gate does NOT consult this.
    async def observe_login_state(self) -> str | None: ...

    # Phase 2E sort-aware crawl: tally of post_data.sortType across all
    # observed `/reviews/cursor` calls (including those filtered out from
    # the consumer queue). Real session populates; test fakes may omit
    # — the connector uses `getattr` with default `{}` to degrade safely.
    # def get_observed_sort_types(self) -> dict[str, int]: ...
    # def get_responses_filtered_out_by_sort(self) -> int: ...

    # Phase 2E false-empty recovery: detect / reload-reopen. Both methods
    # are best-effort and tolerate `None` returns. Test fakes may omit
    # them; the connector uses `getattr` with safe defaults.
    # async def is_false_empty_state(self) -> bool | None: ...
    # async def reload_and_reopen_review_tab(self) -> None: ...


class OliveYoungBrowserAPIConnector:
    """Live OY connector — scrolls the product review tab and intercepts JSON.

    Defaults drive a real Playwright/Chromium session (soft-imported; a missing
    `playwright` install raises a `RuntimeError` at `collect()` time with an
    install hint). Tests inject `session_factory=` to bypass the browser.

    `last_run_summary` follows the same contract as OliveYoungCSVConnector:
    populated after every `collect()` call, including early-exit blocked/auth
    paths. `evaluate_quality_gates(summary)` will flag any run with `blocked=True`
    or `auth_error=True` as `invalid` — those are non-recoverable here.
    """

    REVIEW_API_PATH = "/review/api/v2/reviews/cursor"
    # Match by path so both `m.oliveyoung.co.kr` (mobile host) and
    # `www.oliveyoung.co.kr` (desktop) cursor endpoints are captured.
    # The substring check `api_path in response.url` already covers
    # both — this constant exists so tests can assert the contract.

    # Product URL → goodsNo regex. Matches `goodsNo=A...` query param
    # (case-insensitive). Used to derive the target goodsNo passed to
    # the parser's `target_goods_no` filter so cursor responses that
    # mix sub-product goodsNumbers (e.g., for 기획 set products) drop
    # rows belonging to OTHER products.
    _GOODS_NO_RE = re.compile(r"[?&]goodsNo=([A-Za-z]\d{10,})", re.IGNORECASE)
    REVIEW_TAB_LOCATOR = 'button:has-text("리뷰&셔터")'
    # Lazy-load trigger fallbacks. The page sometimes renders the
    # review-tab DOM with metadata APIs fired (stats / options /
    # photo-reviews) but the main cursor API never wakes up because
    # the IntersectionObserver / lazy-load hook only fires on
    # explicit gestures: a "리뷰 더보기" click or a scroll into the
    # review section. After the initial review-tab click, we attempt
    # both fallbacks blindly — they're idempotent (clicking 더보기
    # when reviews are already loaded is a no-op).
    REVIEW_MORE_LOCATORS: tuple[str, ...] = (
        'button:has-text("리뷰 더보기")',
        'a:has-text("리뷰 더보기")',
    )
    # Korean sort-button labels validated by /tmp/oliveyoung_sort_probe.py.
    # Click drives the page's JS to re-issue the cursor API with the matching
    # `sortType` body field — we do NOT construct that body ourselves.
    # USEFUL_SCORE_DESC is the page default (already active on cold start), so
    # the connector skips the click for it; keeping it in the map keeps
    # validation symmetric and lets the multi-sort orchestrator iterate without
    # special-casing the default.
    # Legacy `has-text` selectors. Kept for the public class constant
    # (existing tests / external callers reference SORT_BUTTON_LOCATORS),
    # but the runtime path now uses SORT_BUTTON_LABELS_KO + the robust
    # selection helper because `has-text` does substring matching, which
    # was empirically observed to miss "최신순" when the page rendered
    # neighboring buttons containing the substring "최신" (e.g. headers).
    SORT_BUTTON_LOCATORS: dict[str, str] = {
        "USEFUL_SCORE_DESC": 'button:has-text("유용한 순")',
        "RECOMMENDED_DESC":  'button:has-text("도움순")',
        "DATETIME_DESC":     'button:has-text("최신순")',
        "RATING_DESC":       'button:has-text("평점 높은순")',
        "RATING_ASC":        'button:has-text("평점 낮은순")',
    }
    # Korean labels used by the robust sort-button selector. Each value
    # is the EXACT visible text on the button (after whitespace
    # normalization). The runtime path enumerates all buttons in the sort
    # area, normalizes inner text (`re.sub(r"\s+", " ", t).strip()`) and
    # matches equality — eliminates the substring-matching ambiguity.
    SORT_BUTTON_LABELS_KO: dict[str, str] = {
        "USEFUL_SCORE_DESC": "유용한 순",
        "RECOMMENDED_DESC":  "도움순",
        "DATETIME_DESC":     "최신순",
        "RATING_DESC":       "평점 높은순",
        "RATING_ASC":        "평점 낮은순",
    }
    # Container selectors searched (in order) before falling back to the
    # whole page. The first one that contains any sort-label-matching
    # button wins. OY's review page has shipped multiple wrappers
    # (`.pc-sort`, `.sort-container`, naked button bar) over time, so
    # we try several rather than locking onto one.
    SORT_CONTAINER_CANDIDATES: tuple[str, ...] = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",  # any class containing 'sort'
    )
    # Disclosure affordances inside the sort scope. When the rating
    # tabs (`평점 낮은순` / `평점 높은순`) are not inline-rendered on
    # first poll, OY may hide them behind a "more sort options" /
    # filter panel. The connector tries each label as an EXACT-text
    # match (NOT substring — substring would risk clicking a category-
    # nav element labelled `랭킹` which contains `랭`). At most one
    # disclosure click per probe; the existing locator chain re-polls
    # afterward to find the now-revealed rating label.
    # Scoped to the sort container hits — never page-wide.
    SORT_DISCLOSURE_AFFORDANCE_LABELS_KO: tuple[str, ...] = (
        "정렬",
        "더보기",
        "전체보기",
        "필터",
        "정렬 기준",
    )
    # OliveYoung occasionally renders a false empty-review state on the
    # review tab during heavy crawling / sort switching, even on products
    # that DO have reviews. Two known marker strings (one heading, one
    # CTA). Match by substring (Playwright text engine `text=...`) so a
    # surrounding wrapper / icon span doesn't break the match. Detection
    # is a tri-state: True (marker visible), False (marker absent),
    # None (probe failed — treat as unknown, don't trigger retry).
    FALSE_EMPTY_MARKERS_KO: tuple[str, ...] = (
        "등록된 리뷰가 없어요",
        "첫 리뷰 작성하고",  # prefix-only — full text "첫 리뷰 작성하고 1,000P 받아가세요"
    )
    # Stepped (jittered) backoff between false-empty retries. Empirical
    # working hypothesis: false-empty is an anti-bot SOFT BLOCK signal,
    # not just a slow-loading heuristic — short retries hit the same
    # poisoned session repeatedly. So we escalate: first retry waits
    # 5–8s; if still empty, second retry waits 10–20s. Each tuple is
    # `(min, max)` of `random.uniform(...)`. Length determines the max
    # retry count: `len(FALSE_EMPTY_RETRY_DELAYS_S) == FALSE_EMPTY_MAX_RETRIES`.
    # If you bump max retries, add another `(min, max)` tuple here.
    FALSE_EMPTY_RETRY_DELAYS_S: tuple[tuple[float, float], ...] = (
        (5.0, 8.0),
        (10.0, 20.0),
    )
    FALSE_EMPTY_MAX_RETRIES = 2
    # Final cooldown applied AFTER retries are exhausted, BEFORE the run
    # is classified as blocked. Lets any session-level rate-limit
    # window cool off so the multi-sort orchestrator's next sort isn't
    # immediately torpedoed by the same anti-bot state. Range is
    # jittered to avoid synchronized retries across operators.
    FALSE_EMPTY_FINAL_COOLDOWN_RANGE_S: tuple[float, float] = (10.0, 30.0)

    # Anti-bot / interstitial markers (Korean + English/Latin). Detected
    # by Playwright text-engine substring match — same approach as
    # `FALSE_EMPTY_MARKERS_KO`. Tuned conservatively to avoid false
    # positives on normal e-commerce text:
    #   - "본인 확인" / "로봇이 아닙니다" — identity / reCAPTCHA wall
    #   - "잠시만 기다려" / "보안 점검" — Cloudflare-style "Just a moment"
    #     interstitial; OY occasionally fronts heavy anti-bot with this
    #   - "로그인이 필요합니다" / "로그인 후 이용해" — login wall
    #     (we DETECT but do not auto-login; operator handles)
    #   - English variants for completeness
    # Operators can extend by subclassing the connector and overriding
    # this tuple — same pattern as FALSE_EMPTY_MARKERS_KO.
    INTERSTITIAL_MARKERS_KO: tuple[str, ...] = (
        "본인 확인",
        "로봇이 아닙니다",
        "잠시만 기다려",
        "보안 점검",
        "보안 문자",
        "자동 입력 방지",
        "로그인이 필요",
        "로그인 후 이용",
        "Just a moment",
        "Are you a robot",
        "Verify you are human",
    )
    # Backoff sequence for interstitial retries. Each tuple is
    # `(min, max)` for `random.uniform`. A fresh tab re-click is
    # cheap; we can retry more aggressively than false-empty
    # (which involves a full page recreate). Length of the sequence
    # determines max retries.
    INTERSTITIAL_RETRY_DELAYS_S: tuple[tuple[float, float], ...] = (
        (3.0, 5.0),
        (6.0, 10.0),
    )
    INTERSTITIAL_MAX_RETRIES = 2

    # Total deadline for the sort-button hunt. The hunt polls inside
    # this window because OY renders the sort row in a second JS pass
    # after the review list mounts, and the timing is variable: the
    # earlier successful probe saw the row in ~1.5s, but live runs have
    # been observed to need 5-8s after a cold review-tab click. We poll
    # once per second and click as soon as the matching label appears,
    # bailing on this budget.
    SORT_HUNT_SETTLE_S = 12.0
    SORT_HUNT_POLL_INTERVAL_S = 1.0
    SCROLL_CANDIDATES: tuple[str, ...] = (
        "div.review-list-container",  # validated primary; the capture script hit this one
        "ul.review-list",
        "body",
    )
    # Defaults are kept as class constants so existing tests / callers that
    # reference them (e.g. `OliveYoungBrowserAPIConnector.MAX_SCROLL_ATTEMPTS_PER_PAGE`)
    # continue to work. Per-instance overrides use the constructor params below.
    COLD_START_TIMEOUT_S = 30.0
    PAGE_N_TIMEOUT_S = 8.0
    MAX_SCROLL_ATTEMPTS_PER_PAGE = 3
    # I-OY-SCROLL-CONTINUATION-IMPL — when the per-page scroll budget is
    # exhausted but the server's last body still says hasNext=True, we
    # try a bounded number of page-recreate-and-resume cycles before
    # declaring the run scroll-continuation-exhausted. The recovery
    # primitive is `_PlaywrightReviewSession.reload_and_reopen_review_tab`
    # (the same path the false-empty recovery flow already uses); after
    # the recreate we re-enter the continuation loop and the existing
    # `seen_ids` dedup set carries the prefix forward so re-walked
    # cursors do not double-count. Keep this conservative — each
    # recreate re-walks every cursor up to the current depth, so a
    # value much above 2 risks turning an already-slow archive crawl
    # into a runaway. Operators who want a bigger budget on a known-
    # deep product can override via the constructor kwarg.
    MAX_SCROLL_RECOVERY_RECREATES = 2
    # Post-sort-click settle window. After session.open() (which clicks
    # the sort button) we peek the response queue for up to this many
    # seconds before invoking the DOM-based false-empty probe. If
    # anything is in the queue, the cursor API has answered for our
    # `_expected_sort_type`, so any visible empty marker is a transient
    # mid-render artifact and false-empty escalation is skipped.
    POST_SORT_SETTLE_S = 5.0
    # Opt-in knob for the (NOT YET IMPLEMENTED) full browser-restart
    # recovery layer. Plumbed as a constant so callers can flip it
    # via constructor without code changes once Phase 2 lands. Today
    # this constant has no effect — kept here for visibility.
    ALLOW_FULL_BROWSER_RESTART = False
    USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
    VIEWPORT = {"width": 1280, "height": 900}

    def __init__(
        self,
        *,
        product_url: str,
        code_mapper: ProfileCodeMapper | None = None,
        headless: bool = True,
        session_factory: Callable[[], BrowserReviewSession] | None = None,
        storage_state_path: "Path | str | None" = None,
        cdp_endpoint: str | None = None,
        # ---- PR-1 hardening: configurable timeouts ----
        # Default values mirror the class constants so legacy callers see no
        # behavior change. Override via constructor or CLI flags for products
        # that need a longer cold-start window.
        cold_start_timeout_s: float | None = None,
        page_n_timeout_s: float | None = None,
        max_scroll_attempts_per_page: int | None = None,
        # I-OY-SCROLL-CONTINUATION-IMPL — recovery budget when the
        # per-page scroll attempts are exhausted while the server still
        # signals `hasNext=True`. None falls back to the class default
        # (`MAX_SCROLL_RECOVERY_RECREATES`). 0 disables recovery entirely
        # and preserves pre-patch behavior exactly (legacy `_note(...)
        # break` terminus).
        max_scroll_recovery_recreates: int | None = None,
        # ---- PR-2 hardening: opt-in auth retry + debug artifacts ----
        # Defaults preserve PR-1 behavior exactly. auth_retry=0 means no
        # retry attempts; the connector breaks on mid-stream auth_error
        # exactly as in PR-1. capture_partial_on_invalid=False means no
        # debug artifact is ever written. debug_dir is the operator-owned
        # output directory; by convention recommend `/tmp/...` so artifacts
        # never land inside the repo or DB scope.
        auth_retry: int = 0,
        debug_dir: "Path | str | None" = None,
        capture_partial_on_invalid: bool = False,
        # ---- Phase 2E sort-aware crawl: opt-in sort selection ----
        # `None` (the default) preserves pre-sort-aware behavior exactly:
        # no sort-button click is attempted, and no `oy_sort_type` key is
        # written to per-row raw_metadata. When set to one of the five
        # validated sortTypes, the connector clicks the matching sort
        # button right after the review-tab click (skipped for
        # USEFUL_SCORE_DESC since that is OY's page-default sort already
        # active on cold start) and stamps every row's raw_metadata with
        # `oy_sort_type` for downstream attribution. The multi-sort
        # orchestrator passes USEFUL_SCORE_DESC explicitly so its rows
        # also carry the stamp.
        sort_type: str | None = None,
        # ---- Human-check (anti-bot CAPTCHA) wait-and-resume ----
        # When the page renders a CAPTCHA / "본인 확인" / Cloudflare
        # interstitial, the existing short-jitter retries (handled by
        # FALSE_EMPTY_RETRY_DELAYS_S / INTERSTITIAL_RETRY_DELAYS_S)
        # cannot solve it. Instead the connector polls the DOM until
        # the operator clears it manually in the CDP-attached Chrome.
        #   `human_check_timeout_s`     — total wait budget. Default
        #     900 (15 min); raise for unattended overnight runs, lower
        #     when you'd rather skip than wait.
        #   `human_check_poll_s`        — poll interval. Default 5s;
        #     too short wastes CPU on the DOM probe, too long delays
        #     resume after a manual solve.
        #   `fail_on_human_check_timeout` — terminal behavior on
        #     timeout. False (default) → mark this sort
        #     `human_check_skipped` and return cleanly so the
        #     multi-sort orchestrator can continue. True → mark
        #     `blocked` so the orchestrator treats it the same as
        #     other hard failures.
        human_check_timeout_s: float = 900.0,
        human_check_poll_s: float = 5.0,
        fail_on_human_check_timeout: bool = False,
        # ---- Session reset (`--strict-reset-session-on-block`) ----
        # When True under CDP-attached mode, the Playwright session
        # creates a fresh context instead of reusing the user's
        # existing one. Cookies / localStorage are dropped; the
        # operator re-logs in manually. Default False preserves the
        # existing reuse-default-context behavior.
        force_fresh_context: bool = False,
    ):
        if not product_url:
            raise ValueError("OliveYoungBrowserAPIConnector requires a non-empty product_url")
        if sort_type is not None and sort_type not in _VALID_SORT_TYPES:
            raise ValueError(
                f"sort_type must be one of {sorted(_VALID_SORT_TYPES)} or None; "
                f"got {sort_type!r}",
            )
        self._product_url = product_url
        self._mapper = code_mapper or ProfileCodeMapper()
        self._headless = headless
        self._session_factory = session_factory
        # storage_state_path: seed Playwright context from a cookies JSON (from
        # any source — browser-extension export etc.).
        # cdp_endpoint: attach to an already-running Chrome instance launched
        # with --remote-debugging-port. Uses the user's real browser session
        # end-to-end; no automation-launched browser. Short-term validation
        # unlock; long-term ingestion is still seller-authorized (API / portal
        # / CSV), not this.
        self._storage_state_path = storage_state_path
        self._cdp_endpoint = cdp_endpoint
        self._cold_start_timeout_s = (
            cold_start_timeout_s
            if cold_start_timeout_s is not None
            else self.COLD_START_TIMEOUT_S
        )
        self._page_n_timeout_s = (
            page_n_timeout_s
            if page_n_timeout_s is not None
            else self.PAGE_N_TIMEOUT_S
        )
        self._max_scroll_attempts = (
            max_scroll_attempts_per_page
            if max_scroll_attempts_per_page is not None
            else self.MAX_SCROLL_ATTEMPTS_PER_PAGE
        )
        # I-OY-SCROLL-CONTINUATION-IMPL — recovery budget for the post-
        # scroll-exhaustion page-recreate path. Validated cheaply (a
        # negative budget is operator typo).
        if (
            max_scroll_recovery_recreates is not None
            and max_scroll_recovery_recreates < 0
        ):
            raise ValueError(
                f"max_scroll_recovery_recreates must be >= 0 "
                f"(got {max_scroll_recovery_recreates}); use 0 to disable",
            )
        self._max_scroll_recovery_recreates: int = int(
            max_scroll_recovery_recreates
            if max_scroll_recovery_recreates is not None
            else self.MAX_SCROLL_RECOVERY_RECREATES
        )
        # Post-sort-click settle window (seconds). After session.open()
        # returns we wait this long for a matching /cursor response to
        # land in the queue before declaring false-empty. The win is
        # avoiding teardown of pages that ARE loading correctly but
        # show the OY empty placeholder briefly during the JS render
        # pass. Default 5s — enough for the response to arrive on
        # healthy networks; short enough to not extend a real
        # soft-block detection meaningfully (the existing 70–90s
        # false-empty path still fires when the queue stays empty).
        self._post_sort_settle_s: float = self.POST_SORT_SETTLE_S
        if auth_retry < 0:
            raise ValueError(
                f"auth_retry must be >= 0 (got {auth_retry}); use 0 to disable",
            )
        self._auth_retry = auth_retry
        self._debug_dir = Path(debug_dir) if debug_dir else None
        self._capture_partial_on_invalid = capture_partial_on_invalid
        self._sort_type = sort_type
        # Human-check wait config (validated cheaply — out-of-range
        # values would otherwise let an operator typo silently
        # flip the timeout into a no-op).
        if human_check_timeout_s < 0:
            raise ValueError(
                f"human_check_timeout_s must be >= 0 (got {human_check_timeout_s})",
            )
        if human_check_poll_s <= 0:
            raise ValueError(
                f"human_check_poll_s must be > 0 (got {human_check_poll_s})",
            )
        self._human_check_timeout_s: float = float(human_check_timeout_s)
        self._human_check_poll_s: float = float(human_check_poll_s)
        self._fail_on_human_check_timeout: bool = bool(fail_on_human_check_timeout)
        self._force_fresh_context: bool = bool(force_fresh_context)
        self.last_run_summary: ConnectorRunSummary | None = None
        # Per-run review_id list, populated at the end of `collect()` from the
        # successfully-parsed RawReview rows. Consumed by the multi-sort
        # membership tracker (src/voc/app/sort_membership.py) via the ingest
        # CLI → batch runner → sidecar JSON path. Reset to [] at the start of
        # each `collect()` so callers see only the current run's IDs.
        self.last_collected_review_ids: list[str] = []

    @property
    def channel_name(self) -> str:
        return "oliveyoung"

    async def collect(
        self, keyword: str, params: CollectParams | None = None,
    ) -> list[RawReview]:
        params = params or CollectParams()
        run_id = f"oliveyoung_browser_{uuid.uuid4().hex[:12]}"
        started = datetime.now()
        # Reset the per-run review_id list so consumers (membership tracker)
        # never see leftover IDs from a prior collect() invocation on the
        # same connector instance.
        self.last_collected_review_ids = []

        # v2.4.6 — pre-allocate `last_run_summary` so the CDP-endpoint
        # diagnostic survives even when the run raises before reaching
        # the canonical assembly site (line ~1776). Without this, a
        # `connect_over_cdp` failure produces an exception → ingest CLI
        # builds its synthetic_summary → the connector's diagnostic is
        # never assembled → `requested_cdp_endpoint=null`. With this
        # pre-allocation, even if `_build_session()` or `session.open()`
        # raises, the partial summary already records what the
        # connector was constructed with.
        self.last_run_summary = ConnectorRunSummary(
            run_id=run_id,
            channel="oliveyoung",
            requested_target=self._product_url,
            started_at=started,
            requested_cdp_endpoint=self._cdp_endpoint,
            connector_received_cdp_endpoint=self._cdp_endpoint,
        )
        # Sort-aware diagnostic log up front: makes the requested sort
        # visible in stdout/log capture for every run. Helps operators
        # spot mismatches without having to dig through trace JSONL.
        if self._sort_type is not None:
            logger.info(
                "OY connector: requested_sort_type=%r product_url=%s "
                "max_results=%d (run_id=%s)",
                self._sort_type, self._product_url, params.max_results, run_id,
            )

        raws: list[RawReview] = []
        # PR-2: source_id dedup set carries across retry attempts so a retried
        # scroll doesn't duplicate already-collected rows.
        seen_ids: set[str] = set()
        raw_seen = 0
        parse_warnings = 0
        sample_dropped: list[str] = []
        blocked = False
        auth_error = False
        last_body: dict | None = None  # last OK response body; drives the
                                        # post-condition "hasNext=True but no
                                        # continuation" visibility check.

        # ---- PR-1 distinct telemetry flags (cumulative across attempts) ----
        cold_start_timed_out = False
        http_403_seen = False
        http_429_seen = False
        http_401_or_login_required_seen = False
        mid_stream_auth_break = False
        pagination_exhausted_clean = False  # set when loop ended on hasNext=False

        # ---- I-OY-OPEN-HANDSHAKE-TIMEOUT telemetry ----
        # `open_handshake_timed_out` fires when `await session.open(...)`
        # exceeds `self._cold_start_timeout_s`. Distinct from
        # `cold_start_timed_out` (which gates the downstream
        # `wait_for_next_response` cold-start). Without this bound, a
        # wedged Playwright/CDP target-attach (see
        # `I-OY-ILSO-VISIBLE-REVIEWS-COLLECTOR-MISS-TRIAGE` §11) hung the
        # connector for >99 minutes per proof attempt with zero
        # `/reviews/cursor` traffic, no NDJSON, and no batch_summary —
        # invisible to the operator until external kill. The flag is
        # surfaced as `page_open_failed=True` on the summary so
        # `classify_status()` routes the failure to the existing
        # `page_open_failed` taxonomy bucket (NOT `anti_bot` and NOT
        # `max_cap_reached`).
        open_handshake_timed_out = False
        open_handshake_error: str | None = None

        # ---- PR-2 retry telemetry ----
        auth_retry_attempts_used = 0

        # ---- I-OY-SCROLL-CONTINUATION-IMPL telemetry ----
        # Cumulative across the run (any auth-retry attempt that re-enters
        # the continuation loop also accumulates into the same counters).
        #   `scroll_continuation_recovery_attempts` — number of post-scroll-
        #     exhaustion `reload_and_reopen_review_tab` recreates fired.
        #   `scroll_continuation_recovery_recovered` — True if at least one
        #     recovery yielded ≥1 NEW unique row (after seen_ids dedup).
        #   `scroll_continuation_terminated_with_has_next` — True if the
        #     run terminated the inner continuation loop while the server's
        #     last body still said `hasNext=True` AND the recovery budget
        #     was exhausted (or 0). Distinct from `incomplete_collection`
        #     because this is the *terminus condition*, while incomplete is
        #     the *post-condition* derived from the final last_body.
        scroll_continuation_recovery_attempts = 0
        scroll_continuation_recovery_recovered = False
        scroll_continuation_terminated_with_has_next = False

        # ---- Human-check (anti-bot CAPTCHA wait) telemetry ----
        # Cumulative across all attempts. `recovery_action` is the
        # latest terminal verb from `_wait_for_human_check`. When the
        # wait runs more than once across retries, `waited_s` sums
        # across calls so the summary reflects total operator-time.
        # Default action="not_detected" so the run-summary field is
        # always populated with a meaningful enum even when no wait
        # ran. Detection paths overwrite it.
        human_check_detected = False
        human_check_waited_s = 0
        human_check_recovered = False
        human_check_action: str | None = "not_detected"

        # ---- Phase 2E false-empty recovery telemetry ----
        # `false_empty_state_detected` is True if at least one false-empty
        # probe ever returned True during this run (across attempts and
        # auth retries). `false_empty_retry_count` is the total number of
        # reload-and-recheck cycles executed (NOT the count of detections).
        false_empty_state_detected = False
        false_empty_retry_count = 0
        # When the in-session reload retries are exhausted with the marker
        # still visible, we treat the run as blocked. This terminal flag
        # is also surfaced in the summary so classify_status can map it
        # to a distinct status string ("blocked_or_empty_state").
        false_empty_exhausted = False

        # ---- Sort-button diagnostics (Phase 2E) ----
        # Deduped list of normalized button labels the session enumerated
        # during sort-button hunts. Drained at end of run from the final
        # session via `get_seen_sort_labels()`.
        available_sort_button_labels: list[str] = []
        # True iff the most recent sort-button hunt ran to deadline
        # without locating the requested sort tab AFTER the widening
        # probe. Drained from `session.get_sort_control_unreachable()`
        # at end of run. Distinct from `false_empty_state_detected` —
        # routed by `collection_batch.classify_status` to a separate
        # terminal status (`sort_control_unreachable`).
        sort_control_unreachable_observed = False

        # ---- PR-4 request-side / cursor telemetry (cumulative across attempts) ----
        cursor_sequence: list[str] = []
        last_known_cursor: str | None = None
        # 1-indexed: failed_at_request_index = N means the Nth observed
        # `/reviews/cursor` call (across the whole run including retries) was
        # the first to return a non-ok classification. None = no failure.
        failed_at_request_index: int | None = None
        # Cumulative count of API responses observed across all attempts.
        # We compute this from `len(session.get_request_log())` at the end
        # of each attempt (the session resets log on each rebuild).
        review_api_response_count_cumulative = 0
        login_state_observed: str | None = None
        # Per-call records for the trace JSONL. Each entry is augmented with
        # `attempt_index` (which retry attempt it came from) before write.
        trace_records: list[dict] = []

        def _note(reason: str) -> None:
            if len(sample_dropped) < 5:
                sample_dropped.append(reason)

        # Target goodsNo for cross-product filtering. 기획 set products
        # return reviews from multiple sub-products in one cursor
        # response; without filtering we'd over-count rows that belong
        # to a sibling product. None when URL has no goodsNo (extremely
        # rare; defensive). Cumulative filter telemetry accumulates
        # across every call to `_add_unique`.
        target_goods_no_match = self._GOODS_NO_RE.search(self._product_url or "")
        target_goods_no = (
            target_goods_no_match.group(1).upper()
            if target_goods_no_match else None
        )
        filter_telemetry_total = {
            "total_before_filter": 0,
            "kept_after_goods_no_filter": 0,
            "filtered_by_goods_no": 0,
            "dropped_unparseable": 0,
        }

        def _add_unique(body: dict) -> int:
            """Parse `body` and append unique RawReviews to `raws`. Returns count
            of NEW records added (records whose source_id was already in
            `seen_ids` are skipped — load-bearing for retry-with-resume).
            """
            parsed, telem = parse_response_body_with_telemetry(
                body,
                code_mapper=self._mapper,
                keyword=keyword,
                collected_at=started,
                # Stamp every row with the sort surfacing it; None when
                # the operator did not opt in (= legacy row shape).
                sort_type=self._sort_type,
                # Drop rows belonging to sibling sub-products in the
                # same cursor response. Critical for 기획 set products.
                target_goods_no=target_goods_no,
            )
            for k in filter_telemetry_total:
                filter_telemetry_total[k] += telem.get(k, 0)
            added = 0
            for r in parsed:
                if r.source_id and r.source_id in seen_ids:
                    continue
                if r.source_id:
                    seen_ids.add(r.source_id)
                raws.append(r)
                added += 1
            return added

        session = self._build_session()
        try:
            attempt_index = 0
            # Outer retry loop. Each iteration owns one full attempt
            # (open → cold-start → continuation). The loop only re-iterates
            # when a mid-stream auth_break fired AND the retry budget allows
            # another attempt; all other terminal outcomes break out.
            while True:
                # I-OY-OPEN-HANDSHAKE-TIMEOUT — bound the open/navigation
                # handshake. `session.open()` performs CDP attach (existing
                # context reuse), `_ctx.new_page()`, listener install, and
                # `page.goto()`. Any of these can wedge silently when the
                # CDP target table is poisoned (multi-tab residual + same-
                # context reuse), and prior to this timeout there was no
                # outer bound — the connector hung for >99 min per attempt
                # before external kill. `_cold_start_timeout_s` is reused
                # rather than introducing a new constructor knob: the
                # operator-set value already reflects how long the run is
                # willing to wait for cold-start traffic, and an open that
                # has not produced even an HTTP response by then is
                # effectively wedged for the same reasons.
                try:
                    await asyncio.wait_for(
                        session.open(self._product_url),
                        timeout=self._cold_start_timeout_s,
                    )
                except asyncio.TimeoutError:
                    open_handshake_timed_out = True
                    open_handshake_error = (
                        f"open_handshake_timeout: session.open() exceeded "
                        f"{self._cold_start_timeout_s:.0f}s before any "
                        f"review API request; likely Playwright→CDP "
                        f"target-attach wedge "
                        f"(see I-OY-ILSO-VISIBLE-REVIEWS-COLLECTOR-MISS-"
                        f"TRIAGE)"
                    )
                    _note(open_handshake_error)
                    # Do NOT set `blocked=True`: classify_status would
                    # then route this to `anti_bot`, which the operator
                    # explicitly forbids for this failure mode. The
                    # `page_open_failed` flag we set in the summary
                    # below is the correct semantic bucket — a CDP /
                    # navigation handshake that did not complete is, by
                    # definition, a page-open failure, and
                    # `classify_status()` checks `page_open_failed`
                    # BEFORE the blocked / anti-bot branch.
                    break  # exit outer retry loop; falls through to finally
                # PR-4: login-state probe on first attempt (informational
                # only; quality gate ignores this). Best-effort — failures
                # silently degrade to "unknown".
                if attempt_index == 0:
                    try:
                        login_state_observed = await session.observe_login_state()
                    except Exception as e:
                        logger.debug("OY browser login probe error: %s", e)
                        login_state_observed = "unknown"
                attempt_hit_mid_stream_auth = False

                # ---- Human-check (anti-bot CAPTCHA) wait-and-resume ----
                # Run BEFORE the false-empty probe. CAPTCHA pages don't
                # render the review-tab DOM at all, so the false-empty
                # marker is absent — without this gate the connector
                # would fall straight into cold-start timeout and
                # classify the sort as `anti_bot` after one short retry.
                #
                # On detection: print a banner once, then poll the DOM
                # until the operator clears the interstitial in the
                # CDP-attached Chrome (or the timeout expires).
                #
                # On recovery: continue the same sort — the queue is
                # cleared by the in-session probe (review-tab click
                # below re-fires the cursor API).
                #
                # On timeout + fail_on_human_check_timeout=False:
                # mark this sort as skipped (set `blocked=True` so it
                # drops out of the corpus, but the recovery_action
                # surfaces the distinct cause to the orchestrator).
                #
                # On timeout + fail_on_human_check_timeout=True:
                # also mark blocked, but with the harsher
                # `failed_on_timeout` action verb.
                hc_detected, hc_waited, hc_recovered, hc_action = (
                    await self._wait_for_human_check(session)
                )
                if hc_detected:
                    human_check_detected = True
                    human_check_waited_s += hc_waited
                    human_check_recovered = hc_recovered or human_check_recovered
                    human_check_action = hc_action
                    if not hc_recovered:
                        blocked = True
                        if self._fail_on_human_check_timeout:
                            _note(
                                f"human_check_failed_on_timeout "
                                f"(waited {hc_waited}s)",
                            )
                        else:
                            _note(
                                f"human_check_skipped "
                                f"(timed out after {hc_waited}s; sort marked "
                                f"partial — orchestrator continues)",
                            )
                        break
                    # Recovered. Re-click the review tab so the cursor
                    # API fires for THIS attempt. Best-effort: failures
                    # fall through to cold-start which will time out
                    # cleanly. Don't reset attempt_index — the recovered
                    # state is part of this attempt.
                    reclicker = getattr(
                        session, "reload_and_reopen_review_tab", None,
                    )
                    if reclicker is not None:
                        try:
                            await reclicker()
                        except Exception as e:
                            logger.info(
                                "OY human-check: post-recovery review-tab "
                                "re-click failed (benign): %s", e,
                            )

                # ---- Phase 2E: false-empty pre-check + escalating recovery ----
                # OY occasionally renders a false empty-review state on
                # the review tab during heavy crawling / sort switching,
                # even on products that DO have reviews. Working
                # hypothesis: this is an anti-bot SOFT BLOCK (session-level
                # throttle + state poisoning), not just a slow-render
                # heuristic — short retries against the same page hit the
                # same poisoned state.
                #
                # Recovery escalation:
                #   1. Stepped backoff: per-attempt jittered delay drawn
                #      from FALSE_EMPTY_RETRY_DELAYS_S. First retry waits
                #      ~5–8s, second waits ~10–20s.
                #   2. Strengthened reload: `reload_and_reopen_review_tab`
                #      now closes the poisoned page and opens a fresh
                #      one in the same context (preserves auth, drops
                #      page-instance state) before re-clicking the tab.
                #   3. Final cooldown: when retries are exhausted, sleep
                #      FALSE_EMPTY_FINAL_COOLDOWN_RANGE_S BEFORE marking
                #      the run blocked. Lets the rate-limit window cool
                #      so the multi-sort orchestrator's next sort isn't
                #      torpedoed by the same anti-bot state.
                fe_attempts = 0
                fe_probe_fn = getattr(session, "is_false_empty_state", None)
                fe_recover_fn = getattr(session, "reload_and_reopen_review_tab", None)

                # ---- Positive-signal pre-check (sort settle wait) ----
                # OY's review tab can briefly show the empty-state marker
                # WHILE the cursor API response is still in flight. The
                # `is_false_empty_state` DOM probe doesn't know about
                # the response queue, so it can fire recovery on a page
                # that's actually loading correctly — burning ~70–90s
                # of false-empty handling per attempt.
                #
                # Mitigation: peek the response queue for up to
                # `_post_sort_settle_s` seconds. If anything is there,
                # the response interceptor has already filtered to
                # `_expected_sort_type`, so presence == this sort
                # loaded successfully. Skip false-empty escalation
                # entirely and proceed to cold-start, which will
                # consume the queued response normally.
                #
                # Empty queue after the settle window → fall through
                # to the existing false-empty loop. No regression on
                # the genuine soft-block case.
                positive_signal_fn = getattr(session, "has_pending_response", None)
                wait_state = "no_signal_probe"
                fe_skip_due_to_positive_signal = False
                _settle_t0 = time.monotonic()
                _settle_budget = self._post_sort_settle_s
                if positive_signal_fn is not None and _settle_budget > 0:
                    wait_state = "settle_timeout"
                    while time.monotonic() - _settle_t0 < _settle_budget:
                        try:
                            if await positive_signal_fn():
                                wait_state = "response_received"
                                fe_skip_due_to_positive_signal = True
                                break
                        except Exception:
                            pass
                        try:
                            await asyncio.sleep(0.25)
                        except Exception:
                            break
                _settle_observed_s = time.monotonic() - _settle_t0
                if fe_skip_due_to_positive_signal:
                    logger.info(
                        "OY post-sort settle: response observed for "
                        "expected_sort=%r within %.2fs — skipping "
                        "false-empty probe",
                        self._sort_type, _settle_observed_s,
                    )

                while fe_probe_fn is not None and not fe_skip_due_to_positive_signal:
                    try:
                        is_fe = await fe_probe_fn()
                    except Exception:
                        is_fe = None
                    if is_fe is not True:
                        # False or None ("unknown") → proceed to cold-start
                        break
                    false_empty_state_detected = True
                    if fe_attempts >= self.FALSE_EMPTY_MAX_RETRIES:
                        # Final cooldown before classifying as blocked.
                        # Goal: don't stack against subsequent sorts.
                        cd_lo, cd_hi = self.FALSE_EMPTY_FINAL_COOLDOWN_RANGE_S
                        cooldown = random.uniform(cd_lo, cd_hi)
                        logger.warning(
                            "OY false-empty exhausted (%d retries); "
                            "applying final cooldown %.1fs before marking "
                            "blocked_or_empty_state",
                            self.FALSE_EMPTY_MAX_RETRIES, cooldown,
                        )
                        try:
                            await asyncio.sleep(cooldown)
                        except Exception:
                            pass
                        false_empty_exhausted = True
                        blocked = True
                        _note(
                            f"blocked_or_empty_state: false-empty marker "
                            f"persisted after {self.FALSE_EMPTY_MAX_RETRIES} "
                            f"page-recreate(s); cooled down "
                            f"{cooldown:.1f}s before classifying",
                        )
                        break
                    # Stepped (jittered) backoff for this retry.
                    delays = self.FALSE_EMPTY_RETRY_DELAYS_S
                    # Defensive: if operator overrode delays to fewer
                    # entries than max_retries, fall back to last entry.
                    delay_lo, delay_hi = (
                        delays[fe_attempts] if fe_attempts < len(delays)
                        else delays[-1]
                    )
                    delay = random.uniform(delay_lo, delay_hi)
                    logger.info(
                        "OY false-empty detected (attempt %d/%d); "
                        "sleeping %.1fs before page-recreate",
                        fe_attempts + 1, self.FALSE_EMPTY_MAX_RETRIES, delay,
                    )
                    try:
                        await asyncio.sleep(delay)
                    except Exception:
                        pass
                    if fe_recover_fn is not None:
                        try:
                            await fe_recover_fn()
                        except Exception as e:
                            logger.warning(
                                "OY false-empty recover failed (attempt %d): %s",
                                fe_attempts + 1, e,
                            )
                    fe_attempts += 1
                    false_empty_retry_count += 1
                if false_empty_exhausted:
                    # Terminal — break the outer auth-retry loop too.
                    break

                # ---- Cold start: wait for the first /reviews/cursor hit ----
                first_resp = await session.wait_for_next_response(
                    timeout_s=self._cold_start_timeout_s,
                )
                if first_resp is None:
                    blocked = True
                    cold_start_timed_out = True
                    # Sort-aware diagnostic: when an `expected_sort_type` is
                    # set and at least one response was filtered out by the
                    # sortType filter, the cold-start timeout is almost
                    # certainly because the sort-button click did not take
                    # effect — the page kept firing the page-default sort.
                    # Surface the distinction in sample_dropped_reasons.
                    extra = ""
                    if self._sort_type is not None:
                        try:
                            filt = session.get_responses_filtered_out_by_sort()
                            obs = session.get_observed_sort_types()
                        except Exception:
                            filt = 0
                            obs = {}
                        if filt > 0:
                            extra = (
                                f" (sort-filter dropped {filt} non-matching "
                                f"responses; observed sortTypes={obs}; "
                                f"requested={self._sort_type!r}). "
                                f"Likely the sort-button click did not take "
                                f"effect — the page kept emitting default-sort "
                                f"requests."
                            )
                    _note(
                        f"cold_start_timeout ({self._cold_start_timeout_s:.0f}s)"
                        f"{extra}",
                    )
                    break  # cold-start timeout is non-recoverable here

                status, body = first_resp
                tag = _classify_http_response(status, body)
                if tag == "auth_error":
                    auth_error = True
                    http_401_or_login_required_seen = True
                    where = "retry cold-start" if attempt_index > 0 else "cold start"
                    _note(
                        f"auth_error on {where} "
                        f"(status={status}, loginRequired)",
                    )
                    # Per PR-2 spec: retry only triggers on mid_stream_auth_break.
                    # Cold-start auth (including a retry's cold-start) terminates.
                    break
                elif tag == "blocked":
                    blocked = True
                    if status == 403:
                        http_403_seen = True
                    _note(f"blocked on cold start (HTTP {status})")
                    break
                elif tag == "rate_limited":
                    blocked = True
                    http_429_seen = True
                    _note(f"rate_limited on cold start (HTTP {status})")
                    break
                elif tag == "malformed":
                    parse_warnings += 1
                    _note(f"malformed cold-start response (status={status})")
                    break

                # tag == "ok"
                assert body is not None
                raw_seen += _count_records(body)
                _add_unique(body)
                last_body = body
                # I-OY-STEP5-PROGRESS-INDICATOR — emit a heartbeat for
                # the cold-start ok response. cursor_index is reset per
                # attempt so a retried attempt starts at 1 again; the
                # trace.jsonl carries the cumulative request_index for
                # post-mortem cross-reference.
                cursor_index = 1
                _emit_progress_heartbeat(
                    goods_no=target_goods_no,
                    sort_type=self._sort_type,
                    cursor_index=cursor_index,
                    raw_seen=raw_seen,
                    parsed=len(raws),
                    filtered=filter_telemetry_total["filtered_by_goods_no"],
                    has_next=_extract_has_next(body),
                    elapsed_s=(datetime.now() - started).total_seconds(),
                )

                # ---- Continuation loop: scroll → wait → parse ----
                malformed_streak = 0
                while not _should_stop_pagination(
                    last_body, len(raws), params.max_results,
                ):
                    next_resp = None
                    for _ in range(self._max_scroll_attempts):
                        await session.scroll_for_next()
                        next_resp = await session.wait_for_next_response(
                            timeout_s=self._page_n_timeout_s,
                        )
                        if next_resp is not None:
                            break
                    if next_resp is None:
                        # I-OY-SCROLL-CONTINUATION-IMPL — the per-page scroll
                        # budget is exhausted. Before declaring this a final
                        # terminus, check whether the server still says there
                        # is more (`hasNext=True`) AND we have recovery budget
                        # left. If so, page-recreate and re-enter continuation
                        # with the existing seen_ids dedup carrying the prefix
                        # forward. Without `hasNext=True` we fall through to
                        # the legacy break — there is no point recreating just
                        # to rediscover the same end-of-stream.
                        recovery_budget = self._max_scroll_recovery_recreates
                        last_has_next_for_recovery = _extract_has_next(last_body)
                        if (
                            recovery_budget > 0
                            and scroll_continuation_recovery_attempts
                            < recovery_budget
                            and last_has_next_for_recovery is True
                        ):
                            recreate_fn = getattr(
                                session, "reload_and_reopen_review_tab", None,
                            )
                            if recreate_fn is None:
                                # Session doesn't expose the recovery primitive
                                # (legacy fakes); preserve the historical
                                # terminus message and break out cleanly.
                                _note(
                                    f"no continuation after "
                                    f"{self._max_scroll_attempts} scroll attempts",
                                )
                                break
                            scroll_continuation_recovery_attempts += 1
                            _note(
                                f"scroll_continuation_recovery: attempt "
                                f"{scroll_continuation_recovery_attempts}/"
                                f"{recovery_budget} — page-recreate after "
                                f"{self._max_scroll_attempts} failed scrolls "
                                f"(parsed={len(raws)})",
                            )

                            # I-OY-RECOVERY-POST-CLICK-RESPONSE-CAPTURE —
                            # tiny helper closure that emits the
                            # end-of-recovery-window summary log line
                            # and flips the session's diagnostic flag
                            # back to False. Called at EVERY exit from
                            # the recovery block (recreate raise, wait
                            # raise, cold-start timeout, malformed
                            # post-recreate response, AND on the
                            # successful continuation path before the
                            # outer `continue`). Best-effort: each step
                            # is wrapped in try/except so a session
                            # type that doesn't expose the counters
                            # (legacy fakes) cannot break the recovery
                            # path. This helper does NOT itself change
                            # any behavior — it only logs + clears the
                            # flag the listener reads to decide whether
                            # to emit per-response probe lines.
                            def _close_post_recovery_diag() -> None:
                                try:
                                    probes = getattr(
                                        session,
                                        "_post_recovery_response_probe_count",
                                        0,
                                    )
                                    accepted = getattr(
                                        session,
                                        "_post_recovery_response_accepted_count",
                                        0,
                                    )
                                    sort_mismatch = getattr(
                                        session,
                                        "_post_recovery_response_sort_mismatch_count",
                                        0,
                                    )
                                    parse_error = getattr(
                                        session,
                                        "_post_recovery_response_parse_error_count",
                                        0,
                                    )
                                    logger.info(
                                        "OY recovery response timeout "
                                        "summary: probes=%d accepted=%d "
                                        "sort_mismatch=%d parse_error=%d",
                                        int(probes),
                                        int(accepted),
                                        int(sort_mismatch),
                                        int(parse_error),
                                    )
                                except Exception:
                                    pass
                                try:
                                    setattr(
                                        session,
                                        "_diagnose_post_recovery_responses",
                                        False,
                                    )
                                except Exception:
                                    pass
                                # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG —
                                # clear the page-state probe flag at
                                # the same window-exit points as the
                                # response probe flag. Both share the
                                # recovery-window scope.
                                try:
                                    setattr(
                                        session,
                                        "_diagnose_post_recreate_page_state",
                                        False,
                                    )
                                except Exception:
                                    pass

                            try:
                                # Stepped backoff before recreate (jittered).
                                # Mirrors the existing anti-bot recovery
                                # cadence — never shorter than the
                                # false-empty path uses.
                                await asyncio.sleep(
                                    random.uniform(2.0, 5.0),
                                )
                                # I-OY-RECOVERY-POST-CLICK-RESPONSE-CAPTURE —
                                # enable per-response probe logging on
                                # the session BEFORE the recreate
                                # cascade runs. The cascade's scoped
                                # click fires the post-recovery cursor
                                # request; the response handler reads
                                # this flag by attribute lookup at each
                                # event, so the change takes effect
                                # without re-attaching the handler.
                                try:
                                    setattr(
                                        session,
                                        "_diagnose_post_recovery_responses",
                                        True,
                                    )
                                except Exception:
                                    pass
                                # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG —
                                # enable the page-state probe alongside
                                # the response probe. The recovery
                                # primitive and the shared cascade read
                                # this flag by attribute lookup so the
                                # change takes effect immediately. The
                                # two flags share the recovery-window
                                # scope; they are flipped together to
                                # keep diagnostic-window semantics
                                # consistent.
                                try:
                                    setattr(
                                        session,
                                        "_diagnose_post_recreate_page_state",
                                        True,
                                    )
                                except Exception:
                                    pass
                                await recreate_fn()
                            except Exception as e:
                                logger.warning(
                                    "OY scroll_continuation_recovery: "
                                    "recreate raised (%s); abandoning",
                                    e,
                                )
                                _note(
                                    f"scroll_continuation_recovery: recreate "
                                    f"raised ({type(e).__name__}); abandoning",
                                )
                                scroll_continuation_terminated_with_has_next = (
                                    True
                                )
                                _close_post_recovery_diag()
                                break
                            # I-OY-RECOVERY-RECREATE-STRATEGY-REVISION —
                            # read the session's strategy flag and emit
                            # narrow `_note` entries describing whether
                            # the new reload-first path ran (Option A),
                            # whether it succeeded, and whether control
                            # fell through to the historical recreate.
                            # The Ilso A000000225736 live proof
                            # (`O-OY-SCROLL-RECOVERY-WAIT-LIVE-PROOF-ILSO`)
                            # showed close+new_page+goto producing a
                            # page that never re-mounts the review-tab
                            # DOM; reload-first preserves the page
                            # object that had successfully served 49
                            # cursors before the wedge, and only the
                            # document gets reset. These notes precede
                            # the existing re-arm note so that on the
                            # `reload_succeeded` path the post-mortem
                            # can confirm the new path actually ran.
                            try:
                                strategy_getter = getattr(
                                    session,
                                    "get_post_recreate_strategy_used",
                                    None,
                                )
                                strategy_used = (
                                    strategy_getter()
                                    if strategy_getter is not None
                                    else None
                                )
                            except Exception:
                                strategy_used = None
                            if strategy_used in (
                                "reload_succeeded",
                                "reload_failed_recreate_fallback",
                            ):
                                _note(
                                    "scroll_continuation_recovery: "
                                    "retrying via page.reload before recreate",
                                )
                            if strategy_used == "reload_failed_recreate_fallback":
                                _note(
                                    "scroll_continuation_recovery: reload "
                                    "strategy failed; falling back to recreate",
                                )
                            # I-OY-SCROLL-RECOVERY-COLD-START-REARM —
                            # narrow diagnostic so the next post-mortem
                            # can confirm the recreate path actually
                            # re-armed the listener + sort + trigger
                            # pipeline (vs the legacy passive-wait
                            # behavior that produced the
                            # `post-recreate cold-start timed out`
                            # symptom on Ilso A000000225736). Still
                            # emitted on the reload-first success path
                            # because the shared cascade re-fires the
                            # trigger + sort on the reloaded page
                            # (the listener was already installed by
                            # `open()` and persists across reload).
                            _note(
                                "scroll_continuation_recovery: re-armed "
                                "listener+sort+trigger; awaiting first response",
                            )
                            # I-OY-RECOVERY-WAIT-FOR-REVIEW-TAB-RENDER —
                            # read the session's tri-state readiness
                            # signal and emit a narrow `_note` when the
                            # post-recreate sort-area wait deadlined.
                            # Only the "not ready" case is noted — the
                            # ready case is implicit (cold-start
                            # observation that follows will succeed or
                            # produce its own diagnostic). Skipping the
                            # ready note keeps `sample_dropped_reasons`
                            # under the 5-entry cap even in the worst-
                            # case recovery scenarios. `None` means the
                            # session didn't reach the readiness wait
                            # (early-return before step 7) — no note in
                            # that case.
                            try:
                                sort_area_ready_getter = getattr(
                                    session,
                                    "get_post_recreate_sort_area_ready",
                                    None,
                                )
                                sort_area_ready = (
                                    sort_area_ready_getter()
                                    if sort_area_ready_getter is not None
                                    else None
                                )
                            except Exception:
                                sort_area_ready = None
                            if sort_area_ready is False:
                                _note(
                                    "scroll_continuation_recovery: review "
                                    "sort area not ready after recreate",
                                )
                            # Wait for the post-recreate cold-start to
                                # land. Use the cold-start timeout — the
                                # fresh mount fires its own initial cursor
                                # request and we treat it the same as a
                                # cold-start.
                            try:
                                first_resp = await session.wait_for_next_response(
                                    timeout_s=self._cold_start_timeout_s,
                                )
                            except Exception as e:
                                logger.warning(
                                    "OY scroll_continuation_recovery: "
                                    "post-recreate wait raised (%s); abandoning",
                                    e,
                                )
                                scroll_continuation_terminated_with_has_next = (
                                    True
                                )
                                _close_post_recovery_diag()
                                break
                            if first_resp is None:
                                _note(
                                    "scroll_continuation_recovery: post-"
                                    "recreate cold-start timed out; abandoning",
                                )
                                scroll_continuation_terminated_with_has_next = (
                                    True
                                )
                                _close_post_recovery_diag()
                                break
                            r_status, r_body = first_resp
                            r_tag = _classify_http_response(r_status, r_body)
                            if r_tag != "ok" or r_body is None:
                                _note(
                                    f"scroll_continuation_recovery: post-"
                                    f"recreate first response tag={r_tag}; "
                                    f"abandoning",
                                )
                                scroll_continuation_terminated_with_has_next = (
                                    True
                                )
                                _close_post_recovery_diag()
                                break
                            # Successful recreate cold-start. Account it as
                            # an ok response: the seen_ids dedup set ensures
                            # already-collected rows do not double-count.
                            raw_seen += _count_records(r_body)
                            pre_dedup = len(raws)
                            _add_unique(r_body)
                            last_body = r_body
                            if len(raws) > pre_dedup:
                                scroll_continuation_recovery_recovered = True
                            cursor_index += 1
                            _emit_progress_heartbeat(
                                goods_no=target_goods_no,
                                sort_type=self._sort_type,
                                cursor_index=cursor_index,
                                raw_seen=raw_seen,
                                parsed=len(raws),
                                filtered=filter_telemetry_total[
                                    "filtered_by_goods_no"
                                ],
                                has_next=_extract_has_next(r_body),
                                elapsed_s=(
                                    datetime.now() - started
                                ).total_seconds(),
                            )
                            _close_post_recovery_diag()
                            continue  # back to the outer while; scroll resumes
                        # No recovery (budget exhausted, hasNext is not
                        # True, or recovery disabled). Preserve the
                        # historical terminus text — operators / log
                        # readers depend on it. Mark the distinct
                        # has-next terminus condition when applicable.
                        if (
                            last_has_next_for_recovery is True
                            and scroll_continuation_recovery_attempts
                            >= recovery_budget
                        ):
                            scroll_continuation_terminated_with_has_next = True
                        _note(
                            f"no continuation after "
                            f"{self._max_scroll_attempts} scroll attempts "
                            f"(recovery_attempts="
                            f"{scroll_continuation_recovery_attempts})",
                        )
                        break

                    status, cont_body = next_resp
                    tag = _classify_http_response(status, cont_body)
                    if tag == "auth_error":
                        # Defer setting summary.auth_error to the retry decision —
                        # if a retry recovers, the final state is auth_error=False.
                        # mid_stream_auth_break and http_401_or_login_required_seen
                        # are FACTS about what was observed, set immediately.
                        http_401_or_login_required_seen = True
                        mid_stream_auth_break = True
                        attempt_hit_mid_stream_auth = True
                        _note(f"auth_error mid-stream (status={status})")
                        break
                    if tag == "blocked":
                        blocked = True
                        if status == 403:
                            http_403_seen = True
                        _note(f"blocked mid-stream (HTTP {status})")
                        break
                    if tag == "rate_limited":
                        blocked = True
                        http_429_seen = True
                        _note(f"rate_limited mid-stream (HTTP {status})")
                        break
                    if tag == "malformed":
                        parse_warnings += 1
                        malformed_streak += 1
                        if malformed_streak >= _MAX_MALFORMED_STREAK:
                            _note(
                                f"{_MAX_MALFORMED_STREAK} consecutive "
                                f"malformed responses; stopping",
                            )
                            break
                        continue

                    # ok
                    malformed_streak = 0
                    assert cont_body is not None
                    raw_seen += _count_records(cont_body)
                    _add_unique(cont_body)
                    last_body = cont_body
                    # I-OY-STEP5-PROGRESS-INDICATOR — heartbeat per
                    # ok continuation response. One line per response
                    # is fine: signal sorts cap at ~50 responses;
                    # DATETIME_DESC tops out around ~226 for a 14-min
                    # crawl (one line per ~4s, ops-tolerable). See
                    # ticket notes for the false-wedge rationale.
                    cursor_index += 1
                    _emit_progress_heartbeat(
                        goods_no=target_goods_no,
                        sort_type=self._sort_type,
                        cursor_index=cursor_index,
                        raw_seen=raw_seen,
                        parsed=len(raws),
                        filtered=filter_telemetry_total["filtered_by_goods_no"],
                        has_next=_extract_has_next(cont_body),
                        elapsed_s=(datetime.now() - started).total_seconds(),
                    )
                else:
                    # Loop exited via _should_stop_pagination — distinguish
                    # quota-stop from clean-end-of-stream. Only the latter
                    # is "pagination_exhausted" in the explicit sense.
                    if (
                        last_body is not None
                        and _extract_has_next(last_body) is False
                    ):
                        pagination_exhausted_clean = True

                # ---- Decide retry on mid-stream auth break only ----
                if attempt_hit_mid_stream_auth:
                    if auth_retry_attempts_used < self._auth_retry:
                        # PR-4: drain the about-to-be-discarded session's
                        # request log so attempt N's trace survives the
                        # session rebuild. Each entry tagged with
                        # attempt_index for downstream correlation.
                        try:
                            for _entry in session.get_request_log():
                                trace_records.append(
                                    {"attempt_index": attempt_index, **_entry},
                                )
                        except Exception as e:
                            logger.warning(
                                "OY browser: get_request_log failed during retry: %s",
                                e,
                            )
                        # Recovery attempt: close current session, build new,
                        # re-open URL, restart cold-start. Quota and seen_ids
                        # carry forward.
                        try:
                            await session.close()
                        except Exception as e:
                            logger.warning(
                                "OY browser session close failed (pre-retry): %s",
                                e,
                            )
                        session = self._build_session()
                        auth_retry_attempts_used += 1
                        attempt_index += 1
                        continue  # outer retry loop
                    else:
                        # Retry budget exhausted (or auth_retry==0). Final state
                        # is auth-blocked.
                        auth_error = True
                        break
                else:
                    # All other outcomes (natural end / blocked / rate_limited /
                    # malformed_streak / no_continuation) are terminal.
                    break
        finally:
            # PR-4: drain the FINAL session's request log into trace_records.
            # Covers all paths that exit the outer while via break — both
            # cold-start failures (session has 0 or 1 entries) and
            # retry-exhaustion / natural-end (session has up to N entries).
            # Earlier attempts' logs were drained at retry-rebuild time.
            try:
                for _entry in session.get_request_log():
                    trace_records.append(
                        {"attempt_index": attempt_index, **_entry},
                    )
            except Exception as e:
                logger.warning(
                    "OY browser: get_request_log failed in finally: %s", e,
                )
            # Drain the final session's sort-button label inventory for
            # the diagnostic field. Best-effort — fakes/legacy sessions
            # may not implement the getter.
            try:
                _labels_fn = getattr(session, "get_seen_sort_labels", None)
                if _labels_fn is not None:
                    available_sort_button_labels = list(_labels_fn())
            except Exception as e:
                logger.debug(
                    "OY browser: get_seen_sort_labels failed in finally: %s", e,
                )
            # Drain the sort-control-unreachable terminal flag. Same
            # best-effort contract — older fakes / external session
            # impls may not expose the getter.
            try:
                _unreachable_fn = getattr(
                    session, "get_sort_control_unreachable", None,
                )
                if _unreachable_fn is not None:
                    sort_control_unreachable_observed = bool(
                        _unreachable_fn(),
                    )
            except Exception as e:
                logger.debug(
                    "OY browser: get_sort_control_unreachable failed in "
                    "finally: %s", e,
                )
            try:
                await session.close()
            except Exception as e:
                logger.warning("OY browser session close failed: %s", e)

        # Truncate to quota (parser returns full pages; we trim once at the end).
        if len(raws) > params.max_results:
            raws = raws[: params.max_results]

        # Post-condition visibility: if the final OK body advertised more data
        # (`hasNext=True`) but the loop terminated below the quota, something
        # upstream swallowed the continuation (scroll-exhaustion, malformed
        # streak, blocked/auth mid-stream). The blocked/auth flags already
        # catch the error cases, but the scroll-timeout and malformed-streak
        # cases otherwise look like clean completions. Log + note explicitly.
        last_has_next = _extract_has_next(last_body)
        incomplete_collection = False
        if last_has_next is True and len(raws) < params.max_results:
            incomplete_collection = True
            incomplete_msg = (
                f"incomplete_collection: hasNext=True on last parsed body "
                f"(parsed={len(raws)}, quota={params.max_results}); "
                f"continuation not captured"
            )
            logger.warning(
                "OY browser: %s url=%s", incomplete_msg, self._product_url,
            )
            _note(incomplete_msg)

        # PR-2: auth_retry_exhausted is True iff retry was attempted (budget>0
        # and at least one attempt used) AND the final state is still auth-
        # blocked. With auth_retry=0, this is always False (matching PR-1).
        auth_retry_exhausted = bool(auth_error and auth_retry_attempts_used > 0)

        # ---- PR-4: derive cursor_sequence + failed_at_request_index from trace_records ----
        # Walk every captured API call (across all attempts) in order.
        # cursor_sequence = list of next_cursor_id values from successful (ok)
        # responses. last_known_cursor = the last non-None cursor seen.
        # failed_at_request_index = 1-based index of the first non-ok response
        # across the whole run; None if every response was ok.
        # Also tally observed sortTypes across the whole run for the
        # sort-aware crawl summary.
        observed_sort_types_total: dict[str, int] = {}
        responses_filtered_out_by_sort_total: int = 0
        for _i, _entry in enumerate(trace_records, start=1):
            resp = _entry.get("response", {}) or {}
            tag = resp.get("tag")
            if tag == "ok":
                nc = resp.get("next_cursor_id")
                if nc is not None:
                    cursor_sequence.append(nc)
                    last_known_cursor = nc
            else:
                if failed_at_request_index is None:
                    failed_at_request_index = _i
            req = _entry.get("request", {}) or {}
            st = req.get("post_data_sort_type")
            if isinstance(st, str):
                observed_sort_types_total[st] = (
                    observed_sort_types_total.get(st, 0) + 1
                )
            if _entry.get("forwarded_to_queue") is False:
                responses_filtered_out_by_sort_total += 1
        review_api_request_count = len(trace_records)
        review_api_response_count = len(trace_records)  # 1:1 — every captured request had a response observation

        self.last_run_summary = ConnectorRunSummary(
            run_id=run_id,
            channel="oliveyoung",
            requested_target=self._product_url,
            started_at=started,
            finished_at=datetime.now(),
            raw_records_seen=raw_seen,
            records_parsed=len(raws),
            records_dropped_short_text=0,  # parser drops are silent in Layer A
            records_dropped_unparseable_date=0,
            parse_warnings=parse_warnings,
            blocked=blocked,
            auth_error=auth_error,
            sample_dropped_reasons=sample_dropped,
            # ---- PR-1 distinct telemetry ----
            cold_start_timed_out=cold_start_timed_out,
            http_403_seen=http_403_seen,
            http_429_seen=http_429_seen,
            http_401_or_login_required_seen=http_401_or_login_required_seen,
            mid_stream_auth_break=mid_stream_auth_break,
            incomplete_collection=incomplete_collection,
            pagination_exhausted=pagination_exhausted_clean,
            last_observed_has_next=last_has_next,
            # ---- PR-2 retry telemetry ----
            auth_retry_attempts_used=auth_retry_attempts_used,
            auth_retry_exhausted=auth_retry_exhausted,
            # partial_debug_artifact_path is set below if/when we write it
            # ---- PR-4 request-side / cursor telemetry ----
            review_api_request_count=review_api_request_count,
            review_api_response_count=review_api_response_count,
            cursor_sequence=cursor_sequence,
            last_known_cursor=last_known_cursor,
            failed_at_request_index=failed_at_request_index,
            login_state_observed=login_state_observed,
            # trace_artifact_path is set below if/when we write it
            # ---- Phase 2E sort-aware crawl telemetry ----
            requested_sort_type=self._sort_type,
            observed_sort_types=observed_sort_types_total,
            responses_filtered_out_by_sort=responses_filtered_out_by_sort_total,
            available_sort_button_labels=available_sort_button_labels,
            # ---- Phase 2E false-empty recovery telemetry ----
            false_empty_state_detected=false_empty_state_detected,
            false_empty_retry_count=false_empty_retry_count,
            # ---- Phase 2E sort-control-unreachable terminal flag ----
            sort_control_unreachable=sort_control_unreachable_observed,
            # ---- Human-check (anti-bot CAPTCHA) telemetry ----
            human_check_detected=human_check_detected,
            human_check_waited_seconds=human_check_waited_s,
            human_check_recovered=human_check_recovered,
            human_check_recovery_action=human_check_action,
            # ---- Lazy-load trigger cascade telemetry ----
            review_more_button_clicked=bool(
                getattr(session, "_review_more_button_clicked", False),
            ),
            scrolled_to_review_area=bool(
                getattr(session, "_scrolled_to_review_area", False),
            ),
            # ---- Goods-number filter telemetry ----
            raw_records_seen_total_before_filter=int(
                filter_telemetry_total["total_before_filter"],
            ),
            rows_kept_after_goods_no_filter=int(
                filter_telemetry_total["kept_after_goods_no_filter"],
            ),
            rows_filtered_by_goods_no=int(
                filter_telemetry_total["filtered_by_goods_no"],
            ),
            rows_dropped_unparseable=int(
                filter_telemetry_total["dropped_unparseable"],
            ),
            # ---- I-OY-SCROLL-CONTINUATION-IMPL telemetry ----
            scroll_continuation_recovery_attempts=int(
                scroll_continuation_recovery_attempts,
            ),
            scroll_continuation_recovery_recovered=bool(
                scroll_continuation_recovery_recovered,
            ),
            scroll_continuation_terminated_with_has_next=bool(
                scroll_continuation_terminated_with_has_next,
            ),
            cursor_depth_at_termination=len(cursor_sequence),
            max_scroll_attempts_per_page=int(self._max_scroll_attempts),
            max_scroll_recovery_recreates=int(
                self._max_scroll_recovery_recreates,
            ),
            # ---- I-OY-OPEN-HANDSHAKE-TIMEOUT ----
            # When `asyncio.wait_for(session.open(...))` fired its
            # TimeoutError, surface it as `page_open_failed=True` so
            # `classify_status()` routes the failure to the existing
            # `page_open_failed` bucket (preceded by `cdp_attach_failed`
            # in priority order; both fire BEFORE the
            # `blocked / anti_bot` branch). This guarantees the
            # operator-required "do not misclassify as anti_bot or
            # max_cap_reached" semantics without inventing a new status
            # code. The verbatim diagnostic string is mirrored into
            # `page_open_error` for operator inspection.
            page_open_failed=bool(open_handshake_timed_out),
            page_open_error=open_handshake_error,
        )

        # ---- Per-sort structured INFO log ----
        # One line per attempt with the operator-facing diagnostic
        # fields requested for multi-sort transition debugging.
        # `wait_state` is the new positive-signal probe outcome
        # (response_received | settle_timeout | no_signal_probe);
        # `recovery_action` summarizes the path that resolved the
        # attempt; `final_status` is the pipeline-facing status.
        try:
            # Precedence: human_check verbs win when present, since
            # those are the operator-actionable signal. Otherwise
            # fall back to the false-empty path verbs.
            if human_check_action and human_check_action != "not_detected":
                if human_check_recovered:
                    recovery_action = "human_check_recovered"
                else:
                    recovery_action = (
                        "human_check_failed_on_timeout"
                        if self._fail_on_human_check_timeout
                        else "human_check_skipped"
                    )
            else:
                recovery_action = (
                    "false_empty_recovered"
                    if false_empty_retry_count > 0 and not false_empty_exhausted
                    else (
                        "false_empty_exhausted"
                        if false_empty_exhausted
                        else "none"
                    )
                )
            logger.info(
                "OY per-sort summary: sort_type=%r wait_state=%r "
                "settle_observed_s=%.2f review_count_seen=%d "
                "false_empty_detected=%s false_empty_retry_count=%d "
                "human_check_detected=%s human_check_waited_s=%d "
                "human_check_recovered=%s "
                "recovery_action=%r final_status=%r",
                self._sort_type,
                # `wait_state` defined in the false-empty pre-check block;
                # may be missing if open() never reached that block (e.g.
                # auth wall before sort click). Fall back to the literal.
                locals().get("wait_state", "no_signal_probe"),
                locals().get("_settle_observed_s", 0.0),
                review_api_response_count,
                false_empty_state_detected,
                false_empty_retry_count,
                human_check_detected,
                human_check_waited_s,
                human_check_recovered,
                recovery_action,
                "blocked" if blocked else (
                    "ok" if review_api_response_count > 0 else "no_data"
                ),
            )
        except Exception as exc:  # logging must never raise
            logger.debug("OY per-sort summary log skipped (benign): %s", exc)

        # ---- Phase 2E total-review-count capture (additive) ----
        # Best-effort metadata for downstream coverage_ratio /
        # confidence_level. Reads via getattr so test fakes that don't
        # implement the accessor degrade safely to None. NEVER raises;
        # NEVER blocks scraping behavior or quality gates.
        try:
            getter = getattr(
                session, "get_observed_total_review_count", None,
            )
            if callable(getter):
                total = getter()
                if isinstance(total, int) and total > 0:
                    self.last_run_summary.total_review_count_available = total
        except Exception as e:
            logger.debug(
                "OY total-review-count read skipped (benign): %s", e,
            )

        # ---- v2.4.3 product-image-URL capture (additive) ----
        # Pulled from og:image / JSON-LD during the warm session's
        # initial page.goto, BEFORE the review-tab click. Surfaced
        # here so the pipeline-start product metadata collector can
        # skip its standalone HTTP detail-page fetch (anti-bot
        # avoidance). Reads via getattr so non-Playwright sessions
        # (test fakes, future CSV-shaped connectors) degrade silently
        # to None. NEVER raises; NEVER blocks scraping or gates.
        try:
            img_getter = getattr(
                session, "get_observed_product_image_url", None,
            )
            if callable(img_getter):
                img_url = img_getter()
                if isinstance(img_url, str) and img_url.strip():
                    self.last_run_summary.product_image_url = img_url
        except Exception as e:
            logger.debug(
                "OY product-image-URL read skipped (benign): %s", e,
            )

        # ---- v2.4.4 image-capture diagnostic + CDP/UA telemetry ----
        # Stamps the per-source counts from the HTML extractor + the
        # page URL at capture time so the operator can audit "where
        # did the chain break?" without reproducing the run. Also
        # records whether the session connected via CDP (the operator's
        # already-warm Chrome) or launched a fresh browser — a fresh
        # launch is far more likely to hit anti-bot, which is exactly
        # the failure mode we want to make visible.
        #
        # v2.4.5 — also records the session lifecycle flags
        # (open_called, capture_hook_reached) and the session-identity
        # fingerprint so we can prove the session whose diagnostic we
        # read is the SAME session that ran open(). When they differ
        # there's an orchestration bug.
        try:
            diag_getter = getattr(
                session, "get_product_image_capture_diagnostic", None,
            )
            if callable(diag_getter):
                d = diag_getter()
                if isinstance(d, dict):
                    s = self.last_run_summary
                    s.product_image_capture_attempted = bool(d.get("attempted"))
                    s.product_image_capture_page_url = d.get("page_url")
                    s.product_image_capture_html_length = d.get("html_length")
                    s.product_image_capture_og_count = int(d.get("og_count") or 0)
                    s.product_image_capture_jsonld_count = int(d.get("jsonld_count") or 0)
                    s.product_image_capture_twitter_count = int(d.get("twitter_count") or 0)
                    s.product_image_capture_link_image_src_count = int(
                        d.get("link_image_src_count") or 0,
                    )
                    s.product_image_capture_oy_thumbnail_img_count = int(
                        d.get("oy_thumbnail_img_count") or 0,
                    )
                    s.product_image_capture_selected_source = d.get("selected_source")
                    s.product_image_capture_error = d.get("error")
                    # v2.4.5 — session lifecycle + identity.
                    s.product_image_session_id = d.get("session_id")
                    s.product_image_session_class = d.get("session_class")
                    s.product_image_session_open_called = bool(
                        d.get("session_open_called"),
                    )
                    s.product_image_session_open_url_at_start = d.get(
                        "session_open_url_at_start",
                    )
                    s.product_image_capture_hook_reached = bool(
                        d.get("capture_hook_reached"),
                    )
                    s.product_image_session_received_cdp_endpoint = d.get(
                        "session_received_cdp_endpoint",
                    )
                # diagnostic_session_id is `id(session)` taken at the
                # MOMENT we're reading — this is what the connector
                # sees, while `product_image_session_id` is what the
                # session itself recorded. They MUST match. If they
                # don't, the orchestrator handed us the wrong session.
                self.last_run_summary.product_image_diagnostic_session_id = id(session)
        except Exception as e:
            logger.debug(
                "OY product-image diagnostic read skipped (benign): %s", e,
            )
        # v2.4.5 — what the CONNECTOR was constructed with (audit
        # input). Pipeline / batch can compare against the manifest's
        # value to confirm the cdp_endpoint flowed all the way through.
        self.last_run_summary.requested_cdp_endpoint = self._cdp_endpoint
        self.last_run_summary.connector_received_cdp_endpoint = self._cdp_endpoint
        # CDP / UA telemetry. Read defensively — older sessions may
        # not expose these; in that case the fields stay at default.
        try:
            cdp = getattr(session, "_cdp_endpoint", None)
            if isinstance(cdp, str) and cdp:
                self.last_run_summary.cdp_endpoint_used = cdp
                self.last_run_summary.connected_via_cdp = True
            ua = getattr(session, "_user_agent", None)
            if isinstance(ua, str) and ua:
                self.last_run_summary.browser_user_agent = ua
        except Exception as e:
            logger.debug(
                "OY CDP/UA telemetry read skipped (benign): %s", e,
            )

        # ---- Phase 2E breadcrumb / category capture (additive) ----
        # Stamp every parsed RawReview's raw_metadata with the
        # session-captured breadcrumb so downstream persistence
        # (phase1_reviews.raw_metadata_json) carries the four
        # category fields per row. Read via getattr so test fakes
        # without the accessor degrade silently to "no breadcrumb".
        # Per-row stamp (rather than separate product table) matches
        # the existing oy_goods_name / oy_item_number denormalization
        # pattern. NEVER raises — breadcrumb is best-effort metadata,
        # absence MUST NOT block the scrape.
        try:
            bc_getter = getattr(session, "get_observed_breadcrumb", None)
            if callable(bc_getter):
                breadcrumb = bc_getter()
                if (
                    isinstance(breadcrumb, dict)
                    and breadcrumb.get("path")
                    and isinstance(breadcrumb["path"], list)
                ):
                    for r in raws:
                        r.raw_metadata["oy_breadcrumb_ko"] = breadcrumb.get("ko")
                        r.raw_metadata["oy_category_path"] = list(breadcrumb["path"])
                        r.raw_metadata["oy_category_leaf_ko"] = breadcrumb.get("leaf_ko")
                        r.raw_metadata["oy_breadcrumb_source"] = breadcrumb.get("source")
        except Exception as e:
            logger.debug(
                "OY breadcrumb read/stamp skipped (benign): %s", e,
            )

        # ---- PR-2: write partial-rows debug artifact (opt-in only) ----
        # NEVER writes to phase1_reviews. The artifact is purely for offline
        # diagnosis when the quality gate would discard the parsed rows.
        if (
            self._capture_partial_on_invalid
            and self._debug_dir is not None
            and (blocked or auth_error or incomplete_collection)
            and raws
        ):
            try:
                artifact_path = self._write_partial_artifact(
                    run_id=run_id, raws=raws, collected_at=started,
                )
                self.last_run_summary.partial_debug_artifact_path = str(artifact_path)
            except Exception as e:
                # Artifact write failure must NEVER mask the run summary.
                logger.warning(
                    "OY browser: partial-artifact write failed (run_id=%s): %s",
                    run_id, e,
                )

        # ---- PR-4: write request/response trace JSONL (always-on with --debug-dir) ----
        # Lands whenever the operator supplied a debug_dir, regardless of
        # quality_status. Cookies / authorization headers are redacted at
        # capture time (`_redact_request_headers`); the trace file contains
        # only safe-list headers verbatim plus presence-booleans.
        if self._debug_dir is not None and trace_records:
            try:
                trace_path = self._write_trace_artifact(
                    run_id=run_id, trace_records=trace_records,
                )
                self.last_run_summary.trace_artifact_path = str(trace_path)
            except Exception as e:
                logger.warning(
                    "OY browser: trace-artifact write failed (run_id=%s): %s",
                    run_id, e,
                )

        # Populate the per-run review_id list using the same hash that
        # the normalizer applies on its way to phase1_reviews.review_id.
        # This is the value the membership tracker needs to look up rows.
        # Local import keeps the module-level deps unchanged for callers
        # that only use the parser-level helpers.
        from src.voc.ingestion.normalizer import generate_review_id as _gen_rid
        self.last_collected_review_ids = [
            _gen_rid(r.source_channel, r.source_id)
            for r in raws
            if r.source_id
        ]

        logger.info(
            "OY browser: parsed=%d seen=%d warn=%d blocked=%s auth_error=%s "
            "retry_used=%d retry_exhausted=%s url=%s",
            len(raws), raw_seen, parse_warnings, blocked, auth_error,
            auth_retry_attempts_used, auth_retry_exhausted, self._product_url,
        )
        return raws

    async def _wait_for_human_check(
        self,
        session: BrowserReviewSession,
    ) -> "tuple[bool, int, bool, str]":
        """Poll `session.is_interstitial_state` until the page clears
        the CAPTCHA / login wall, or until `_human_check_timeout_s`
        expires.

        Returns `(detected, waited_seconds, recovered, action)`:
          - `detected=False`  — no interstitial marker on first probe.
            `(False, 0, False, "not_detected")`.
          - `recovered=True`  — interstitial cleared within timeout.
            `action="recovered"`.
          - `recovered=False, fail_on_human_check_timeout=False`  →
            `action="skipped_on_timeout"` (caller marks this sort
            partial, continues to the next sort).
          - `recovered=False, fail_on_human_check_timeout=True`   →
            `action="failed_on_timeout"` (caller marks this sort
            blocked).

        Sessions whose probe accessor is missing OR returns None on
        first call (DOM unavailable) report `(False, 0, False,
        "not_detected")` — defensive: never block the run on a
        probe-side error.

        Operator banner is printed exactly once (on the first
        positive detection) so log output stays tidy across multiple
        polls. `logger.info` records subsequent state transitions.
        """
        probe_fn = getattr(session, "is_interstitial_state", None)
        if probe_fn is None:
            return False, 0, False, "not_detected"
        try:
            initial = await probe_fn()
        except Exception:
            initial = None
        if initial is not True:
            return False, 0, False, "not_detected"

        # Operator-visible banner. Use print() so it lands on stdout
        # even when log capture is configured to drop INFO. The
        # message is intentionally terse — operators monitoring a
        # multi-sort run should be able to scan many of these.
        # `human_check_timeout_s == 0` is the indefinite-wait
        # contract (operator-driven manual runs). The loop runs
        # forever until the probe transitions to False or a
        # KeyboardInterrupt / asyncio cancellation propagates out.
        # That is the only stop condition — there is no deadline,
        # so `_fail_on_human_check_timeout` cannot fire.
        indefinite = self._human_check_timeout_s == 0
        print(
            "Human check detected. Please solve it in Chrome. Waiting...",
            flush=True,
        )
        if indefinite:
            logger.warning(
                "OY human-check: interstitial detected for sort=%r; polling "
                "every %.1fs (indefinite — Ctrl+C to abort)",
                self._sort_type, self._human_check_poll_s,
            )
        else:
            logger.warning(
                "OY human-check: interstitial detected for sort=%r; polling "
                "every %.1fs up to %.0fs",
                self._sort_type, self._human_check_poll_s,
                self._human_check_timeout_s,
            )

        start = time.monotonic()
        deadline = (
            None if indefinite else start + self._human_check_timeout_s
        )
        # Sleep a tiny bit between probes so the loop never
        # hot-spins even with poll_s=0 (defended at __init__ but
        # belt-and-braces here).
        poll_s = max(0.5, self._human_check_poll_s)
        while True:
            now = time.monotonic()
            if deadline is not None and now >= deadline:
                break
            if deadline is None:
                sleep_for = poll_s
            else:
                sleep_for = min(poll_s, max(0.0, deadline - now))
            try:
                await asyncio.sleep(sleep_for)
            except asyncio.CancelledError:
                # Operator interrupted (Ctrl+C through the asyncio
                # runner). Re-raise so the connector's `try/finally`
                # closes the session cleanly and the orchestrator
                # sees the interrupt.
                raise
            except Exception:
                break
            waited = time.monotonic() - start
            try:
                state = await probe_fn()
            except Exception:
                state = None
            if state is False:
                logger.info(
                    "OY human-check: cleared after %.0fs (sort=%r)",
                    waited, self._sort_type,
                )
                return True, int(round(waited)), True, "recovered"
            # state is True or None → keep polling.

        # Bounded path only — indefinite mode never reaches here.
        action = (
            "failed_on_timeout"
            if self._fail_on_human_check_timeout
            else "skipped_on_timeout"
        )
        logger.warning(
            "OY human-check: timed out after %.0fs (sort=%r); action=%s",
            self._human_check_timeout_s, self._sort_type, action,
        )
        return True, int(round(self._human_check_timeout_s)), False, action

    def _write_trace_artifact(
        self,
        *,
        run_id: str,
        trace_records: list[dict],
    ) -> Path:
        """Write the per-API-call request/response trace as JSONL.

        Output path: ``<debug_dir>/oy_browser_trace_<run_id>.jsonl``.
        One JSON record per line — each line corresponds to one observed
        ``/reviews/cursor`` API call across all attempts.

        Records contain redacted header summaries only (no cookie values,
        no authorization values); presence/absence is recorded via
        boolean fields. Response records carry cursor metadata
        (``next_cursor_id``, ``has_next``, ``record_count``,
        ``login_required``) but no review-body text — that lives in the
        partial-rows artifact when applicable.
        """
        assert self._debug_dir is not None  # caller guards
        self._debug_dir.mkdir(parents=True, exist_ok=True)
        path = self._debug_dir / f"oy_browser_trace_{run_id}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for entry in trace_records:
                f.write(
                    json.dumps(
                        {"run_id": run_id, **entry},
                        ensure_ascii=False,
                    ) + "\n",
                )
        return path

    def _write_partial_artifact(
        self,
        *,
        run_id: str,
        raws: list[RawReview],
        collected_at: datetime,
    ) -> Path:
        """Write parsed-but-discarded RawReviews to a JSONL for offline inspection.

        Output path: ``<debug_dir>/oy_browser_partial_<run_id>.jsonl``.
        One JSON record per line. Each record carries the run_id, product_url,
        collected_at timestamp, the row's index in the parsed batch, and the
        full RawReview model dump. The JSONL is intended for diagnosis only —
        it does NOT enter ``phase1_reviews``.
        """
        assert self._debug_dir is not None  # caller guards
        self._debug_dir.mkdir(parents=True, exist_ok=True)
        path = self._debug_dir / f"oy_browser_partial_{run_id}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for i, r in enumerate(raws):
                record = {
                    "run_id": run_id,
                    "product_url": self._product_url,
                    "collected_at": collected_at.isoformat(),
                    "record_index": i,
                    "raw_review": r.model_dump(mode="json"),
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        return path

    def _build_session(self) -> BrowserReviewSession:
        if self._session_factory is not None:
            return self._session_factory()
        try:
            import playwright.async_api  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "OliveYoungBrowserAPIConnector default session requires playwright. "
                "Install with `pip install '.[saas]' && python -m playwright install chromium`, "
                "or inject a `session_factory=` for tests.",
            ) from e
        # USEFUL_SCORE_DESC is OY's page default; the connector should NOT
        # click any sort button when it's the requested sort. The response
        # filter still selects only USEFUL_SCORE_DESC responses, which is
        # exactly what cold-start fires — no race, no drain.
        sort_button_label_ko: str | None = None
        if self._sort_type is not None and self._sort_type != DEFAULT_SORT_TYPE:
            sort_button_label_ko = self.SORT_BUTTON_LABELS_KO.get(self._sort_type)
        return _PlaywrightReviewSession(
            headless=self._headless,
            api_path=self.REVIEW_API_PATH,
            review_tab_locator=self.REVIEW_TAB_LOCATOR,
            scroll_candidates=self.SCROLL_CANDIDATES,
            user_agent=self.USER_AGENT,
            viewport=self.VIEWPORT,
            storage_state_path=self._storage_state_path,
            cdp_endpoint=self._cdp_endpoint,
            sort_button_label_ko=sort_button_label_ko,
            sort_container_candidates=self.SORT_CONTAINER_CANDIDATES,
            sort_disclosure_affordance_labels_ko=(
                self.SORT_DISCLOSURE_AFFORDANCE_LABELS_KO
            ),
            sort_hunt_settle_s=self.SORT_HUNT_SETTLE_S,
            sort_hunt_poll_interval_s=self.SORT_HUNT_POLL_INTERVAL_S,
            false_empty_markers_ko=self.FALSE_EMPTY_MARKERS_KO,
            interstitial_markers_ko=self.INTERSTITIAL_MARKERS_KO,
            expected_sort_type=self._sort_type,
            force_fresh_context=self._force_fresh_context,
        )


def _count_records(body: dict) -> int:
    data = body.get("data") if isinstance(body, dict) else None
    records = data.get("goodsReviewList") if isinstance(data, dict) else None
    return len(records) if isinstance(records, list) else 0


def _emit_progress_heartbeat(
    *,
    goods_no: str | None,
    sort_type: str | None,
    cursor_index: int,
    raw_seen: int,
    parsed: int,
    filtered: int,
    has_next: bool | None,
    elapsed_s: float,
) -> None:
    """Print one ops-visible heartbeat line for a successful cursor response.

    Mirrors the per-response trace.jsonl signal to stdout so external
    observers can distinguish "still progressing" from "true hang"
    without tailing the trace artifact. See the
    I-OY-STEP5-PROGRESS-INDICATOR ticket for the false-wedge precedent
    (Anua A000000205555 step5 RECOMMENDED_DESC; trace.jsonl proved 41
    successful HTTP 200 / has_next=true responses while ops-data
    diagnosed a wedge from stale stdout).

    Observability-only — never raises into the pagination loop. flush=True
    because long sorts are launched via subprocess by the orchestrator
    and any buffering defeats the whole purpose.

    Format is intentionally compact and grep-friendly:
        [oy-heartbeat] goods=<g> sort=<s> cursor=<n> raw=<r>
        parsed=<p> filtered=<f> has_next=<true|false|?> t=+<NN>s
    """
    try:
        if has_next is True:
            hn = "true"
        elif has_next is False:
            hn = "false"
        else:
            hn = "?"
        # NOTE (I-OY-HEARTBEAT-STDOUT-REGRESSION): emit to stderr, NOT
        # stdout. The ingest subprocess contract
        # (scripts/ingest_oliveyoung_browser_phase1.py prints exactly one
        # JSON object to stdout; src/voc/app/collection_batch.py parses
        # stdout via json.loads) requires stdout to remain a single
        # parseable JSON document. Heartbeat lines on stdout corrupt
        # that contract and surface as
        # "stdout JSON decode failed: Expecting value: line 1 column 2"
        # which broke Anua A000000205555 v2 re-collection across all
        # sorts. Stderr preserves the same observability for ops
        # tailing the subprocess (Popen captures stderr separately).
        print(
            f"[oy-heartbeat] "
            f"goods={goods_no or '?'} "
            f"sort={sort_type or '?'} "
            f"cursor={cursor_index} "
            f"raw={raw_seen} "
            f"parsed={parsed} "
            f"filtered={filtered} "
            f"has_next={hn} "
            f"t=+{int(elapsed_s)}s",
            flush=True,
            file=sys.stderr,
        )
    except Exception:
        # Heartbeat is observability-only — must never fault the
        # collection loop. Swallow all formatting / IO errors.
        pass


def _extract_has_next(body: dict | None) -> bool | None:
    """Return `data.hasNext` from an OY response body, or None if absent/malformed."""
    if not isinstance(body, dict):
        return None
    data = body.get("data")
    if not isinstance(data, dict):
        return None
    val = data.get("hasNext")
    return val if isinstance(val, bool) else None


def _is_stale_locator_error(exc: BaseException) -> bool:
    """Return True when `exc` reads like a Playwright stale-element
    failure.

    I-OY-RECOVERY-SCOPED-CLICK-RETRY-BUDGET-FIX — used by the scoped
    sort-button retry loop to short-circuit a doomed click attempt
    the moment `scroll_into_view_if_needed` raises against a detached
    handle. Playwright's canonical phrasing is "Element is not
    attached to the DOM"; the `detached` / `stale` tokens are
    defensive fallbacks in case the wording shifts in a future
    Playwright release. Case-insensitive substring match against
    `str(exc)` keeps the detector resilient to surrounding wrapper
    text added by `Locator.scroll_into_view_if_needed:` prefixes.
    """
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "element is not attached to the dom",
            "detached",
            "stale",
        )
    )


def _is_partial_review_mount_state(state: dict) -> bool:
    """Return True when the page-state snapshot dict reads like the
    'review count mounted but sort header lazy-component absent'
    pattern documented by the O-OY-SCROLL-RECOVERY-BUDGET-FIX-LIVE-PROOF-ILSO
    proof (Ilso A000000225736 / DATETIME_DESC at HEAD c76f971).

    All five signals must hold:
      - text_has_review_count is truthy (string "true")
      - sort_pc_count == 0 (string "0")
      - sort_container_count == 0 (string "0")
      - sort_button_candidates == 0 (string "0")
      - text_has_choisin is falsy (NOT "true")

    Defensive: use `.get(..., default)` against the dict so a missing
    key does not raise. A missing review-count key is treated as
    "not partial mount" (the predicate is a CONFIRMATIVE detector,
    not a default-yes). Likewise, "unknown" values for the count /
    text fields fall through to False — the predicate only fires on
    a fully observed snapshot that matches the live-proof pattern.

    Values are the stringified shapes that
    `_snapshot_recovery_page_state` emits (`"true"` / `"false"` /
    `"unknown"` for text-presence probes; `"0"` / `"1"` / … /
    `"unknown"` for count probes). Working off the stringified dict
    keeps the predicate aligned with the dict the diagnostic log
    line uses, so a future log-line scan can recover the same truth
    value the runtime did.
    """
    # CONFIRMATIVE: review-count text MUST be present (the
    # distinguishing signal vs "nothing mounted at all"). Missing or
    # "unknown" or "false" → not partial-mount.
    if state.get("text_has_review_count") != "true":
        return False
    # All three sort-area count signals must be exactly "0".
    if state.get("sort_pc_count") != "0":
        return False
    if state.get("sort_container_count") != "0":
        return False
    if state.get("sort_button_candidates") != "0":
        return False
    # And the inline target label must be absent (anything other
    # than "true").
    if state.get("text_has_choisin") == "true":
        return False
    return True


def _is_healthy_sort_area_state(state: dict) -> bool:
    """Return True when the page-state snapshot dict reads like the
    sort area is ALREADY mounted and clickable, i.e. the review-tab
    cascade is unnecessary.

    I-OY-RECOVERY-SKIP-CASCADE-WHEN-SORT-HEALTHY — used by the
    recovery reload-first branch to skip the cascade when
    `page.reload()` alone produced a healthy sort area. The prior
    O-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-LIVE-PROOF-ILSO proof
    showed the cascade itself UNMOUNTS a healthy post-reload sort
    area on the Ilso A000000225736 DOM shape: snapshots at the
    `after_reload` checkpoint reported sort_pc_count=1,
    sort_button_candidates=6, text_has_choisin=true while the very
    next `after_review_cascade` snapshot (one second later) reported
    sort_pc_count=0, sort_button_candidates=0, text_has_choisin=false.
    The lazy-mount nudge from `9eed039` then fired 4× with
    success=false trying to re-mount what the cascade itself had
    just destroyed.

    Three signals must hold (CONFIRMATIVE):
      - sort_pc_count >= 1
      - sort_button_candidates >= 1
      - text_has_choisin == "true"

    Defensive: each count is parsed via int() inside try/except.
    Missing keys, non-numeric values, "unknown" tokens all fall
    through to False — the predicate is a CONFIRMATIVE detector,
    not a default-yes. Values are the stringified shapes that
    `_compute_recovery_page_state_dict` emits (`"0"` / `"1"` / ... /
    `"unknown"` for counts; `"true"` / `"false"` / `"unknown"` for
    booleans), so feeding this predicate the same dict that
    `_snapshot_recovery_page_state` would have logged keeps the
    runtime gate and the post-mortem log line bit-for-bit aligned.

    Mutually exclusive with `_is_partial_review_mount_state` by
    construction: that predicate requires sort_pc_count == "0" and
    text_has_choisin != "true", both of which this predicate
    rejects.
    """
    # sort_pc_count >= 1
    try:
        sort_pc = int(state.get("sort_pc_count", "0") or 0)
    except (TypeError, ValueError):
        return False
    if sort_pc < 1:
        return False
    # sort_button_candidates >= 1
    try:
        sort_buttons = int(state.get("sort_button_candidates", "0") or 0)
    except (TypeError, ValueError):
        return False
    if sort_buttons < 1:
        return False
    # text_has_choisin must be exactly "true" (CONFIRMATIVE).
    if state.get("text_has_choisin") != "true":
        return False
    return True


class _PlaywrightReviewSession:
    """Real `BrowserReviewSession` backed by Playwright/Chromium.

    Intercepts every response whose URL contains `api_path` and pushes
    `(status, body_or_None)` onto an asyncio.Queue. `wait_for_next_response`
    pops from the queue with timeout. Mirrors the validated capture script
    (test.py); diverges only by emitting every response rather than stopping
    after the first qualifying one.

    Responses are classified by `_classify_http_response` at the connector
    layer — this class intentionally does NOT filter by status or body shape,
    so e.g. a 403 response becomes `(403, None)` and the connector sees it.
    """

    # Lazy-load trigger fallback selectors. Bound to the connector's
    # tuple as the single source of truth — `_trigger_review_list_api`
    # references `self.REVIEW_MORE_LOCATORS` (this class's MRO) and
    # was previously raising AttributeError because the constant
    # only lived on the connector. The reference (not a copy) keeps
    # the two classes from drifting; a future curator who updates
    # the locators on the connector also updates the session path.
    REVIEW_MORE_LOCATORS: tuple[str, ...] = (
        OliveYoungBrowserAPIConnector.REVIEW_MORE_LOCATORS
    )

    def __init__(
        self,
        *,
        headless: bool,
        api_path: str,
        review_tab_locator: str,
        scroll_candidates: tuple[str, ...],
        user_agent: str,
        viewport: dict[str, int],
        storage_state_path: "Path | str | None" = None,
        cdp_endpoint: str | None = None,
        sort_button_label_ko: str | None = None,
        sort_container_candidates: tuple[str, ...] = (),
        sort_disclosure_affordance_labels_ko: tuple[str, ...] = (),
        sort_hunt_settle_s: float = 0.0,
        sort_hunt_poll_interval_s: float = 1.0,
        false_empty_markers_ko: tuple[str, ...] = (),
        interstitial_markers_ko: tuple[str, ...] = (),
        expected_sort_type: str | None = None,
        # Legacy alias kept for back-compat with any external test
        # constructor calls; if provided, it's used as the final
        # fallback selector after the robust path fails.
        sort_button_selector: str | None = None,
        # When True, AND a CDP endpoint is set, `open()` always
        # creates a NEW Playwright context inside the user's
        # CDP-attached browser instead of re-using `contexts[0]`.
        # Cookies / localStorage are NOT carried over — the fresh
        # context starts unauthenticated. Used by the orchestrator's
        # `--strict-reset-session-on-block` to force a session reset
        # after sticky failures (anti_bot, anonymous_auth_wall,
        # human_check_timeout). For owned-browser mode (no CDP) this
        # flag is a no-op because the browser process is fresh per
        # session anyway.
        force_fresh_context: bool = False,
    ):
        self._headless = headless
        self._api_path = api_path
        self._review_tab_locator = review_tab_locator
        self._scroll_candidates = scroll_candidates
        self._user_agent = user_agent
        self._viewport = viewport
        self._storage_state_path = storage_state_path
        self._cdp_endpoint = cdp_endpoint
        self._force_fresh_context: bool = bool(force_fresh_context)
        # Korean text label of the sort button to click (e.g. "최신순").
        # When set, the runtime path enumerates buttons within the sort
        # container and matches by normalized exact text — robust against
        # `has-text` substring collisions on neighboring labels.
        self._sort_button_label_ko = sort_button_label_ko
        self._sort_container_candidates = tuple(sort_container_candidates)
        # Disclosure affordances probed inside the sort scope when the
        # target rating label is not inline-rendered on the first poll.
        # See `OliveYoungBrowserAPIConnector.SORT_DISCLOSURE_AFFORDANCE_LABELS_KO`
        # for the curated allow-list. Empty tuple disables the widening
        # probe (legacy behavior).
        self._sort_disclosure_affordance_labels_ko = tuple(
            sort_disclosure_affordance_labels_ko,
        )
        self._sort_hunt_settle_s = float(sort_hunt_settle_s)
        self._sort_hunt_poll_interval_s = float(sort_hunt_poll_interval_s)
        self._false_empty_markers_ko = tuple(false_empty_markers_ko)
        self._interstitial_markers_ko = tuple(interstitial_markers_ko)
        # Diagnostic: deduped list of button labels the most recent
        # sort-hunt enumerated. Populated by `_click_sort_button_robust`
        # on success AND on failure (clicked target wins; failure path
        # logs everything seen). Connector reads via the getter.
        self._last_seen_sort_labels: list[str] = []
        # True iff the most recent `_click_sort_button_robust` exhausted
        # its hunt deadline without ever locating the target rating
        # label (after scroll-into-view + disclosure-affordance probe).
        # Distinct from `false_empty_state_detected`: this signals that
        # OY's PDP DOM did not render the sort tab the connector needs,
        # which is a UI-shape signal — NOT an anti-bot signal. Drained
        # by the connector at end of run into the
        # `sort_control_unreachable` field on `ConnectorRunSummary`.
        self._sort_control_unreachable: bool = False
        # I-OY-RECOVERY-WAIT-FOR-REVIEW-TAB-RENDER — recorded by
        # `reload_and_reopen_review_tab` to signal whether the recreated
        # page's review-tab / sort-area DOM became ready BEFORE the
        # post-recreate sort-button click. None=not probed yet (initial
        # open or session never recreated); True=sort area visible within
        # budget; False=sort area never rendered within budget (the case
        # observed on Ilso A000000225736 where the recreated page exposed
        # only generic site-nav buttons). The connector reads this
        # post-recreate via `get_post_recreate_sort_area_ready()` and
        # emits a single narrow `_note` so the next post-mortem can tell
        # whether the wait succeeded or deadlined.
        self._post_recreate_sort_area_ready: bool | None = None
        # I-OY-RECOVERY-SCROLL-TO-REVIEW-SORT-AND-CLICK — side-channel
        # output from `_wait_for_review_sort_area_ready` when the
        # secondary signal `target_label_visible` fires. Carries the
        # Playwright locator handle that matched the target sort label
        # so the cascade can scroll it into view and click it directly,
        # eliminating the DOM-re-query race that produced the live
        # symptom on Ilso A000000225736 (readiness emitted
        # `target_label_visible target='최신순' poll_attempt=1` at
        # 15:01:20; `_click_sort_button_robust` deadlined at 15:01:32
        # without finding `최신순` in its enumeration). None means
        # either (a) the wait deadlined without observing the target
        # label, or (b) the wait succeeded only via the weaker
        # `container_visible` primary signal (target label not yet
        # inline-rendered when the container appeared). The cascade
        # reads this immediately after the wait returns and falls
        # back to `_click_sort_button_robust` whenever the handle is
        # unusable.
        self._last_readiness_matched_button: object | None = None
        # I-OY-RECOVERY-SCROLL-TO-REVIEW-SORT-AND-CLICK — also records
        # the first matching `_sort_container_candidates` selector so
        # the cascade can `scroll_into_view_if_needed` on the
        # container before falling back to the robust hunt when only
        # the weaker `container_visible` primary signal fired.
        self._last_readiness_matched_container: object | None = None
        # I-OY-RECOVERY-RECREATE-STRATEGY-REVISION — which recovery
        # strategy `reload_and_reopen_review_tab` ended up using on the
        # most recent invocation. The Ilso A000000225736 live proof
        # demonstrated that the close+new_page+goto recreate produces a
        # page that never mounts the review-tab DOM, even after the
        # 1c1c1f6 readiness wait + single-shot re-trigger. The fix tries
        # `page.reload()` on the existing wedged page first (which still
        # has the review-tab DOM mounted — cursor 49 had been served
        # from it), and only falls back to the close+new_page+goto
        # recreate when reload itself raises or post-reload readiness
        # remains False. Connector reads this via
        # `get_post_recreate_strategy_used()` and emits at most two
        # narrow `_note` entries describing which strategy ran.
        #
        # Values:
        #   None — recreate hasn't been invoked yet OR an early-return
        #     fired before any strategy could begin (e.g. ctx is None).
        #   "reload_succeeded" — reload-first ran and the post-reload
        #     readiness wait observed the sort area; sort-button click
        #     ran on the reloaded page; recreate fallback was NOT taken.
        #   "reload_failed_recreate_fallback" — reload-first was
        #     attempted (eligible by URL match) but either `page.reload`
        #     raised OR post-reload readiness wait deadlined; control
        #     fell through to the existing close+new_page+goto path.
        #   "recreate_only" — reload-first was NOT eligible (e.g.
        #     `_opened_product_url` missing, OR the page URL doesn't
        #     contain the target goodsNo, OR `self._page` was None);
        #     went straight to close+new_page+goto.
        self._post_recreate_strategy_used: str | None = None
        # Legacy substring selector (kept as last-resort fallback). New
        # call sites pass label_ko; old call sites can still pass a
        # selector and the robust path will skip the label-based hunt.
        self._sort_button_selector = sort_button_selector
        # When non-None, ONLY responses whose request post_data.sortType
        # matches this value are forwarded to the consumer queue. Responses
        # with non-matching sortType are still recorded in request_log
        # (with `filtered_out_by_sort=true`) for forensic visibility, but
        # never reach the connector loop. This eliminates the cold-start
        # race where the page's default-sort API fires first, beats the
        # post-click new-sort response onto the queue, and gets stamped
        # with the wrong sort_type. Setting None preserves legacy behavior
        # (all `/reviews/cursor` responses forwarded).
        self._expected_sort_type = expected_sort_type
        # Telemetry: tally observed sortTypes for the run-end summary.
        self._observed_sort_types_count: dict[str, int] = {}
        self._responses_filtered_out_by_sort: int = 0
        # I-OY-RECOVERY-POST-CLICK-RESPONSE-CAPTURE — diagnostic-only
        # gate that scopes the per-response probe logging to the
        # post-recreate cold-start window. The flag is flipped True
        # by the connector in `collect()` immediately BEFORE
        # `reload_and_reopen_review_tab()` is awaited (so the scoped
        # click inside the cascade runs with diagnostics enabled),
        # and flipped False after the post-recreate
        # `wait_for_next_response` exits — whether the wait
        # succeeded, timed out, or raised. Default False so that
        # initial-open / happy-path collection emits no probe logs
        # (avoids spamming the live tee log on every cursor response).
        # `_on_response` reads this flag by attribute lookup at each
        # response event, so the change takes effect immediately
        # without re-attaching the handler.
        #
        # Counters below tally what the probe observed during the
        # recovery window. They are surfaced ONLY in the
        # `OY recovery response timeout summary:` log line emitted
        # at the end of the window; no schema fields change.
        self._diagnose_post_recovery_responses: bool = False
        self._post_recovery_response_probe_count: int = 0
        self._post_recovery_response_accepted_count: int = 0
        self._post_recovery_response_sort_mismatch_count: int = 0
        self._post_recovery_response_parse_error_count: int = 0
        # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG — diagnostic-only
        # gate that scopes the page-state-snapshot helper (and the
        # `_trigger_review_list_api` outcome summary) to the post-
        # recovery window. Mirrors `_diagnose_post_recovery_responses`:
        # the connector flips this flag True alongside the response
        # diagnostic immediately BEFORE `reload_and_reopen_review_tab`
        # is awaited and flips it False at every exit from the recovery
        # branch. Default False so initial-open / happy-path collection
        # emits no page-state probe logs.
        #
        # Why a second flag (vs reusing `_diagnose_post_recovery_responses`):
        # the response-probe flag scopes per-response logging inside the
        # `_on_response` handler — it should stay True for the entire
        # post-recreate cursor-cold-start window so every cursor response
        # is observed. The page-state probe is invoked from a different
        # surface (the recovery primitive + cascade), so a separate
        # attribute lookup keeps the two scopes independent in case a
        # future ticket needs to disable one without the other. The
        # connector flips both together today.
        self._diagnose_post_recreate_page_state: bool = False
        # Total review count surfaced by the product page or the cursor
        # API response, when available. Best-effort metadata only; None
        # when the page/API didn't expose it (legacy endpoints, anti-bot
        # state, or DOM layout the parser doesn't recognize). Never used
        # to gate scraping behavior — drives only coverage_ratio /
        # confidence_level downstream. Write-once: first non-None value
        # wins so a later partial response doesn't overwrite a confirmed
        # count from the DOM badge.
        self._observed_total_review_count: int | None = None
        # Breadcrumb / category captured opportunistically from the
        # product-page DOM. Shape: { "ko": str, "path": list[str],
        # "leaf_ko": str | None, "source": str } or None when no
        # breadcrumb element matched. Best-effort metadata only —
        # never gates scraping or quality. Write-once: first non-None
        # value wins.
        self._observed_breadcrumb: dict | None = None
        # Representative product image URL captured from the detail
        # page's og:image / JSON-LD. Pulled ONCE during open(), AFTER
        # the initial goto and BEFORE the review-tab click — the page
        # is on the detail page HTML at that moment, the read is
        # purely passive (page.content()), and there's no risk of
        # disturbing the review API watch that hasn't been set up yet.
        # Best-effort metadata; absence is acceptable (the pipeline
        # falls through to the standalone HTTP extractor or just
        # records image=None). Write-once: first non-None value wins.
        self._observed_product_image_url: str | None = None
        # v2.4.4 — capture diagnostic so the operator can see WHERE
        # the image-collection chain broke. NEVER carries page HTML or
        # cookies; only structural counts + the extracted URL (which
        # is public anyway). Flows up via the connector's
        # `last_run_summary` into the per-sort prod_summary, into the
        # pipeline's warm-hint scan log, and into
        # product_metadata.json's failure_reason classifier.
        #
        # v2.4.5 — extended with session-lifecycle diagnostics so we
        # can distinguish "open() never ran" from "open() ran but the
        # capture hook wasn't reached" from "capture ran but extractor
        # found nothing". Without these flags, the previous live smoke
        # showed `attempted=False` with no way to tell which of the
        # three was the actual failure mode.
        self._product_image_capture_diagnostic: dict = {
            "attempted": False,
            "page_url": None,
            "html_length": None,
            "og_count": 0,
            "jsonld_count": 0,
            "twitter_count": 0,
            "link_image_src_count": 0,
            "oy_thumbnail_img_count": 0,
            "selected_source": None,
            "error": None,
            # v2.4.5 — session lifecycle flags + identity. `session_id`
            # is `id(self)` recorded by the session itself; the
            # connector records the same value (`diagnostic_session_id`)
            # when it reads the diagnostic. If they differ, the session
            # the connector queried is NOT the session that ran open.
            "session_id": id(self),
            "session_class": type(self).__name__,
            "session_open_called": False,
            "session_open_url_at_start": None,
            "capture_hook_reached": False,
            # v2.4.5 — what the constructor was told (audit-only). When
            # the connector forwards `cdp_endpoint`, this field
            # confirms the session actually received it.
            "session_received_cdp_endpoint": None,
        }
        # Stamp the cdp endpoint we were constructed with NOW so the
        # value survives even if `open()` blows up before reaching the
        # capture hook.
        self._product_image_capture_diagnostic[
            "session_received_cdp_endpoint"
        ] = self._cdp_endpoint

        self._pw = None
        self._browser = None
        self._ctx = None
        self._page = None
        # CDP-attach branch doesn't own the browser or context — user launched
        # them. We must not close them on teardown; only close the page/context
        # if we created them.
        self._owns_browser = False
        self._owns_context = False
        self._queue: asyncio.Queue[tuple[int, dict | None]] = asyncio.Queue()
        # PR-4: per-API-call structured log. Populated in `_on_response`
        # synchronously with each (status, body) tuple appended to the queue.
        # The connector reads this list at end of `collect()` to build the
        # trace artifact and the cursor_sequence summary fields.
        self._request_log: list[dict] = []
        # Remember the product URL passed to `open()` so the
        # page-recreate path (false-empty recovery) can re-navigate
        # without callers needing to thread it through again.
        self._opened_product_url: str | None = None
        # Lazy-load trigger telemetry — populated by
        # `_trigger_review_list_api`. Surfaces in `prod_summary` so
        # the batch_summary can map the
        # "review-meta-yes / review-list-no" condition to a clear
        # status code instead of `unknown_failure`.
        self._review_more_button_clicked: bool = False
        self._scrolled_to_review_area: bool = False
        # I-OY-CDP-PAGE-ADOPTION — when the session reuses an existing
        # CDP context (`_cdp_endpoint is not None` and `force_fresh_context`
        # is False), `open()` first looks for a pre-existing page in the
        # context whose URL targets the same goodsNo as `product_url`.
        # If found, that page object is adopted instead of creating a
        # fresh one. This closes the gap diagnosed in the Ilso forensics
        # handoff: the operator-visible &tab=review page was being
        # ignored because the connector unconditionally called
        # `_ctx.new_page()`. Diagnostics are session-local (no
        # broad-summary schema change in this ticket).
        self._adopted_existing_page: bool = False
        self._existing_page_candidate_count: int = 0
        self._adopted_page_url_at_open: str | None = None
        self._closed = False

    def _attach_response_handler(self, page) -> None:
        """Attach the per-`/reviews/cursor` response interceptor to `page`.

        Extracted from `open()` so the page-recreate recovery path
        (`reload_and_reopen_review_tab`) can re-attach to a fresh page
        without duplicating the closure body. Captures instance
        attributes by reference — `self._queue`, `self._request_log`,
        `self._observed_sort_types_count` — so resetting them on the
        instance correctly resets the new page's view.
        """
        api_path = self._api_path
        queue = self._queue
        request_log = self._request_log
        expected_sort = self._expected_sort_type
        observed_counts = self._observed_sort_types_count

        async def _on_response(response) -> None:
            if api_path not in response.url:
                return
            status = response.status
            ct = (response.headers.get("content-type") or "").lower()
            body: dict | None = None
            # I-OY-RECOVERY-POST-CLICK-RESPONSE-CAPTURE — capture the
            # JSON-decode outcome distinctly so the diagnostic probe at
            # the bottom of this handler can classify a malformed body
            # as a parse error vs. a sort_mismatch / accepted response.
            # The existing `logger.warning` on decode failure is
            # preserved; this flag is purely local bookkeeping.
            json_decode_failed = False
            if status == 200 and "application/json" in ct:
                try:
                    body = await response.json()
                except Exception as e:
                    logger.warning("OY response JSON decode failed: %s", e)
                    body = None
                    json_decode_failed = True
            # Opportunistic total-count capture from the response body.
            # Write-once: the FIRST non-None value sticks, so a later
            # truncated/error response can't overwrite a confirmed count.
            # Many OY cursor endpoints return null here; the DOM badge
            # capture in open() is the more reliable source.
            if body is not None and self._observed_total_review_count is None:
                extracted_total = _extract_total_count_from_response_body(body)
                if extracted_total is not None:
                    self._observed_total_review_count = extracted_total
            try:
                req = response.request
                req_method = req.method
                req_url = req.url
                req_headers = dict(req.headers)  # safe copy
                req_post_data = req.post_data
            except Exception as e:
                logger.warning("OY request-meta capture failed: %s", e)
                req_method = "?"
                req_url = response.url
                req_headers = {}
                req_post_data = None
            redacted = _redact_request_headers(req_headers)
            post_data_sort_type: str | None = None
            if req_post_data:
                try:
                    pd = json.loads(req_post_data)
                    if isinstance(pd, dict):
                        st = pd.get("sortType")
                        if isinstance(st, str):
                            post_data_sort_type = st
                except Exception:
                    pass
            if post_data_sort_type is not None:
                observed_counts[post_data_sort_type] = (
                    observed_counts.get(post_data_sort_type, 0) + 1
                )
            should_forward = True
            if expected_sort is not None:
                should_forward = (post_data_sort_type == expected_sort)
            if not should_forward:
                self._responses_filtered_out_by_sort += 1
            entry = {
                "request_index": len(request_log),
                "timestamp": datetime.now().isoformat(),
                "request": {
                    "method": req_method,
                    "url": req_url,
                    "query_params": _extract_query_params(req_url),
                    "post_data_sort_type": post_data_sort_type,
                    **redacted,
                },
                "response": {
                    "status": status,
                    "tag": _classify_http_response(status, body),
                    **_extract_response_cursor_meta(body, status),
                },
                "forwarded_to_queue": should_forward,
            }
            request_log.append(entry)
            if should_forward:
                await queue.put((status, body))

            # I-OY-RECOVERY-POST-CLICK-RESPONSE-CAPTURE — scoped
            # diagnostic probe. Gated by
            # `_diagnose_post_recovery_responses` so the live tee log
            # is NOT spammed during normal happy-path collection; the
            # connector flips this flag True only for the post-recreate
            # cold-start window. Every parse / log call is wrapped in
            # try/except so a malformed Playwright response cannot
            # abort collection — diagnostics are best-effort.
            #
            # The probe READS FROM the already-parsed values above; it
            # never re-consumes `response.json()`. `has_next`,
            # `review_count`, and `cursor` are pulled from
            # `_extract_response_cursor_meta(body, status)` which was
            # already invoked when the request_log entry was built.
            #
            # `drop_reason` taxonomy (matches the failure-mode picker
            # in the dispatch):
            #   - none         — response was accepted onto the queue.
            #   - sort_mismatch — `expected_sort` was set and the
            #                     request's `post_data_sort_type`
            #                     differed, so the response was filtered.
            #   - parse_error  — `response.json()` raised OR the body
            #                     parsed but was not a dict / missed
            #                     expected keys (classifier "malformed").
            #   - not_post     — request method != POST (cursor API is
            #                     always POST; non-POST hits the URL by
            #                     accident).
            try:
                if getattr(
                    self, "_diagnose_post_recovery_responses", False,
                ):
                    try:
                        self._post_recovery_response_probe_count += 1
                    except Exception:
                        pass
                    cursor_meta = entry.get("response", {})
                    has_next_val = cursor_meta.get("has_next")
                    review_count_val = cursor_meta.get("record_count")
                    cursor_val = cursor_meta.get("next_cursor_id")
                    tag_val = cursor_meta.get("tag")
                    if json_decode_failed or (
                        body is None
                        and status == 200
                        and "application/json" in ct
                    ) or tag_val == "malformed":
                        drop_reason = "parse_error"
                    elif req_method != "POST" and req_method != "?":
                        drop_reason = "not_post"
                    elif not should_forward:
                        drop_reason = "sort_mismatch"
                    else:
                        drop_reason = "none"
                    if drop_reason == "parse_error":
                        try:
                            self._post_recovery_response_parse_error_count += 1
                        except Exception:
                            pass
                        logger.info(
                            "OY recovery response parse failed: "
                            "url_kind=cursor status=%s request_method=%s "
                            "request_sort=%s expected_sort=%s accepted=%s "
                            "drop_reason=%s has_next=%s review_count=%s "
                            "cursor=%s",
                            status,
                            req_method,
                            post_data_sort_type
                            if post_data_sort_type is not None
                            else "unknown",
                            expected_sort
                            if expected_sort is not None
                            else "unknown",
                            "false",
                            drop_reason,
                            "unknown" if has_next_val is None else has_next_val,
                            "unknown"
                            if review_count_val is None
                            else review_count_val,
                            "unknown" if cursor_val is None else cursor_val,
                        )
                    elif drop_reason == "none":
                        try:
                            self._post_recovery_response_accepted_count += 1
                        except Exception:
                            pass
                        logger.info(
                            "OY recovery response accepted: "
                            "url_kind=cursor status=%s request_method=%s "
                            "request_sort=%s expected_sort=%s accepted=%s "
                            "drop_reason=%s has_next=%s review_count=%s "
                            "cursor=%s",
                            status,
                            req_method,
                            post_data_sort_type
                            if post_data_sort_type is not None
                            else "unknown",
                            expected_sort
                            if expected_sort is not None
                            else "unknown",
                            "true",
                            drop_reason,
                            "unknown" if has_next_val is None else has_next_val,
                            "unknown"
                            if review_count_val is None
                            else review_count_val,
                            "unknown" if cursor_val is None else cursor_val,
                        )
                    else:
                        if drop_reason == "sort_mismatch":
                            try:
                                self._post_recovery_response_sort_mismatch_count += 1
                            except Exception:
                                pass
                        logger.info(
                            "OY recovery response dropped: "
                            "url_kind=cursor status=%s request_method=%s "
                            "request_sort=%s expected_sort=%s accepted=%s "
                            "drop_reason=%s has_next=%s review_count=%s "
                            "cursor=%s",
                            status,
                            req_method,
                            post_data_sort_type
                            if post_data_sort_type is not None
                            else "unknown",
                            expected_sort
                            if expected_sort is not None
                            else "unknown",
                            "false",
                            drop_reason,
                            "unknown" if has_next_val is None else has_next_val,
                            "unknown"
                            if review_count_val is None
                            else review_count_val,
                            "unknown" if cursor_val is None else cursor_val,
                        )
            except Exception:
                # Diagnostics are best-effort; never abort collection.
                pass

        page.on("response", _on_response)

    async def _capture_total_review_count_from_dom(self) -> int | None:
        """Best-effort DOM scan for the review-count badge.

        OY surfaces the total review count in several places; the
        layout has varied across past iterations, so we try a small
        priority-ordered list of candidate selectors and return the
        first parseable integer. Each candidate is wrapped in its
        own try block so a stale selector cannot break the whole
        capture.

        NEVER raises — caller in `open()` already wraps this in a
        try/except, but the inner code is also defensive so a failed
        DOM read here is functionally equivalent to "no signal."
        """
        if self._page is None:
            return None
        candidate_selectors = (
            # Review tab counter on the goods detail page.
            "a[data-target='review'] .cnt",
            "a.tab_review .cnt",
            # Generic counter near a tab whose href/data attribute
            # mentions review.
            "[data-tab='review'] .cnt",
            "[id*='review'] .cnt",
            ".reviewTab .num",
            # Tabbed nav with a count span next to the label.
            "ul.tab_review li.on .cnt",
            # Header-area badges seen on some product variants.
            ".review_count",
        )
        for sel in candidate_selectors:
            try:
                loc = self._page.locator(sel).first
                if await loc.count() == 0:
                    continue
                text = await loc.inner_text(timeout=1500)
            except Exception:
                continue
            n = _extract_total_count_from_dom_text(text)
            if n is not None:
                return n
        return None

    async def _capture_breadcrumb_from_dom(self) -> dict | None:
        """Best-effort DOM scan for the product-page breadcrumb.

        Tries a small priority-ordered list of selectors. The first
        element that yields ≥1 non-empty node wins. Returns a dict
        shaped as:
            {
              "ko": "뷰티 > 스킨케어 > 토너패드",
              "path": ["뷰티", "스킨케어", "토너패드"],
              "leaf_ko": "토너패드",
              "source": "<selector that produced the value>",
            }
        or None when nothing matched.

        NEVER raises — caller in `open()` already wraps this in a
        try/except, but the inner code is also defensive so a stale
        selector cannot break the scrape.
        """
        if self._page is None:
            return None
        # Each entry: (selector, mode). mode="combined" reads
        # `inner_text` of one element and splits on separator chars.
        # mode="enumerated" reads each child's text individually so
        # OY's nested-anchor breadcrumbs (no visible separators in the
        # DOM, separators are pseudo-elements) still produce a path.
        candidate_selectors: tuple[tuple[str, str], ...] = (
            # Common OY breadcrumb wrappers (combined string form).
            ("nav.breadcrumb", "combined"),
            ("ol.breadcrumb", "combined"),
            ("[class*='breadcrumb']", "combined"),
            # Category path container variant — schema.org listing.
            ("[itemtype*='BreadcrumbList']", "enumerated"),
            # Some product pages use a category-path block instead.
            (".cate_info", "combined"),
            (".prd_category", "combined"),
        )
        for sel, mode in candidate_selectors:
            try:
                if mode == "combined":
                    loc = self._page.locator(sel).first
                    if await loc.count() == 0:
                        continue
                    text = await loc.inner_text(timeout=1500)
                    nodes = parse_breadcrumb_text(text)
                else:
                    base = self._page.locator(sel).first
                    if await base.count() == 0:
                        continue
                    items = base.locator("[itemprop='name'], li a, li span")
                    n = await items.count()
                    if n == 0:
                        continue
                    raw_nodes: list[str] = []
                    for i in range(n):
                        try:
                            t = await items.nth(i).inner_text(timeout=1500)
                        except Exception:
                            continue
                        if isinstance(t, str):
                            raw_nodes.append(t)
                    nodes = normalize_breadcrumb_path(raw_nodes)
            except Exception:
                continue
            if not nodes:
                continue
            # Always rebuild `ko` from the cleaned nodes so duplicates,
            # newlines, and surrounding whitespace can never reach the
            # DB / downstream UX, regardless of which mode (combined
            # vs enumerated) produced the nodes.
            ko = " > ".join(nodes)
            return {
                "ko": ko,
                "path": list(nodes),
                "leaf_ko": nodes[-1],
                "source": f"dom:{sel}",
            }
        return None

    def get_observed_breadcrumb(self) -> dict | None:
        """Accessor for the connector to surface the breadcrumb dict
        captured during this session. Returns None when no breadcrumb
        DOM element matched. Best-effort metadata only — caller MUST
        treat None as "no signal", not as an error."""
        return self._observed_breadcrumb

    def get_observed_product_image_url(self) -> str | None:
        """Accessor for the connector to surface the product image URL
        captured from the detail page's og:image / JSON-LD blocks during
        open(). Best-effort metadata; None when neither extraction path
        matched. Image is captured during the warm session — no extra
        HTTP fetch — so the source label downstream is
        ``oliveyoung_detail_page_playwright``."""
        return self._observed_product_image_url

    def get_product_image_capture_diagnostic(self) -> dict:
        """v2.4.4 — return the capture diagnostic dict so operators can
        see exactly where the image-collection chain broke. Read-only
        copy; modifying the returned dict does not affect the session.
        Never carries HTML or cookies — only structural counts + the
        eventually-extracted URL."""
        return dict(self._product_image_capture_diagnostic)

    async def _capture_product_image_url_from_page(
        self, *, goods_no: str | None = None,
    ) -> str | None:
        """Read og:image / JSON-LD / fallbacks from the current page.

        Pure passive read — `page.content()` does not navigate or
        click, so it cannot disturb the review API watch. Returns the
        first match or None. NEVER raises (the connector wraps this in
        a try/except so any error here degrades to image=None).

        Side-effect: populates `self._product_image_capture_diagnostic`
        with structural counts so the pipeline can audit the failure
        path even when extraction returns None."""
        diag = self._product_image_capture_diagnostic
        diag["attempted"] = True
        if self._page is None:
            diag["error"] = "page_not_open"
            return None
        from src.voc.connectors.product_image_extractor import (
            extract_image_diagnostic_from_html,
        )
        try:
            page_url = self._page.url
        except Exception:
            page_url = None
        diag["page_url"] = page_url
        try:
            html = await self._page.content()
        except Exception as e:
            diag["error"] = f"page_content_failed: {type(e).__name__}"
            return None
        d = extract_image_diagnostic_from_html(html, goods_no=goods_no)
        diag["html_length"] = d["html_length"]
        diag["og_count"] = d["og_count"]
        diag["jsonld_count"] = d["jsonld_count"]
        diag["twitter_count"] = d["twitter_count"]
        diag["link_image_src_count"] = d["link_image_src_count"]
        diag["oy_thumbnail_img_count"] = d["oy_thumbnail_img_count"]
        diag["selected_source"] = d["selected_source"]
        return d["extracted_image_url"]

    def get_observed_total_review_count(self) -> int | None:
        """Accessor for the connector to surface into ConnectorRunSummary.

        Returns the first non-None value captured during this session
        from either the DOM badge (preferred) or any cursor API
        response body (fallback). None when neither path produced a
        value — no synthetic fill, no zero, no estimate.
        """
        return self._observed_total_review_count

    @staticmethod
    def _extract_target_goods_no(product_url: str) -> str | None:
        """Pull `goodsNo=<X>` from the connector's product URL.

        Uses stdlib `urllib.parse` (lazy-imported, mirroring the
        precedent set by `_extract_query_params` at module scope). Returns
        None when the URL does not carry a `goodsNo` query parameter, in
        which case existing-page adoption is skipped entirely (the
        fallback path handles unknown-target callers safely).
        """
        if not product_url:
            return None
        from urllib.parse import urlparse, parse_qs
        try:
            q = parse_qs(urlparse(product_url).query, keep_blank_values=True)
        except Exception:
            return None
        values = q.get("goodsNo") or []
        if not values:
            return None
        target = values[0]
        return target or None

    def _maybe_adopt_existing_page(self, product_url: str):
        """Inspect `self._ctx.pages` and return a page targeting the same
        goodsNo as `product_url`, or None if no candidate qualifies.

        Selection contract (operator spec, ticket
        I-OY-CDP-PAGE-ADOPTION):

          1. Skip pages whose URL is `about:blank`, `chrome://newtab/`,
             empty, or in the `devtools://` / `chrome://` / `edge://`
             internal namespace. These are not real product pages even
             if their URL accidentally contains a fragment that matches
             the target goodsNo.
          2. Skip pages whose URL does NOT contain
             `goodsNo=<target>` — never adopt a page for a different
             product.
          3. Score the survivors:
               +3 if URL contains `tab=review`
               +2 if URL contains `getGoodsDetail.do`
               +1 baseline (URL contains `goodsNo=<target>`)
             The scores stack — a `getGoodsDetail.do` URL with
             `&tab=review` scores 6, beating a bare detail page (3)
             and a non-detail URL containing only the goodsNo (1).
          4. Highest score wins; ties resolved by Playwright's natural
             list order (first-encountered candidate).

        Side-effects: this method ONLY reads `page.url`. It never
        clicks, scrolls, navigates, or attaches handlers. The caller
        (`open`) is responsible for adopting the returned page object
        and emitting the diagnostic flag. Returns None when no
        candidate qualifies, in which case the caller falls back to
        `_ctx.new_page()`.

        Updates the session-local diagnostic counter
        `self._existing_page_candidate_count` with the number of pages
        that survived the URL filter (i.e. matched the target goodsNo
        and were not internal/blank).
        """
        target = self._extract_target_goods_no(product_url)
        if target is None or self._ctx is None:
            self._existing_page_candidate_count = 0
            return None

        # `pages` is a sync property on Playwright BrowserContext (both
        # sync and async APIs). Tolerate any exception so a flaky CDP
        # state never blocks the fallback path.
        try:
            pages = list(self._ctx.pages)
        except Exception:
            self._existing_page_candidate_count = 0
            return None

        goods_marker = f"goodsNo={target}"
        skip_prefixes = (
            "about:blank",
            "chrome://newtab",
            "chrome://new-tab",
            "devtools://",
            "chrome://",
            "edge://",
            "view-source:",
        )

        candidates: list[tuple[int, int, object]] = []
        for idx, page in enumerate(pages):
            try:
                url = page.url or ""
            except Exception:
                continue
            if not url:
                continue
            # Internal / blank pages — never adoptable, even if the URL
            # somehow contains the goodsNo marker (defense against
            # pathological mocks and Playwright dev tooling).
            if any(url.startswith(p) for p in skip_prefixes):
                continue
            if goods_marker not in url:
                continue
            score = 1
            if "tab=review" in url:
                score += 3
            if "getGoodsDetail.do" in url:
                score += 2
            # `idx` is the natural-order tiebreaker (lower = earlier).
            candidates.append((score, idx, page))

        self._existing_page_candidate_count = len(candidates)
        if not candidates:
            return None
        # Highest score wins; on tie, lowest index (first-encountered).
        candidates.sort(key=lambda t: (-t[0], t[1]))
        return candidates[0][2]

    async def open(self, product_url: str) -> None:
        # v2.4.5 — flip the lifecycle flag IMMEDIATELY so the diagnostic
        # carries proof that open() was reached, even if a later step
        # (Playwright import, browser launch, page.goto) raises.
        self._product_image_capture_diagnostic["session_open_called"] = True
        self._product_image_capture_diagnostic[
            "session_open_url_at_start"
        ] = product_url

        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        if self._cdp_endpoint is not None:
            # Attach to a user-launched Chrome via remote debugging. We do not
            # own this browser — don't close it on teardown.
            self._browser = await self._pw.chromium.connect_over_cdp(self._cdp_endpoint)
            self._owns_browser = False
            if self._force_fresh_context:
                # SESSION RESET: create a fresh context inside the
                # user's CDP browser. Cookies / localStorage from the
                # default context are NOT carried over — the new
                # context starts unauthenticated and the operator
                # re-logs in manually. We OWN this fresh context, so
                # it is closed on teardown (the user's main context
                # is left untouched).
                logger.warning(
                    "OY browser: force_fresh_context=True — creating "
                    "new CDP context (cookies / localStorage NOT "
                    "reused; manual re-login required)",
                )
                self._ctx = await self._browser.new_context(locale="ko-KR")
                self._owns_context = True
            elif self._browser.contexts:
                # Default behavior: reuse the existing context (carries
                # the user's logged-in session).
                self._ctx = self._browser.contexts[0]
                self._owns_context = False
            else:
                # Edge case: no existing context. Create one but treat as owned.
                self._ctx = await self._browser.new_context(locale="ko-KR")
                self._owns_context = True
            # I-OY-CDP-PAGE-ADOPTION — before creating a fresh page,
            # see if the operator already has a tab open on this
            # goodsNo (preferably one with `&tab=review`). When the
            # adoption succeeds we skip the goto/navigation entirely:
            # the operator's own page is already on the review tab and
            # any additional click/scroll could regress it.
            adopted = self._maybe_adopt_existing_page(product_url)
            if adopted is not None:
                self._page = adopted
                self._adopted_existing_page = True
                try:
                    self._adopted_page_url_at_open = adopted.url
                except Exception:
                    self._adopted_page_url_at_open = None
                logger.info(
                    "OY browser: adopted_existing_page=true "
                    "candidate_count=%d page_url=%s",
                    self._existing_page_candidate_count,
                    self._adopted_page_url_at_open,
                )
            else:
                self._adopted_existing_page = False
                logger.info(
                    "OY browser: adopted_existing_page=false "
                    "candidate_count=%d (creating new page via fallback)",
                    self._existing_page_candidate_count,
                )
                self._page = await self._ctx.new_page()
        else:
            self._browser = await self._pw.chromium.launch(headless=self._headless)
            self._owns_browser = True
            ctx_kwargs: dict[str, object] = dict(
                locale="ko-KR",
                user_agent=self._user_agent,
                viewport=self._viewport,
                extra_http_headers={"Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"},
            )
            if self._storage_state_path is not None:
                ctx_kwargs["storage_state"] = str(self._storage_state_path)
            self._ctx = await self._browser.new_context(**ctx_kwargs)
            self._owns_context = True
            self._page = await self._ctx.new_page()

        # Remember the URL so the page-recreate path (false-empty
        # recovery) can re-navigate without callers threading it back.
        self._opened_product_url = product_url

        # Attach the per-response interceptor to the freshly-opened page.
        # Extracted as a method so `reload_and_reopen_review_tab` can
        # re-attach to a NEW page (Option A: page recreate) when
        # recovering from a poisoned session.
        self._attach_response_handler(self._page)

        # I-OY-CDP-PAGE-ADOPTION — when we adopted an existing page
        # we deliberately skip the goto. The operator's own page is
        # already on the product (often on `&tab=review`); navigating
        # again would (a) risk losing the current review-tab DOM the
        # operator can already see, and (b) defeat the purpose of
        # adoption. Downstream `_trigger_review_list_api` still runs
        # below and will idempotently activate the review tab if the
        # adopted page wasn't already there.
        if not self._adopted_existing_page:
            await self._page.goto(product_url, wait_until="domcontentloaded")
        # Capture the representative product image URL from og:image /
        # JSON-LD BEFORE the review-tab click. The page is on the
        # detail page HTML right now — `page.content()` is a passive
        # read (no nav, no click) so it cannot disturb the review API
        # watch that hasn't been attached to a review-tab DOM yet.
        # Wrapped in try/except so any failure here is silently
        # no-op — this MUST NOT alter scraping behavior.
        if self._observed_product_image_url is None:
            # v2.4.5 — flip BEFORE the capture call so the diagnostic
            # records "we got here". If `_capture_product_image_url_from_page`
            # itself raises, the flag stays True and `error` carries
            # the exception class.
            self._product_image_capture_diagnostic["capture_hook_reached"] = True
            try:
                # Extract goodsNo from the URL we just navigated to so
                # the OY-thumbnail-img fallback can match by goodsNo.
                goods_no_for_capture: str | None = None
                m = re.search(r"[?&]goodsNo=([A-Za-z0-9]+)", product_url or "")
                if m:
                    goods_no_for_capture = m.group(1)
                self._observed_product_image_url = (
                    await self._capture_product_image_url_from_page(
                        goods_no=goods_no_for_capture,
                    )
                )
            except Exception as e:
                self._product_image_capture_diagnostic["error"] = (
                    f"open_capture_raised: {type(e).__name__}"
                )
                logger.debug(
                    "OY product-image capture skipped (benign): %s", e,
                )
        # Review tab click + lazy-load trigger cascade. See
        # `_trigger_review_list_api` for the rationale — some product
        # pages render the review-tab DOM with metadata APIs fired
        # but the main cursor API never wakes up unless we also
        # scroll the section into view and try the 리뷰 더보기 button.
        await self._trigger_review_list_api(initial_click=True)

        # Best-effort total-review-count capture from the page DOM.
        # Phase 2E coverage_ratio / confidence_level depend on this
        # number when available; absence is acceptable (None propagates
        # through to provenance). Wrapped so any DOM-read failure is
        # silently no-op — this MUST NOT alter scraping behavior.
        if self._observed_total_review_count is None:
            try:
                self._observed_total_review_count = (
                    await self._capture_total_review_count_from_dom()
                )
            except Exception as e:
                logger.debug(
                    "OY total-count DOM capture skipped (benign): %s", e,
                )

        # Best-effort breadcrumb / category capture. Same contract as
        # total-count: never raises, never alters scraping behavior,
        # write-once. Used downstream to populate
        # analysis_report.product.category and to drive category
        # profile selection in the content adapter.
        if self._observed_breadcrumb is None:
            try:
                self._observed_breadcrumb = (
                    await self._capture_breadcrumb_from_dom()
                )
            except Exception as e:
                logger.debug(
                    "OY breadcrumb DOM capture skipped (benign): %s", e,
                )

        # Sort-button click (opt-in, non-default sorts only). The page's
        # cold-start API has already fired with the page-default sort
        # (USEFUL_SCORE_DESC). When sort selection is opted in, we click
        # the matching sort button; the page's JS then re-issues the
        # cursor API from cursor 0 with the new sortType. We do NOT
        # construct that body ourselves and we do NOT drain the queue —
        # the response filter in `_on_response` (keyed on
        # `_expected_sort_type`) drops the default-sort cold-start
        # response so it never reaches the consumer. The cold-start
        # consumer then waits for the post-click matching-sort response.
        if self._sort_button_label_ko is not None or self._sort_button_selector is not None:
            await self._click_sort_button_robust()

    async def _widen_sort_row_probe(self) -> None:
        """DOM probe widening before the main hunt.

        Two coupled, idempotent actions inside the sort scope ONLY:

          1. Scroll the first matching `_sort_container_candidates`
             element into view. No-op when the row is already visible.
          2. If the target sort label is still absent, click ONE
             disclosure affordance (exact-text match against the
             curated `_sort_disclosure_affordance_labels_ko` allow-list)
             inside the sort scope. The hunt loop re-polls afterward.

        Operator constraints honored:

          - **Exact-text only** (NOT substring) — `랭킹` contains `랭`,
            and substring-matching against page-wide nav has historically
            misdirected clicks.
          - **At most one disclosure click per probe** — the first
            allow-listed match clicks; the loop exits regardless of
            whether the click revealed the target.
          - **Scope-limited** — both the scroll and the disclosure
            click are constrained to `_sort_container_candidates` hits.
            Page-wide enumeration is reserved for the existing hunt
            loop's page-wide fallback.

        Best-effort: every Playwright call is wrapped; failures fall
        through to the existing hunt path. Behavior on already-visible
        sort row: scroll-into-view is a no-op; the disclosure probe
        never fires because the rating label is found on first poll
        in the main hunt.
        """
        import re

        target_ko = self._sort_button_label_ko
        page = self._page
        if page is None or target_ko is None:
            return

        def _normalize(s: str) -> str:
            return re.sub(r"\s+", " ", s or "").strip()

        # Pick the first container candidate that exists on the page.
        # We attempt scroll-into-view on this single hit; subsequent
        # candidates are not walked (idempotency: scrolling the FIRST
        # match into view brings the sort row into the viewport, and
        # repeated scrolls add noise without changing state).
        first_container = None
        for selector in self._sort_container_candidates:
            try:
                container = page.locator(selector).first
                if await container.count() > 0:
                    first_container = container
                    break
            except Exception:
                continue

        if first_container is not None:
            try:
                await first_container.scroll_into_view_if_needed(
                    timeout=1000,
                )
            except Exception as e:
                logger.debug(
                    "OY sort-scope scroll-into-view skipped (benign): %s",
                    e,
                )

        # Probe whether the target label is already inline-rendered
        # inside any of the candidate containers. If yes, skip the
        # disclosure-affordance click entirely — the existing hunt loop
        # will find it on its first poll.
        target_visible = False
        for selector in self._sort_container_candidates:
            try:
                container = page.locator(selector).first
                if await container.count() == 0:
                    continue
            except Exception:
                continue
            for tag_selector in ("button", "a", "[role='button']"):
                try:
                    el_locator = container.locator(tag_selector)
                    n = await el_locator.count()
                except Exception:
                    continue
                for i in range(n):
                    try:
                        cand = el_locator.nth(i)
                        txt = await cand.inner_text(timeout=1000)
                    except Exception:
                        continue
                    if _normalize(txt) == target_ko:
                        target_visible = True
                        break
                if target_visible:
                    break
            if target_visible:
                break

        if target_visible:
            return

        # Target absent. Try ONE disclosure affordance click inside the
        # sort scope. Allow-list matching only — broader substrings
        # would risk clicking category-nav rows.
        if not self._sort_disclosure_affordance_labels_ko:
            return
        disclosure_set = set(self._sort_disclosure_affordance_labels_ko)
        clicked_disclosure: str | None = None
        for selector in self._sort_container_candidates:
            if clicked_disclosure is not None:
                break
            try:
                container = page.locator(selector).first
                if await container.count() == 0:
                    continue
            except Exception:
                continue
            for tag_selector in ("button", "a", "[role='button']"):
                if clicked_disclosure is not None:
                    break
                try:
                    el_locator = container.locator(tag_selector)
                    n = await el_locator.count()
                except Exception:
                    continue
                for i in range(n):
                    try:
                        cand = el_locator.nth(i)
                        txt = await cand.inner_text(timeout=1000)
                    except Exception:
                        continue
                    norm = _normalize(txt)
                    if norm in disclosure_set:
                        try:
                            try:
                                await cand.scroll_into_view_if_needed(
                                    timeout=1000,
                                )
                            except Exception:
                                pass
                            await cand.click(timeout=3000)
                            clicked_disclosure = norm
                        except Exception as e:
                            logger.info(
                                "OY sort-disclosure %r click failed "
                                "(benign): %s",
                                norm, e,
                            )
                        # First match in this iteration wins. Whether
                        # the click succeeded or not, do not iterate
                        # through additional affordances on this probe
                        # — operator contract: at most one disclosure
                        # click per probe attempt.
                        break

        if clicked_disclosure is not None:
            logger.info(
                "OY sort-disclosure clicked: affordance=%r target=%r "
                "(re-polling for target label)",
                clicked_disclosure, target_ko,
            )

    async def _click_sort_button_robust(self) -> None:
        """Find and click the OY review sort button matching
        `self._sort_button_label_ko`.

        Polls within a total deadline (`_sort_hunt_settle_s`) because OY
        renders the sort row in a JS pass that has been observed to take
        anywhere from ~1s to ~8s after the review-tab click — a single
        sleep-then-hunt is too brittle. Each iteration:

          1. **Container-scoped exact-text match** — enumerate buttons in
             each candidate sort container, normalize inner text
             (`re.sub(r"\\s+", " ", t).strip()`), compare equality.
          2. **Page-wide exact-text match** — same enumeration without scope.
          3. **Legacy `has-text` selector** — final fallback.

        Click on first match. If the deadline expires, log the full
        inventory of seen button labels (deduped) so the operator can
        diagnose what OY actually rendered. The connector's response
        filter (`_expected_sort_type`) then ensures cold-start times out
        cleanly rather than mis-stamping default-sort rows.

        Before entering the deadline poll, runs `_widen_sort_row_probe`
        once: scroll-into-view + (conditionally) one disclosure-affordance
        click inside the sort scope. The probe is idempotent on
        already-visible sort rows and only fires when the target label
        is absent.

        On deadline expiry without a click (target_ko set), records
        `_sort_control_unreachable=True`. The connector drains this into
        the run summary, where downstream classifier maps it to the
        terminal status `sort_control_unreachable` (distinct from
        `blocked_or_empty_state`).
        """
        import re
        import time as _time

        target_ko = self._sort_button_label_ko
        legacy_selector = self._sort_button_selector
        expected = self._expected_sort_type
        page = self._page
        if page is None:  # defensive — open() should have set it
            return

        # Reset terminal flag at the start of every hunt — the session
        # might be re-used across attempts if the false-empty recovery
        # path re-creates the page; we want this signal to reflect the
        # MOST RECENT hunt's outcome.
        self._sort_control_unreachable = False

        # Widen the DOM probe before the main hunt. Idempotent on
        # already-visible sort rows.
        if target_ko is not None:
            try:
                await self._widen_sort_row_probe()
            except Exception as e:
                logger.debug(
                    "OY sort-row widening probe skipped (benign): %s", e,
                )

        def _normalize(s: str) -> str:
            return re.sub(r"\s+", " ", s or "").strip()

        async def _try_click_in_scope(scope_locator) -> tuple[bool, list[str]]:
            """Click the element inside `scope_locator` whose normalized inner
            text == target_ko. Returns (clicked, labels_seen).

            Enumerates `button`, `a`, and `[role=button]` elements — OY's
            sort row has historically mixed all three. A pure `button`-only
            scan was empirically observed to miss labels rendered as
            `<a class="..."><span>최신순</span></a>` or as a `<div
            role="button">` wrapper.
            """
            labels_seen: list[str] = []
            for tag_selector in ("button", "a", "[role='button']"):
                try:
                    el_locator = scope_locator.locator(tag_selector)
                    n = await el_locator.count()
                except Exception:
                    continue
                for i in range(n):
                    try:
                        cand = el_locator.nth(i)
                        txt = await cand.inner_text(timeout=1000)
                    except Exception:
                        continue
                    norm = _normalize(txt)
                    if norm:
                        labels_seen.append(norm)
                    if target_ko is not None and norm == target_ko:
                        try:
                            try:
                                await cand.scroll_into_view_if_needed(timeout=1000)
                            except Exception:
                                pass
                            await cand.click(timeout=5000)
                            return True, labels_seen
                        except Exception as e:
                            logger.info(
                                "OY sort-button %r matched but click failed (%s): %s",
                                target_ko, tag_selector, e,
                            )
                            continue
            return False, labels_seen

        # Poll loop. Total budget = `_sort_hunt_settle_s`; iterate every
        # `_sort_hunt_poll_interval_s` until the target label appears.
        deadline = _time.monotonic() + max(self._sort_hunt_settle_s, 0.0)
        clicked = False
        scope_used: str | None = None
        all_labels_seen: list[str] = []
        attempt = 0
        while not clicked and _time.monotonic() < deadline:
            attempt += 1
            # Container-scoped exact match — preferred (less noisy).
            if target_ko is not None:
                for selector in self._sort_container_candidates:
                    try:
                        container = page.locator(selector).first
                        if await container.count() == 0:
                            continue
                    except Exception:
                        continue
                    ok, labels = await _try_click_in_scope(container)
                    all_labels_seen.extend(labels)
                    if ok:
                        clicked = True
                        scope_used = selector
                        break
            # Page-wide exact match.
            if not clicked and target_ko is not None:
                ok, labels = await _try_click_in_scope(page)
                all_labels_seen.extend(labels)
                if ok:
                    clicked = True
                    scope_used = "<page>"
            # Legacy `has-text` fallback. Substring matcher; tried each
            # iteration since it doesn't enumerate.
            if not clicked and legacy_selector is not None:
                try:
                    btn = page.locator(legacy_selector).first
                    if await btn.count() > 0:
                        try:
                            await btn.scroll_into_view_if_needed(timeout=1000)
                        except Exception:
                            pass
                        await btn.click(timeout=5000)
                        clicked = True
                        scope_used = f"legacy:{legacy_selector!r}"
                except Exception as e:
                    logger.info(
                        "OY legacy sort-button click %r failed (poll attempt %d): %s",
                        legacy_selector, attempt, e,
                    )
            if not clicked:
                try:
                    await asyncio.sleep(self._sort_hunt_poll_interval_s)
                except Exception:
                    break

        # Persist deduped labels for the connector's summary diagnostic.
        # Cap at 50 to keep the summary compact.
        self._last_seen_sort_labels = sorted(set(all_labels_seen))[:50]
        if clicked:
            logger.info(
                "OY sort-button clicked: target=%r expected_sort=%r scope=%s "
                "poll_attempt=%d",
                target_ko, expected, scope_used, attempt,
            )
        else:
            # De-duplicate labels for log compactness.
            seen_unique = sorted(set(all_labels_seen))[:50]
            # Mark the run for terminal `sort_control_unreachable`
            # status. Only fires when a target was set (target_ko is
            # not None) — when target_ko is None (page-default sort),
            # not finding it is expected and is not a failure mode.
            if target_ko is not None:
                self._sort_control_unreachable = True
            logger.warning(
                "OY sort-button %r NOT FOUND after %d poll attempts in "
                "%.1fs deadline. expected_sort=%r. Buttons enumerated in "
                "sort area (normalized text, deduped, first 50): %r. The "
                "response filter will reject any non-matching sortType so "
                "cold-start will time out cleanly — investigate the actual "
                "labels above.",
                target_ko, attempt, self._sort_hunt_settle_s, expected,
                seen_unique,
            )

    async def is_false_empty_state(self) -> bool | None:
        """Probe for OY's false empty-review state markers.

        Returns:
          True   — at least one false-empty marker is visible on the page
          False  — all configured markers are absent
          None   — probe could not run (page closed / DOM error). Caller
                   should treat as "unknown" and not trigger a retry.

        Detection is by Playwright text engine (`text=...`); matches any
        descendant text node containing the marker substring after
        whitespace normalization. Defensive against minor DOM refactors:
        we don't lock onto a class name, only the visible Korean text.
        """
        page = self._page
        if page is None or not self._false_empty_markers_ko:
            return None
        try:
            for marker in self._false_empty_markers_ko:
                # Use text= engine so a wrapper element like
                # `<div class="empty"><i></i><span>등록된 리뷰가 없어요</span></div>`
                # still matches. `count() > 0` is sufficient — we only
                # need presence, not interactability.
                loc = page.locator(f"text={marker}").first
                try:
                    n = await loc.count()
                except Exception:
                    continue
                if n > 0:
                    return True
            return False
        except Exception as e:
            logger.debug("OY false-empty probe failed: %s", e)
            return None

    async def is_interstitial_state(self) -> bool | None:
        """Probe for OY anti-bot / human-verification / login-wall
        markers (`INTERSTITIAL_MARKERS_KO`).

        Returns:
          True   — at least one interstitial marker is visible on the page
          False  — none of the configured markers are present
          None   — probe could not run (page closed / DOM error). Caller
                   should treat as "unknown" and not flip detection state.

        Mirrors `is_false_empty_state` exactly — text-engine substring
        match, defensive against minor DOM refactors. Distinct from the
        false-empty probe because the recovery action differs:
        false-empty triggers an in-session page-recreate; interstitial
        triggers an operator-driven wait-and-resume (CAPTCHA / login).
        """
        page = self._page
        if page is None or not self._interstitial_markers_ko:
            return None
        try:
            for marker in self._interstitial_markers_ko:
                loc = page.locator(f"text={marker}").first
                try:
                    n = await loc.count()
                except Exception:
                    continue
                if n > 0:
                    return True
            return False
        except Exception as e:
            logger.debug("OY interstitial probe failed: %s", e)
            return None

    async def _trigger_review_list_api(
        self, *, initial_click: bool = True,
    ) -> None:
        """Best-effort cascade to wake the cursor API.

        Three steps, all idempotent:
          1. Click the review tab (skipped when `initial_click=False`,
             which is what `reload_and_reopen_review_tab` passes after
             it has already done its own click).
          2. Scroll the review section into view (wakes
             IntersectionObserver-based lazy-load).
          3. Click `리뷰 더보기` if visible (some pages render only
             the static count without auto-fetching the list).

        Each step is wrapped — failures are logged at debug and never
        raise. The actual response capture is unchanged; this method
        only nudges the page so the existing response interceptor has
        something to capture.

        Telemetry: `_review_more_button_clicked` /
        `_scrolled_to_review_area` flip True when a step actually
        executed. Surfaces via `prod_summary` so downstream status
        mapping can reclassify `unknown_failure` to
        `review_list_api_not_seen_but_review_meta_seen` when meta
        APIs fired but the list API never did.
        """
        if self._page is None:
            return
        # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG — local outcome
        # bookkeeping for the optional trigger-outcome diagnostic line.
        # These locals are written by the steps below regardless of the
        # diagnostic flag (zero overhead — assignments are cheap); the
        # summary line is only emitted when the flag is True. Behavior
        # of every step is unchanged.
        review_tab_locator_count: int | str = "unknown"
        review_tab_scroll_into_view: str = "skipped"
        review_tab_click_attempted: bool = False
        review_tab_click_raised: bool = False
        window_scroll_by_executed: bool = False
        # Step 1: review-tab click.
        if initial_click:
            try:
                tab = self._page.locator(self._review_tab_locator).first
                try:
                    review_tab_locator_count = int(await tab.count())
                except Exception:
                    review_tab_locator_count = "unknown"
                if (
                    isinstance(review_tab_locator_count, int)
                    and review_tab_locator_count > 0
                ):
                    review_tab_click_attempted = True
                    try:
                        await tab.click(timeout=5000)
                    except Exception:
                        review_tab_click_raised = True
                        raise
            except Exception as e:
                logger.info(
                    "OY review-tab click skipped/failed (benign): %s", e,
                )
        # Step 2: scroll review section into view. Both
        # `scroll_into_view_if_needed` AND a manual page scroll are
        # attempted because OY's IntersectionObserver thresholds vary
        # by build.
        try:
            tab = self._page.locator(self._review_tab_locator).first
            # Refresh the count if Step 1 didn't run (initial_click=False).
            if review_tab_locator_count == "unknown":
                try:
                    review_tab_locator_count = int(await tab.count())
                except Exception:
                    review_tab_locator_count = "unknown"
            if (
                isinstance(review_tab_locator_count, int)
                and review_tab_locator_count > 0
            ):
                try:
                    await tab.scroll_into_view_if_needed(timeout=3000)
                    self._scrolled_to_review_area = True
                    review_tab_scroll_into_view = "ok"
                except Exception:
                    review_tab_scroll_into_view = "failed"
                    raise
        except Exception as e:
            logger.debug(
                "OY scroll-into-view skipped (benign): %s", e,
            )
        try:
            # Window scroll wakes observers that don't fire on
            # element scroll alone.
            await self._page.evaluate(
                "() => window.scrollBy(0, window.innerHeight * 2)"
            )
            window_scroll_by_executed = True
        except Exception:
            pass
        # Step 3: 리뷰 더보기 click (best-effort).
        for sel in self.REVIEW_MORE_LOCATORS:
            try:
                more = self._page.locator(sel).first
                if await more.count() > 0:
                    await more.click(timeout=3000)
                    self._review_more_button_clicked = True
                    break
            except Exception as e:
                logger.debug(
                    "OY 리뷰 더보기 click via %s skipped (benign): %s",
                    sel, e,
                )
        # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG — emit a single
        # compact summary line ONLY when the page-state diagnostic flag
        # is True (i.e. inside the recovery window). The summary
        # describes which review-tab cascade steps actually executed,
        # which is the surface where the live proof showed the
        # cascade not bringing the sort palette into the DOM. The
        # behavior of the cascade is unchanged whether the flag is on
        # or off; only the log emission is gated.
        try:
            if getattr(
                self, "_diagnose_post_recreate_page_state", False,
            ):
                logger.info(
                    "OY recovery trigger outcome: "
                    "review_tab_locator_count=%s "
                    "review_tab_scroll_into_view=%s "
                    "review_tab_click_attempted=%s "
                    "review_tab_click_raised=%s "
                    "window_scroll_by_executed=%s",
                    review_tab_locator_count,
                    review_tab_scroll_into_view,
                    "true" if review_tab_click_attempted else "false",
                    "true" if review_tab_click_raised else "false",
                    "true" if window_scroll_by_executed else "false",
                )
        except Exception:
            pass

    def get_review_more_button_clicked(self) -> bool:
        """Telemetry getter — True iff the cascade clicked
        리뷰 더보기 during this session."""
        return self._review_more_button_clicked

    def get_scrolled_to_review_area(self) -> bool:
        """Telemetry getter — True iff the cascade scrolled the
        review section into view during this session."""
        return self._scrolled_to_review_area

    async def _wait_for_review_sort_area_ready(
        self, *, timeout_s: float, poll_interval_s: float,
        recovery_lazy_mount_nudge: bool = False,
    ) -> bool:
        """I-OY-RECOVERY-WAIT-FOR-REVIEW-TAB-RENDER.

        Bounded poll for the recreated page's review-tab sort area to
        render. Returns True as soon as either signal is observed:

          (a) A `_sort_container_candidates` selector matches at least
              one element on the page (the OY review sort row container,
              `div.pc-sort` in production), OR
          (b) The target sort label (`_sort_button_label_ko`) is present
              as exact normalized text inside the sort scope.

        Both signals reuse infrastructure that `_widen_sort_row_probe`
        and `_click_sort_button_robust` already rely on, so no new
        fragile selectors are introduced. Signal (a) is the primary
        early-exit — the container existing is the necessary precondition
        for the subsequent sort-button hunt to succeed. Signal (b) is a
        stronger ready signal used when the target label is configured.

        Returns False on deadline expiry without an observation. Never
        raises — every Playwright call is wrapped so the caller can
        fall through to the existing sort-button hunt (which has its
        own deadline + diagnostic path).

        Why a separate wait vs leaning on `_click_sort_button_robust`'s
        own `_sort_hunt_settle_s` budget: the post-recreate Ilso log on
        A000000225736 showed the sort-button hunt enumerating site-nav
        buttons (categories, share, footer items) — i.e. the hunt found
        SOMETHING to enumerate but the review-tab sort palette had not
        rendered yet, so the hunt scope (`page.locator("button")` etc.)
        matched unrelated DOM. Waiting for `div.pc-sort` to exist
        BEFORE the hunt starts ensures the hunt's enumeration is
        scoped to the actual sort row.

        I-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-PROBE: when
        `recovery_lazy_mount_nudge=True` (recovery cascade callers
        only — cold-start callers MUST omit / pass False), and the
        primary deadline expires WITH a partial-mount signal
        (review-count text mounted but sort header absent — see
        `_is_partial_review_mount_state`), the wait fires a single
        bounded round-trip scroll nudge (+280px / -280px) to try to
        trigger an intersection-observer-based lazy mount, then runs
        an additional 1.5s readiness budget against the same poll
        machinery. Bounded to ONE nudge per call regardless of how
        many polls match the partial-mount predicate. Cold-start
        callers omit the flag → behavior identical to pre-ticket
        readiness wait.
        """
        import time as _time

        import re

        page = self._page
        if page is None:
            return False

        target_ko = self._sort_button_label_ko

        def _normalize(s: str) -> str:
            return re.sub(r"\s+", " ", s or "").strip()

        # I-OY-RECOVERY-SCROLL-TO-REVIEW-SORT-AND-CLICK — reset
        # side-channel handles on every entry so a previous wait's
        # matched-button stale handle never leaks into a subsequent
        # cascade. Set inside the inner probes when the corresponding
        # signal fires; the caller reads them immediately after this
        # method returns True.
        self._last_readiness_matched_button = None
        self._last_readiness_matched_container = None

        async def _container_visible() -> bool:
            for selector in self._sort_container_candidates:
                try:
                    container = page.locator(selector).first
                    if await container.count() > 0:
                        # Side-channel: record the FIRST matching
                        # container so the caller can pre-scroll it
                        # into view when only the weaker
                        # `container_visible` signal fires.
                        if self._last_readiness_matched_container is None:
                            self._last_readiness_matched_container = container
                        return True
                except Exception:
                    continue
            return False

        async def _target_label_visible() -> bool:
            if target_ko is None:
                return False
            for selector in self._sort_container_candidates:
                try:
                    container = page.locator(selector).first
                    if await container.count() == 0:
                        continue
                except Exception:
                    continue
                for tag_selector in ("button", "a", "[role='button']"):
                    try:
                        el_locator = container.locator(tag_selector)
                        n = await el_locator.count()
                    except Exception:
                        continue
                    for i in range(n):
                        try:
                            cand = el_locator.nth(i)
                            txt = await cand.inner_text(timeout=1000)
                        except Exception:
                            continue
                        if _normalize(txt) == target_ko:
                            # Side-channel: record the matched
                            # button locator so the caller can do a
                            # scoped immediate click without
                            # re-querying the DOM (eliminating the
                            # 12-second race observed on Ilso
                            # A000000225736 where the readiness wait
                            # saw `최신순` but the subsequent hunt
                            # could not find it).
                            self._last_readiness_matched_button = cand
                            return True
            return False

        deadline = _time.monotonic() + max(timeout_s, 0.0)
        attempt = 0
        signal_used: str | None = None
        # I-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-PROBE — bound the nudge
        # to at most ONE attempt per readiness wait. Flipped True the
        # moment the nudge fires regardless of success; the deadline-
        # approaching predicate refuses to re-fire while True.
        _lazy_mount_nudge_attempted = False
        while _time.monotonic() < deadline:
            attempt += 1
            try:
                # Primary signal: sort container exists in DOM. Necessary
                # precondition for the subsequent sort-button hunt to
                # find anything; once it's visible the hunt's own poll
                # budget can wait for the target label to mount.
                if await _container_visible():
                    signal_used = "container_visible"
                    # Stronger secondary check: if the target label is
                    # configured AND already inline-rendered, surface
                    # that in the log for diagnostics. Either signal
                    # short-circuits the readiness wait.
                    if target_ko is not None:
                        try:
                            if await _target_label_visible():
                                signal_used = "target_label_visible"
                        except Exception:
                            pass
                    logger.info(
                        "OY review sort area ready after recreate: "
                        "signal=%s target=%r poll_attempt=%d",
                        signal_used, target_ko, attempt,
                    )
                    return True
            except Exception as e:
                logger.debug(
                    "OY review sort area readiness probe raised (benign): %s",
                    e,
                )
            try:
                await asyncio.sleep(max(poll_interval_s, 0.0))
            except Exception:
                break

        # I-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-PROBE — recovery-only
        # diagnostic-first nudge to break the "review count rendered
        # but sort header lazy-component never mounted" state seen in
        # the O-OY-SCROLL-RECOVERY-BUDGET-FIX-LIVE-PROOF-ILSO proof
        # (HEAD c76f971). The previous retry path was upstream-gated
        # because the readiness wait never produced a matched locator
        # to retry against — every snapshot showed sort_pc_count=0
        # AND text_has_review_count=true. Hypothesis: the sort header
        # is wrapped in an intersection-observer-based lazy mount that
        # never fires because the viewport never crossed the trigger
        # region. A small bounded scroll round-trip is the smallest
        # intervention that can disambiguate (and potentially fix)
        # this state without risking content-shift to the live
        # collection.
        #
        # Gated to recovery callers only (`recovery_lazy_mount_nudge`
        # default False). Cold-start path is unaffected.
        if (
            recovery_lazy_mount_nudge
            and not _lazy_mount_nudge_attempted
        ):
            partial_state: dict | None = None
            try:
                partial_state = (
                    await self._compute_recovery_page_state_dict()
                )
            except Exception:
                partial_state = None
            if (
                partial_state is not None
                and _is_partial_review_mount_state(partial_state)
            ):
                # Three-line diagnostic block. Recovery-scoped: only
                # emitted when the caller asked for the nudge path AND
                # the partial-mount predicate fires. The cold-start
                # path (recovery_lazy_mount_nudge=False) never reaches
                # here so these log strings stay quiet on the happy
                # path.
                logger.info(
                    "OY recovery sort header partial mount detected: "
                    "checkpoint=%s review_count_present=%s "
                    "sort_pc_count=%d sort_container_count=%d "
                    "text_has_choisin=%s readyState=%s "
                    "url_has_tab_review=%s",
                    "sort_readiness_timeout",
                    partial_state.get("text_has_review_count", "unknown"),
                    int(partial_state.get("sort_pc_count", "0") or 0),
                    int(partial_state.get("sort_container_count", "0") or 0),
                    partial_state.get("text_has_choisin", "unknown"),
                    partial_state.get("readyState", "unknown"),
                    partial_state.get("url_has_tab_review", "unknown"),
                )
                _nudge_start_monotonic = _time.monotonic()
                # Strategy id is logged BEFORE the JS evaluate so the
                # post-mortem can correlate the nudge intent even if
                # the page closes mid-evaluate.
                _nudge_strategy = "scrollby_280px_round_trip"
                _nudge_delta_px = 280
                logger.info(
                    "OY recovery sort header lazy-mount nudge: "
                    "strategy=%s delta_px=%d",
                    _nudge_strategy, _nudge_delta_px,
                )
                _lazy_mount_nudge_attempted = True
                _nudge_raised = False
                try:
                    await page.evaluate(
                        "() => { window.scrollBy(0, 280); }",
                    )
                    await asyncio.sleep(0.15)
                    await page.evaluate(
                        "() => { window.scrollBy(0, -280); }",
                    )
                    await asyncio.sleep(0.15)
                except Exception as _nudge_exc:
                    logger.debug(
                        "OY recovery sort header lazy-mount nudge "
                        "evaluate raised (benign): %s", _nudge_exc,
                    )
                    _nudge_raised = True

                # Additional bounded readiness budget after the nudge.
                # Mirrors the surrounding poll cadence (poll_interval_s)
                # and reuses `_container_visible` / `_target_label_visible`
                # — does NOT re-implement the readiness check, so the
                # side-channel `_last_readiness_matched_button` /
                # `_last_readiness_matched_container` are populated
                # identically to the normal readiness path on success.
                _nudge_post_budget_s = 1.5
                _nudge_deadline = (
                    _time.monotonic() + _nudge_post_budget_s
                )
                _post_attempt = 0
                _nudge_signal_used: str | None = None
                while (
                    not _nudge_raised
                    and _time.monotonic() < _nudge_deadline
                ):
                    _post_attempt += 1
                    try:
                        if await _container_visible():
                            _nudge_signal_used = "container_visible"
                            if target_ko is not None:
                                try:
                                    if await _target_label_visible():
                                        _nudge_signal_used = (
                                            "target_label_visible"
                                        )
                                except Exception:
                                    pass
                            # Re-read state for the result log.
                            try:
                                _post_state = (
                                    await self._compute_recovery_page_state_dict()
                                )
                            except Exception:
                                _post_state = None
                            _spc = (
                                _post_state.get("sort_pc_count", "0")
                                if _post_state else "0"
                            )
                            _sbc = (
                                _post_state.get(
                                    "sort_button_candidates", "0",
                                )
                                if _post_state else "0"
                            )
                            _elapsed_ms = int(
                                (_time.monotonic() - _nudge_start_monotonic)
                                * 1000.0,
                            )
                            logger.info(
                                "OY recovery sort header lazy-mount "
                                "nudge result: success=%s "
                                "sort_pc_count_after=%d "
                                "sort_button_candidates_after=%d "
                                "elapsed_ms=%d",
                                "true",
                                int(_spc) if str(_spc).isdigit() else 0,
                                int(_sbc) if str(_sbc).isdigit() else 0,
                                _elapsed_ms,
                            )
                            logger.info(
                                "OY review sort area ready after recreate: "
                                "signal=%s target=%r poll_attempt=%d",
                                _nudge_signal_used,
                                target_ko,
                                attempt + _post_attempt,
                            )
                            return True
                    except Exception as e:
                        logger.debug(
                            "OY review sort area readiness probe "
                            "raised (benign): %s",
                            e,
                        )
                    try:
                        await asyncio.sleep(max(poll_interval_s, 0.0))
                    except Exception:
                        break

                # Additional budget elapsed (or nudge raised) without
                # observing the sort area. Log the failed nudge
                # result before falling through to the existing
                # timeout path. The classifier outcome remains
                # `sort_control_unreachable` / `recovered=false`.
                _elapsed_ms = int(
                    (_time.monotonic() - _nudge_start_monotonic) * 1000.0,
                )
                logger.info(
                    "OY recovery sort header lazy-mount nudge result: "
                    "success=%s sort_pc_count_after=%d "
                    "sort_button_candidates_after=%d elapsed_ms=%d",
                    "false", 0, 0, _elapsed_ms,
                )

        logger.warning(
            "OY review sort area NOT ready after %d poll attempts in "
            "%.1fs deadline. target=%r. The subsequent sort-button hunt "
            "will run anyway and will produce its own diagnostic if it "
            "deadlines.",
            attempt, timeout_s, target_ko,
        )
        # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG — snapshot the
        # page state on the readiness-deadline branch so the
        # post-mortem can see what DOM the page DOES have when the
        # sort area never appeared. This is the surface the prior
        # live proof showed only nav/share/category buttons in the
        # enumeration; the snapshot fields will confirm whether the
        # sort container was simply absent or whether some other
        # container shadowed the probe. Best-effort, no-op when the
        # diagnostic flag is False.
        try:
            await self._snapshot_recovery_page_state(
                checkpoint="sort_readiness_timeout",
            )
        except Exception:
            pass
        return False

    def _reload_strategy_eligible(self) -> bool:
        """I-OY-RECOVERY-RECREATE-STRATEGY-REVISION.

        True iff the reload-first recovery path can be safely attempted.

        Conditions (ALL must hold):
          - `self._page` is not None (we have a page object to reload).
          - `self._opened_product_url` is set AND contains a goodsNo
            (i.e. `_extract_target_goods_no` resolves a non-empty target).
          - The current page URL contains `goodsNo=<target>` — i.e. the
            page object we'd reload is still on the SAME product. This
            guards against an unrelated drift (e.g. mid-stream navigation
            to a different page) where reloading would land us nowhere
            useful.

        Why this matters: the live proof on Ilso A000000225736 showed
        the wedged page had successfully served 49 cursors before the
        scrolls stopped producing new responses. The review-tab DOM was
        clearly mounted and functional on that page. The subsequent
        close+new_page+goto recreate threw all of that state away and
        landed on a page where the review-tab DOM never re-mounted
        (only site-nav / footer buttons enumerated). Reloading the
        original page is a less disruptive intervention — it preserves
        the page-level identity (cookies, in-memory JS context, the
        Playwright listener registration) while resetting the document.

        Returns False when the eligibility conditions are not met; the
        caller falls through to the existing close+new_page+goto
        recreate path unchanged.
        """
        if self._page is None:
            return False
        if not self._opened_product_url:
            return False
        target = self._extract_target_goods_no(self._opened_product_url)
        if not target:
            return False
        try:
            current_url = self._page.url or ""
        except Exception:
            return False
        return f"goodsNo={target}" in current_url

    async def _compute_recovery_page_state_dict(self) -> dict | None:
        """I-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-PROBE — internal helper
        that builds the recovery page-state snapshot dict WITHOUT
        emitting the diagnostic log line. Returns the same key/value
        shape (stringified values: "true"/"false"/"unknown" for
        booleans; "<n>"/"unknown" for counts) that
        `_snapshot_recovery_page_state` logs.

        Returns None when `self._page` is None (no page to probe).
        Extracted from `_snapshot_recovery_page_state` so the
        recovery readiness wait can read the same canonical state
        the diagnostic log line emits — `_is_partial_review_mount_state`
        is then a pure dict predicate fed by this helper, keeping the
        runtime predicate and the post-mortem log line bit-for-bit
        aligned.

        Every probe is wrapped in try/except for the same best-effort
        reason as the logging helper; a malformed Playwright page
        cannot abort recovery via a diagnostic call.
        """
        page = self._page
        if page is None:
            return None

        def _bool_str(v: bool) -> str:
            return "true" if v else "false"

        # URL.
        try:
            url = page.url or "unknown"
        except Exception:
            url = "unknown"
        # readyState.
        try:
            ready_state = await page.evaluate(
                "() => document.readyState",
            )
            if not isinstance(ready_state, str):
                ready_state = "unknown"
        except Exception:
            ready_state = "unknown"
        # Title.
        try:
            title = await page.title()
            if not isinstance(title, str):
                title = "unknown"
            else:
                if len(title) > 60:
                    title = title[:60]
        except Exception:
            title = "unknown"
        # URL contains target goodsNo / tab=review.
        url_has_goodsno: str = "unknown"
        try:
            target = None
            if self._opened_product_url:
                target = self._extract_target_goods_no(
                    self._opened_product_url,
                )
            if target and isinstance(url, str):
                url_has_goodsno = _bool_str(
                    f"goodsNo={target}" in url,
                )
            elif isinstance(url, str):
                url_has_goodsno = "false"
        except Exception:
            url_has_goodsno = "unknown"
        url_has_tab_review: str = "unknown"
        try:
            if isinstance(url, str):
                url_has_tab_review = _bool_str("tab=review" in url)
        except Exception:
            url_has_tab_review = "unknown"
        # Sort-container counts.
        async def _count(selector: str) -> str:
            try:
                n = await page.locator(selector).count()
                return str(int(n))
            except Exception:
                return "unknown"

        sort_pc_count = await _count("div.pc-sort")
        sort_container_count = await _count(".sort-container")
        sort_classmatch_count = await _count("[class*='sort']")
        # Review-tab locator count.
        review_tab_count: str = "unknown"
        try:
            if getattr(self, "_review_tab_locator", None):
                review_tab_count = await _count(self._review_tab_locator)
        except Exception:
            review_tab_count = "unknown"

        # Text-presence probes.
        async def _text_present(s: str) -> str:
            try:
                n = await page.locator(f"text={s}").count()
                return _bool_str(int(n) > 0)
            except Exception:
                return "unknown"

        text_has_choisin = await _text_present("최신순")
        text_has_yuyong = await _text_present("유용한 순")
        text_has_rating_desc = await _text_present("평점 높은순")
        text_has_rating_asc = await _text_present("평점 낮은순")
        text_has_review_count = await _text_present("리뷰")

        # Sort-button candidates: count interactive descendants of the
        # first non-zero `_sort_container_candidates` match. This is
        # the surface where the live-proof button enumeration showed
        # ONLY nav/share/category labels (no review controls). A
        # non-zero count here with all-zero text_has_* signals would
        # indicate "wrong subtree mounted" vs "no subtree mounted".
        sort_button_candidates: str = "unknown"
        try:
            for selector in getattr(self, "_sort_container_candidates", ()):
                try:
                    container = page.locator(selector).first
                    n = await container.count()
                    if int(n) == 0:
                        continue
                except Exception:
                    continue
                total = 0
                for tag_selector in (
                    "button", "a", "[role='button']",
                ):
                    try:
                        sub = container.locator(tag_selector)
                        total += int(await sub.count())
                    except Exception:
                        continue
                sort_button_candidates = str(total)
                break
            else:
                # No matching container — record 0 so the field
                # distinguishes "no container" from "probe failed".
                if getattr(self, "_sort_container_candidates", ()):
                    sort_button_candidates = "0"
        except Exception:
            sort_button_candidates = "unknown"

        return {
            "url": url,
            "readyState": ready_state,
            "title": title,
            "url_has_goodsno": url_has_goodsno,
            "url_has_tab_review": url_has_tab_review,
            "sort_pc_count": sort_pc_count,
            "sort_container_count": sort_container_count,
            "sort_classmatch_count": sort_classmatch_count,
            "review_tab_count": review_tab_count,
            "text_has_choisin": text_has_choisin,
            "text_has_yuyong": text_has_yuyong,
            "text_has_rating_desc": text_has_rating_desc,
            "text_has_rating_asc": text_has_rating_asc,
            "text_has_review_count": text_has_review_count,
            "sort_button_candidates": sort_button_candidates,
        }

    async def _snapshot_recovery_page_state(
        self, *, checkpoint: str,
    ) -> None:
        """I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG.

        Diagnostic-only helper: emit a single compact key=value log
        line characterizing the recovered/reloaded page's current
        state at a named recovery checkpoint. The Ilso A000000225736
        live proof showed that the SAME recovery code produces TWO
        different DOM outcomes across runs (`probes=0` on one run
        because the review-pane never mounted; scoped click fired
        but no cursor request on a prior run). The next live proof
        needs URL + readyState + selector counts at every recovery
        checkpoint to characterize this variance.

        No-op when `_diagnose_post_recreate_page_state` is False
        (default). Every probe wrapped in try/except so a malformed
        Playwright page cannot abort recovery — diagnostics are
        best-effort. Per-probe Playwright `timeout=1000` so the
        helper's total wall-time stays bounded; no screenshots,
        no `innerHTML`, no full DOM dumps.

        Fields logged (in stable order):
          checkpoint=<name>
          url=<page.url or "unknown">
          readyState=<document.readyState or "unknown">
          title=<document.title or "unknown"> (truncated 60 chars)
          url_has_goodsno=<true|false|unknown>
          url_has_tab_review=<true|false|unknown>
          sort_pc_count=<int|unknown>
          sort_container_count=<int|unknown>
          sort_classmatch_count=<int|unknown>
          review_tab_count=<int|unknown>
          text_has_choisin=<true|false|unknown>
          text_has_yuyong=<true|false|unknown>
          text_has_rating_desc=<true|false|unknown>
          text_has_rating_asc=<true|false|unknown>
          text_has_review_count=<true|false|unknown>
          sort_button_candidates=<int|unknown>
        """
        if not getattr(
            self, "_diagnose_post_recreate_page_state", False,
        ):
            return
        state = await self._compute_recovery_page_state_dict()
        if state is None:
            return
        try:
            logger.info(
                "OY recovery page state: "
                "checkpoint=%s url=%s readyState=%s title=%s "
                "url_has_goodsno=%s url_has_tab_review=%s "
                "sort_pc_count=%s sort_container_count=%s "
                "sort_classmatch_count=%s review_tab_count=%s "
                "text_has_choisin=%s text_has_yuyong=%s "
                "text_has_rating_desc=%s text_has_rating_asc=%s "
                "text_has_review_count=%s sort_button_candidates=%s",
                checkpoint,
                state["url"],
                state["readyState"],
                state["title"],
                state["url_has_goodsno"],
                state["url_has_tab_review"],
                state["sort_pc_count"],
                state["sort_container_count"],
                state["sort_classmatch_count"],
                state["review_tab_count"],
                state["text_has_choisin"],
                state["text_has_yuyong"],
                state["text_has_rating_desc"],
                state["text_has_rating_asc"],
                state["text_has_review_count"],
                state["sort_button_candidates"],
            )
        except Exception:
            pass

    async def _run_post_navigation_review_cascade(self) -> bool:
        """Shared post-navigation cascade reused by BOTH the reload-first
        path and the close+new_page+goto recreate path.

        Runs steps 6–8 of the legacy recovery sequence on `self._page`:

          6. `_trigger_review_list_api(initial_click=True)` — review-tab
             click + scroll + 리뷰 더보기 cascade (idempotent on adopted
             / already-active pages).
          7. `_wait_for_review_sort_area_ready` (with optional single-
             shot re-trigger on first-wait timeout) — see
             I-OY-RECOVERY-WAIT-FOR-REVIEW-TAB-RENDER for rationale.
             Records the terminal True/False on
             `self._post_recreate_sort_area_ready`.
          8. `_click_sort_button_robust()` — re-fires the target sort
             so the response-handler filter (keyed on
             `_expected_sort_type`) admits the new cursor API response.
             Runs whether or not the readiness wait succeeded
             (preserves the existing `sort_control_unreachable`
             failure-mode contract).

        Returns the readiness signal (True iff the sort area was
        observed within the budget). The caller uses this to decide
        whether the reload-first path was successful — if False, the
        caller falls through to the recreate path (so the recreate
        path gets a second shot at mounting the review tab on a fresh
        page).

        IMPORTANT: this helper does NOT re-attach the response handler.
        The caller is responsible for ensuring the listener is already
        installed on `self._page` before invoking this method. On the
        reload-first path the listener persists across `page.reload()`
        (same page object); on the recreate path the caller re-attaches
        to the new page object before calling this helper. This
        preserves the install-before-trigger invariant.
        """
        # Step 6 — review-tab cascade.
        try:
            await self._trigger_review_list_api(initial_click=True)
        except Exception as e:
            logger.info(
                "OY review-tab re-click cascade after recovery "
                "skipped/failed: %s", e,
            )
        # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG — snapshot the
        # page state immediately AFTER the review-tab cascade so the
        # post-mortem can see whether the cascade brought the sort
        # area into the DOM (the Ilso `probes=0` symptom hinged on
        # the cascade NOT mounting the sort palette). Best-effort
        # no-op when the diagnostic flag is False.
        try:
            await self._snapshot_recovery_page_state(
                checkpoint="after_review_cascade",
            )
        except Exception:
            pass
        # Step 7 — readiness wait + optional single-shot re-trigger.
        # Reset to None first so a previous recreate's value doesn't
        # leak forward.
        self._post_recreate_sort_area_ready = None
        ready: bool = False
        if (
            self._sort_button_label_ko is not None
            or self._sort_button_selector is not None
        ):
            try:
                # I-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-PROBE — recovery
                # cascade callers pass `recovery_lazy_mount_nudge=True`
                # so the readiness wait can fire a single bounded
                # scroll nudge on the partial-mount path. Cold-start
                # callers (none today — `_wait_for_review_sort_area_ready`
                # is only invoked from this recovery cascade) MUST
                # omit / pass False so the cold-start behavior stays
                # byte-for-byte identical.
                ready = await self._wait_for_review_sort_area_ready(
                    timeout_s=self._sort_hunt_settle_s,
                    poll_interval_s=self._sort_hunt_poll_interval_s,
                    recovery_lazy_mount_nudge=True,
                )
            except Exception as e:
                logger.info(
                    "OY review sort area readiness wait raised "
                    "(benign): %s", e,
                )
                ready = False
            if not ready:
                logger.info(
                    "OY review sort area not ready after first wait — "
                    "single-shot re-trigger of review-tab cascade",
                )
                try:
                    await self._trigger_review_list_api(initial_click=True)
                except Exception as e:
                    logger.info(
                        "OY post-recovery review-tab re-trigger "
                        "skipped/failed (benign): %s", e,
                    )
                try:
                    # I-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-PROBE — the
                    # post-retrigger wait is still on the recovery
                    # path; the predicate is self-bounded (at most
                    # one nudge per readiness wait instance) so a
                    # second nudge here only fires if THIS wait still
                    # sees a partial-mount state after the re-trigger.
                    ready = await self._wait_for_review_sort_area_ready(
                        timeout_s=self._sort_hunt_settle_s,
                        poll_interval_s=self._sort_hunt_poll_interval_s,
                        recovery_lazy_mount_nudge=True,
                    )
                except Exception as e:
                    logger.info(
                        "OY review sort area readiness re-wait raised "
                        "(benign): %s", e,
                    )
                    ready = False
            self._post_recreate_sort_area_ready = bool(ready)
        # I-OY-RECOVERY-SCROLL-TO-REVIEW-SORT-AND-CLICK — between
        # readiness and the robust hunt, attempt to scroll the
        # readiness-matched element into view AND, when a button
        # handle is available (secondary signal `target_label_visible`
        # fired), do a scoped immediate click on that handle. This
        # closes the 12-second race observed on Ilso A000000225736
        # where `_wait_for_review_sort_area_ready` saw `최신순` at
        # poll_attempt=1 but `_click_sort_button_robust` deadlined 12s
        # later without finding it in its own enumeration. Reusing
        # the locator the wait already validated eliminates the
        # DOM-re-query race entirely.
        #
        # Best-effort with two-stage fallback:
        #   (1) Scoped immediate click — short timeout (2.5s). On
        #       success, return early (skip the robust hunt entirely).
        #   (2) Pre-scroll the matched container into view, then fall
        #       through to `_click_sort_button_robust`. This still
        #       benefits the case where readiness fired on the weaker
        #       `container_visible` signal only.
        #   (3) On any failure of (1)/(2), still call
        #       `_click_sort_button_robust` so the existing
        #       `sort_control_unreachable` failure-mode contract is
        #       preserved on the worst case.
        scoped_click_succeeded = False
        if (
            ready
            and (
                self._sort_button_label_ko is not None
                or self._sort_button_selector is not None
            )
        ):
            # `getattr` with default so test fixtures that build a
            # session via `object.__new__` and spy out
            # `_wait_for_review_sort_area_ready` (the real wait is the
            # only writer of these handles) don't trip on the
            # attribute-missing case. In production both attributes
            # are initialised in `__init__`.
            matched_button = getattr(
                self, "_last_readiness_matched_button", None,
            )
            matched_container = getattr(
                self, "_last_readiness_matched_container", None,
            )
            # Pre-scroll the matched container (if any) into view.
            # The matched container exists whenever readiness returned
            # True, so this is a deterministic prep step before either
            # the scoped click OR the robust hunt fallback.
            if matched_container is not None:
                try:
                    await matched_container.scroll_into_view_if_needed(
                        timeout=2000,
                    )
                    logger.info(
                        "OY scrolled to review sort area before "
                        "recovery click",
                    )
                except Exception as e:
                    logger.info(
                        "OY review sort area scroll failed; falling "
                        "back to robust click: %s", e,
                    )
            # Scoped immediate click on the readiness-matched button
            # when available. The button locator is the EXACT element
            # the readiness probe just validated; no DOM re-query.
            if matched_button is not None:
                # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG —
                # snapshot BEFORE the scoped click so the post-mortem
                # can see the page state the click is firing against
                # (URL, readyState, sort-area counts, target label
                # visibility). The snapshot is wrapped in try/except
                # so it cannot abort the click sequence.
                # I-OY-RECOVERY-SCOPED-CLICK-STALENESS-RETRY — snapshot
                # fires ONCE BEFORE the first attempt of the retry
                # loop, never per-attempt. The bracketing
                # `after_scoped_click` snapshot below fires ONCE AFTER
                # the LAST attempt (success or failure), preserving the
                # `025b021` two-line invariant.
                try:
                    await self._snapshot_recovery_page_state(
                        checkpoint="before_scoped_click",
                    )
                except Exception:
                    pass
                # I-OY-RECOVERY-SCOPED-CLICK-STALENESS-RETRY — bounded
                # retry loop around the scoped click to close the
                # transient mount + sub-second re-unmount race observed
                # in the latest live proof on Ilso A000000225736
                # (HEAD `025b021`): the readiness wait correctly
                # detected `최신순` at 17:34:48.421 against the DOM
                # snapshot at 17:34:48.410 (sort_pc_count=1,
                # text_has_choisin=true, sort_button_candidates=6) but
                # by `before_scoped_click` at 17:34:48.700 (~290ms
                # later) the DOM had re-unmounted (sort_pc_count=0,
                # text_has_choisin=false, sort_button_candidates=0).
                # The matched-button locator from the first readiness
                # pass was stale before the click could land.
                #
                # Strategy: on the first attempt, behave exactly as
                # the original `24d764b` scoped-click block (read the
                # side-channel handles set by the readiness wait that
                # already ran in step 7, pre-scroll the button, click).
                # On stale-element or any click/scroll failure,
                # re-invoke `_wait_for_review_sort_area_ready` with a
                # very tight budget (0.4s) to refresh the side-channel
                # handles, then retry the scoped click on the new
                # locator. Bounds: 3 attempts total (1 initial + 2
                # retries).
                #
                # I-OY-RECOVERY-SCOPED-CLICK-RETRY-BUDGET-FIX —
                # corrected the budget arithmetic. The prior pass
                # used a 1.0s wall-clock budget with a 2.5s per-click
                # timeout: when attempt 1's click timed out against a
                # stale locator, ≥2.5s had elapsed at the while-check
                # so attempts 2/3 never entered (no retry log lines
                # fired in the Ilso A000000225736 live proof at
                # `c1455f9`). Live-DOM mount window is sub-second
                # (290ms snapshot-to-snapshot per `025b021`), so a
                # ~600ms per-attempt click cap is sufficient — if the
                # matched handle hasn't clicked within ~600ms it is
                # almost certainly stale and re-detection is more
                # useful than waiting 2.5s. Wall-clock budget raised
                # to 2.5s so 3 × 600ms = 1.8s worst-case click + a
                # small per-retry readiness re-wait (0.4s × 2 retries)
                # comfortably fits. The same 600ms cap applies to the
                # per-attempt `scroll_into_view_if_needed` so a slow
                # scroll cannot accidentally consume the budget. On
                # exhaustion, fall through to the existing
                # `_click_sort_button_robust` fallback — preserves
                # the `_sort_control_unreachable` / status-classifier
                # contract bit-for-bit.
                import time as _time
                _scoped_attempts_max = 3
                _scoped_retry_readiness_timeout_s = 0.4
                _scoped_retry_readiness_poll_s = 0.05
                _scoped_click_per_attempt_timeout_ms = 600
                _scoped_scroll_per_attempt_timeout_ms = 600
                _scoped_branch_deadline = (
                    _time.monotonic() + 2.5
                )
                _scoped_branch_start = _time.monotonic()
                _scoped_attempt = 0
                _scoped_last_error: Exception | None = None
                while (
                    _scoped_attempt < _scoped_attempts_max
                    and _time.monotonic() < _scoped_branch_deadline
                ):
                    _scoped_attempt += 1
                    if _scoped_attempt > 1:
                        # Re-detection step: the previous click failed.
                        # Re-run readiness with a tight budget to
                        # refresh the side-channel handles, then read
                        # the refreshed matched-button locator. If
                        # re-detection cannot find a button within
                        # budget, treat as `locator_missing`.
                        _elapsed_ms = int(
                            (_time.monotonic() - _scoped_branch_start)
                            * 1000.0,
                        )
                        _reason = (
                            "click_raised"
                            if _scoped_last_error is not None
                            else "locator_missing"
                        )
                        logger.info(
                            "OY scoped sort-button click stale; "
                            "retrying readiness match: attempt=%d "
                            "elapsed=%dms reason=%s",
                            _scoped_attempt - 1, _elapsed_ms, _reason,
                        )
                        try:
                            _ready_retry = (
                                await self._wait_for_review_sort_area_ready(
                                    timeout_s=(
                                        _scoped_retry_readiness_timeout_s
                                    ),
                                    poll_interval_s=(
                                        _scoped_retry_readiness_poll_s
                                    ),
                                )
                            )
                        except Exception:
                            _ready_retry = False
                        if not _ready_retry:
                            # Readiness re-detection failed; no fresh
                            # locator. Skip this attempt and let the
                            # while-condition end the loop (or wall-
                            # clock deadline expire).
                            _scoped_last_error = RuntimeError(
                                "readiness re-detection failed within "
                                "retry budget",
                            )
                            continue
                        matched_button = getattr(
                            self, "_last_readiness_matched_button", None,
                        )
                        if matched_button is None:
                            _scoped_last_error = RuntimeError(
                                "no matched-button locator after "
                                "readiness re-detection",
                            )
                            continue
                    try:
                        _scroll_stale_skip = False
                        try:
                            await matched_button.scroll_into_view_if_needed(
                                timeout=(
                                    _scoped_scroll_per_attempt_timeout_ms
                                ),
                            )
                        except Exception as _scroll_exc:
                            # I-OY-RECOVERY-SCOPED-CLICK-RETRY-BUDGET-FIX
                            # Bug 2 fix: when the scroll wrapper raises
                            # a stale-element exception ("Element is
                            # not attached to the DOM" in Playwright's
                            # phrasing), the matched-button locator is
                            # already detached. Proceeding into
                            # `click()` against a detached handle
                            # burns the per-attempt budget waiting
                            # for a timeout that cannot succeed. The
                            # early stale signal is the cue to break
                            # immediately to the next retry iteration
                            # so the readiness re-wait can refresh
                            # `_last_readiness_matched_button` against
                            # the current DOM. Non-stale scroll
                            # failures still fall through to the
                            # click attempt (preserves the pre-fix
                            # behaviour where a slow / mis-positioned
                            # element can still be clicked).
                            if _is_stale_locator_error(_scroll_exc):
                                _scoped_last_error = _scroll_exc
                                logger.info(
                                    "OY scoped sort-button scroll "
                                    "stale; retrying without click: "
                                    "attempt=%d error=%r",
                                    _scoped_attempt,
                                    _scroll_exc,
                                )
                                _scroll_stale_skip = True
                            else:
                                pass
                        if _scroll_stale_skip:
                            continue
                        await matched_button.click(
                            timeout=(
                                _scoped_click_per_attempt_timeout_ms
                            ),
                        )
                        scoped_click_succeeded = True
                        # Record the same diagnostic line shape that
                        # `_click_sort_button_robust` emits on success
                        # so downstream log scans see a single uniform
                        # format. The success log fires once per
                        # cascade (only on the attempt that landed).
                        logger.info(
                            "OY sort-button clicked: target=%r "
                            "expected_sort=%r scope=%s poll_attempt=%d",
                            self._sort_button_label_ko,
                            self._expected_sort_type,
                            "readiness_matched_button",
                            1,
                        )
                        if _scoped_attempt > 1:
                            _elapsed_ms = int(
                                (
                                    _time.monotonic()
                                    - _scoped_branch_start
                                )
                                * 1000.0,
                            )
                            logger.info(
                                "OY scoped sort-button click retry "
                                "succeeded: attempt=%d elapsed=%dms",
                                _scoped_attempt, _elapsed_ms,
                            )
                        break
                    except Exception as e:
                        _scoped_last_error = e
                        # Loop continues to the next attempt (which
                        # will run readiness re-detection); if budget
                        # is exhausted the while-loop terminates and
                        # the post-loop fall-through emits the final
                        # log line and invokes the robust hunt.
                if not scoped_click_succeeded:
                    _elapsed_ms = int(
                        (_time.monotonic() - _scoped_branch_start)
                        * 1000.0,
                    )
                    if _scoped_attempt >= _scoped_attempts_max:
                        logger.info(
                            "OY scoped sort-button click retries "
                            "exhausted; falling back to robust hunt: "
                            "attempts=%d elapsed=%dms",
                            _scoped_attempt, _elapsed_ms,
                        )
                    # Preserve the original `24d764b` fall-through log
                    # line shape so existing log scans / dashboards
                    # still match. Emitted ONLY after the loop has
                    # given up; not per-attempt.
                    logger.info(
                        "OY scoped sort-button click via readiness "
                        "match failed; falling back to robust hunt: %s",
                        _scoped_last_error,
                    )
                # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG —
                # snapshot AFTER the scoped click attempt (whether
                # it succeeded or raised). The two snapshots bracket
                # the click so the post-mortem can compare DOM /
                # readyState before vs after — useful to spot the
                # case where the click landed on the DOM but the
                # page took a slow tick to update.
                # Fires ONCE after the LAST attempt of the retry loop
                # (success or exhaustion) — never per-attempt.
                try:
                    await self._snapshot_recovery_page_state(
                        checkpoint="after_scoped_click",
                    )
                except Exception:
                    pass

        # Step 8 — sort-button click. Runs whether or not the readiness
        # wait succeeded (preserves current failure-mode contract).
        # Skipped only when the scoped immediate click above already
        # clicked the target label, eliminating the duplicate-click
        # risk on the reloaded/recreated page.
        if (
            not scoped_click_succeeded
            and (
                self._sort_button_label_ko is not None
                or self._sort_button_selector is not None
            )
        ):
            try:
                await self._click_sort_button_robust()
            except Exception as e:
                logger.info(
                    "OY sort-button re-click after recovery "
                    "skipped/failed (benign): %s", e,
                )
        return bool(ready)

    async def reload_and_reopen_review_tab(self) -> None:
        """Recovery step on false-empty / scroll-continuation wedge:
        try `page.reload()` first (Option A), then fall back to
        **page-recreate** (close+new_page+goto) + re-click review tab.

        I-OY-RECOVERY-RECREATE-STRATEGY-REVISION layered Option A on
        top of the historical close+new_page+goto strategy. The Ilso
        A000000225736 live proof (`O-OY-SCROLL-RECOVERY-WAIT-LIVE-PROOF-ILSO`)
        demonstrated that the close+new_page+goto recreate lands on a
        page that never mounts the review-tab DOM:

          WARNING OY review sort area NOT ready after 12 poll attempts
            in 12.0s deadline. target='최신순'.
          WARNING OY sort-button '최신순' NOT FOUND after 9 poll
            attempts in 12.0s deadline. ... Buttons enumerated in sort
            area: [merchandising / navigation / footer labels only].

        The wedged page itself had successfully served 49 cursors —
        proof the review-tab DOM was mounted and functional on it.
        Reloading that page (preserving page identity, cookies, JS
        context, and the Playwright response listener registration)
        is a less disruptive recovery: it resets the document while
        keeping the rest of the page-level state intact. Only when
        reload itself raises OR post-reload readiness wait deadlines
        do we fall through to the historical close+new_page+goto
        recreate.

        Order of operations:

          0. **Reload-first (Option A)** — when eligible
             (`_reload_strategy_eligible() is True`):
               0a. Drain response queue + reset session-level counters
                   in place (the listener captures these by reference;
                   in-place clear correctly resets the new view).
               0b. `await self._page.reload(timeout=20000)` — same page
                   object, document refreshed. The Playwright response
                   listener registered in `open()` PERSISTS across
                   reload (registration is on the page object, not the
                   document), so we do NOT re-attach. This preserves
                   the install-before-trigger invariant trivially: the
                   listener has been installed since `open()`, before
                   ANY trigger on the page.
               0c. Run the shared post-navigation cascade
                   (`_run_post_navigation_review_cascade`).
               0d. On readiness True → record
                   `_post_recreate_strategy_used = "reload_succeeded"`
                   and return early. On reload raise OR readiness False
                   → record `_post_recreate_strategy_used =
                   "reload_failed_recreate_fallback"` and fall through.

          1–8. **Recreate fallback** — historical close+new_page+goto
             path:
               1. Close the poisoned page (best-effort).
               2. Drain queue + reset counters (no-op if reload-first
                  already cleared; idempotent).
               3. `ctx.new_page()` — fresh page in same context (CDP
                  auth preserved).
               4. Re-attach response listener to new page (listener-
                  before-trigger invariant on the recreate path).
               5. `page.goto(self._opened_product_url, ...)` — re-
                  navigate to the original product.
               6–8. Shared post-navigation cascade.

        Best-effort — failures at every step are logged and swallowed
        so the retry budget in the connector can still decide based on
        the next probe.

        For Fakes / tests that monkey-patch this method, the public
        signature and return semantics are unchanged: a coroutine
        returning None. The strategy outcome surfaces to the connector
        via `get_post_recreate_strategy_used()`.
        """
        ctx = self._ctx
        # Reset the strategy flag at entry so a previous attempt's
        # value never leaks forward into a subsequent recreate that
        # early-returns before any strategy could begin.
        self._post_recreate_strategy_used = None
        if ctx is None:
            return

        # Step 0 — Reload-first (Option A). Eligibility is conservative;
        # the recreate fallback is always available below.
        if self._reload_strategy_eligible():
            # 0a. Drain queue + reset session-level accumulators in
            # place. The existing _on_response closure shares these
            # by reference (captured in `_attach_response_handler`),
            # so in-place clear correctly resets the new view.
            try:
                self._request_log.clear()
                self._observed_sort_types_count.clear()
                self._responses_filtered_out_by_sort = 0
                while not self._queue.empty():
                    try:
                        self._queue.get_nowait()
                    except Exception:
                        break
            except Exception:
                pass
            # 0b. Reload the existing page object. The Playwright
            # response listener persists across reload (same page
            # identity), so we do NOT re-attach. This trivially
            # preserves listener-before-trigger because the listener
            # has been installed since `open()` — well before any
            # trigger on this page.
            reload_raised = False
            try:
                await self._page.reload(
                    wait_until="domcontentloaded",
                    timeout=20000,
                )
            except Exception as e:
                logger.warning(
                    "OY reload-first strategy: page.reload raised "
                    "(%s); falling back to recreate", e,
                )
                reload_raised = True

            if not reload_raised:
                # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG —
                # snapshot AFTER reload returns and BEFORE the shared
                # cascade so the post-mortem can see what the reload
                # actually produced (does the document still carry the
                # review-tab DOM, is `tab=review` still in the URL,
                # are sort containers present, etc.). Best-effort.
                try:
                    await self._snapshot_recovery_page_state(
                        checkpoint="after_reload",
                    )
                except Exception:
                    pass
                # I-OY-RECOVERY-SKIP-CASCADE-WHEN-SORT-HEALTHY — re-read
                # the same page-state dict the snapshot just emitted and
                # gate the cascade on the healthy-sort-area predicate.
                # The prior O-OY-RECOVERY-SORT-HEADER-LAZY-MOUNT-LIVE-PROOF-ILSO
                # proof (Ilso A000000225736 / DATETIME_DESC at HEAD
                # `9eed039`) showed the cascade itself UNMOUNTS a healthy
                # post-reload sort area: `after_reload` snapshot at
                # 22:29:08 reported sort_pc_count=1,
                # sort_button_candidates=6, text_has_choisin=true; the
                # very next `after_review_cascade` snapshot at 22:29:09
                # reported sort_pc_count=0, sort_button_candidates=0,
                # text_has_choisin=false. The lazy-mount nudge then
                # fired 4× with success=false trying to re-mount what
                # the cascade had just destroyed. Skipping the cascade
                # when the post-reload snapshot is already healthy
                # avoids that self-inflicted unmount. Reusing
                # `_compute_recovery_page_state_dict()` (the same helper
                # `_snapshot_recovery_page_state` consumes) keeps the
                # runtime predicate and the post-mortem log line bit-
                # for-bit aligned. Wrapped in try/except so a malformed
                # Playwright page cannot abort recovery via a diagnostic
                # probe — `_post_reload_state = None` falls through to
                # the existing cascade path.
                _post_reload_state: dict | None = None
                try:
                    _post_reload_state = (
                        await self._compute_recovery_page_state_dict()
                    )
                except Exception:
                    _post_reload_state = None
                if (
                    _post_reload_state is not None
                    and _is_healthy_sort_area_state(_post_reload_state)
                ):
                    # Healthy post-reload — skip the cascade entirely.
                    # The cascade's `_trigger_review_list_api(initial_click=True)`
                    # is what unmounts a healthy sort area on this DOM
                    # shape; the readiness wait + scoped click that
                    # follow it inside the cascade are also skipped.
                    # The next live proof (recommended ticket
                    # O-OY-RECOVERY-CASCADE-SKIP-LIVE-PROOF-ILSO) will
                    # show whether the cursor API still fires off the
                    # already-mounted sort selection, or whether a
                    # follow-up needs to re-introduce a scoped click
                    # on the healthy button.
                    try:
                        _sort_pc = int(
                            _post_reload_state.get("sort_pc_count", "0")
                            or 0,
                        )
                    except (TypeError, ValueError):
                        _sort_pc = 0
                    try:
                        _sort_buttons = int(
                            _post_reload_state.get(
                                "sort_button_candidates", "0",
                            )
                            or 0,
                        )
                    except (TypeError, ValueError):
                        _sort_buttons = 0
                    logger.info(
                        "OY recovery cascade skipped: post-navigation "
                        "sort area already healthy: sort_pc_count=%d "
                        "sort_button_candidates=%d text_has_choisin=%s",
                        _sort_pc,
                        _sort_buttons,
                        _post_reload_state.get(
                            "text_has_choisin", "unknown",
                        ),
                    )
                    # Still emit the `after_review_cascade` snapshot so
                    # post-mortem log scans see the same checkpoint
                    # sequence the cascade would have produced
                    # (`after_reload` → `after_review_cascade` →
                    # downstream). The page-state at this moment is
                    # "still healthy from reload" rather than "freshly
                    # cascaded"; the side-by-side comparison with the
                    # `after_reload` snapshot is itself a signal that
                    # the skip path was taken.
                    try:
                        await self._snapshot_recovery_page_state(
                            checkpoint="after_review_cascade",
                        )
                    except Exception:
                        pass
                    # Mark the strategy as success and return early;
                    # downstream cold-start consumes any cursor response
                    # already in flight from the pre-recovery sort
                    # selection (the same listener registered in
                    # `open()` persists across reload).
                    self._post_recreate_strategy_used = "reload_succeeded"
                    return
                # 0c. Shared post-navigation cascade on the reloaded
                # page. Returns True iff the readiness wait observed
                # the sort area within budget.
                reload_ready = await self._run_post_navigation_review_cascade()
                if reload_ready:
                    # 0d. Reload-first succeeded — record the strategy
                    # and skip the recreate fallback entirely.
                    self._post_recreate_strategy_used = "reload_succeeded"
                    return
                logger.info(
                    "OY reload-first strategy: post-reload review sort "
                    "area not ready; falling back to recreate",
                )
            # Reload-first failed (raised or readiness False). Mark the
            # strategy and fall through to the historical recreate path.
            self._post_recreate_strategy_used = "reload_failed_recreate_fallback"
        else:
            # Reload-first was not eligible — go straight to recreate.
            self._post_recreate_strategy_used = "recreate_only"

        # ---- Recreate fallback (steps 1–8) ----
        old_page = self._page
        # 1. Close the poisoned page (best-effort).
        if old_page is not None:
            try:
                await old_page.close()
            except Exception as e:
                logger.info("OY false-empty: old page close failed: %s", e)
        # 2. Drain queue + reset session-level accumulators. Idempotent
        # if the reload-first path already cleared them.
        try:
            self._request_log.clear()
            self._observed_sort_types_count.clear()
            self._responses_filtered_out_by_sort = 0
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except Exception:
                    break
        except Exception:
            pass
        # 3. Open a fresh page in the same context — gets us a clean
        # client-side fingerprint without losing auth.
        try:
            self._page = await ctx.new_page()
        except Exception as e:
            logger.warning(
                "OY false-empty: new_page() in same context failed: %s", e,
            )
            self._page = None
            return
        # 4. Re-attach the response interceptor to the new page.
        try:
            self._attach_response_handler(self._page)
        except Exception as e:
            logger.warning(
                "OY false-empty: re-attach response handler failed: %s", e,
            )
            return
        # 5. Re-navigate to the original product URL.
        if self._opened_product_url is None:
            logger.info(
                "OY false-empty: no remembered product_url; cannot navigate "
                "after page recreate",
            )
            return
        try:
            await self._page.goto(
                self._opened_product_url,
                wait_until="domcontentloaded",
                timeout=20000,
            )
        except Exception as e:
            logger.warning(
                "OY false-empty: re-navigation after page recreate failed: %s", e,
            )
            return
        # I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG — snapshot
        # AFTER the recreate path's goto returns and BEFORE the
        # shared cascade. This is the surface the prior live proof
        # diagnosed as "review-pane DOM never mounted post-recreate";
        # the snapshot fields will distinguish "landed on wrong URL"
        # from "URL ok but DOM subtree absent". Best-effort.
        try:
            await self._snapshot_recovery_page_state(
                checkpoint="after_goto",
            )
        except Exception:
            pass
        # 6–8. Shared post-navigation cascade on the recreated page.
        # The readiness signal is recorded on
        # `self._post_recreate_sort_area_ready` inside the helper;
        # downstream `_click_sort_button_robust` failure still produces
        # the existing `sort_control_unreachable` classifier path.
        await self._run_post_navigation_review_cascade()

    async def wait_for_next_response(
        self, *, timeout_s: float,
    ) -> tuple[int, dict | None] | None:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout_s)
        except TimeoutError:
            return None

    async def has_pending_response(self) -> bool:
        """Non-consuming peek: True iff a `/cursor` response matching
        `_expected_sort_type` has already arrived and is waiting in
        the response queue.

        Used as a positive-signal probe before declaring false-empty:
        if the cursor API has already answered for this sort, the
        load succeeded and any visible "등록된 리뷰가 없어요" marker
        is a transient mid-render artifact (OY occasionally shows
        the empty placeholder for ~1–3 seconds while the review
        list mounts). Returns False if the queue is empty or the
        size probe fails.
        """
        try:
            return self._queue.qsize() > 0
        except Exception:
            return False

    async def scroll_for_next(self) -> None:
        if self._page is None:
            return
        for selector in self._scroll_candidates:
            try:
                locator = self._page.locator(selector).first
                if await locator.count() == 0:
                    continue
                if selector == "body":
                    await self._page.evaluate(
                        "() => window.scrollTo(0, document.body.scrollHeight)",
                    )
                    return
                await locator.evaluate(
                    "(el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })",
                )
                box = await locator.bounding_box()
                if box:
                    await self._page.mouse.move(
                        box["x"] + box["width"] / 2,
                        box["y"] + box["height"] / 2,
                    )
                    await self._page.mouse.wheel(0, 2000)
                return
            except Exception as e:
                logger.debug("OY scroll attempt on %r failed (trying next): %s", selector, e)
                continue
        try:
            await self._page.evaluate("window.scrollBy(0, window.innerHeight * 1.5)")
        except Exception:
            pass

    def get_seen_sort_labels(self) -> list[str]:
        """Phase 2E: deduped, normalized list of button labels enumerated
        during the most recent sort-button hunt. Empty when sort-aware
        mode is not engaged or the hunt did not execute.
        """
        return list(self._last_seen_sort_labels)

    def get_sort_control_unreachable(self) -> bool:
        """True iff the most recent `_click_sort_button_robust` exhausted
        its deadline without ever locating the target rating label
        (after scroll-into-view + disclosure-affordance probe).

        Distinct from `false_empty_state_detected` — this signals OY's
        DOM did not render the requested sort tab, NOT an anti-bot
        soft-block. Drained by the connector at end of run into the
        `sort_control_unreachable` flag on `ConnectorRunSummary`, which
        the downstream classifier maps to the new terminal status.
        """
        return bool(self._sort_control_unreachable)

    def get_post_recreate_sort_area_ready(self) -> bool | None:
        """I-OY-RECOVERY-WAIT-FOR-REVIEW-TAB-RENDER.

        Tri-state. None when the session has never recreated the page
        (or the most-recent recreate didn't reach the readiness wait —
        e.g. early-return on context loss). True when the wait observed
        the sort-area / target sort label inside the readiness budget.
        False when the wait deadlined — the recreated page never
        rendered the review-tab sort palette (the Ilso A000000225736
        case: post-recreate DOM enumeration came back with only generic
        site-nav buttons; `최신순` was absent).

        Connector reads this immediately after `recreate_fn()` returns
        and emits a single narrow `_note` for `sample_dropped_reasons`.
        Distinct from `get_sort_control_unreachable()` — that one
        signals the SORT-BUTTON-HUNT deadlined (DOM had a sort row but
        the target label was absent); this one signals the SORT-AREA
        itself never rendered (DOM didn't even reach the sort-row
        state). They can both fire on the same recreate.
        """
        return self._post_recreate_sort_area_ready

    def get_post_recreate_strategy_used(self) -> str | None:
        """I-OY-RECOVERY-RECREATE-STRATEGY-REVISION.

        Which recovery strategy `reload_and_reopen_review_tab` ended up
        using on the most recent invocation. The Ilso A000000225736
        live proof showed the historical close+new_page+goto recreate
        producing a page where the review-tab DOM never re-mounted; the
        revision layered a reload-first path on top so the existing
        page (which had successfully served 49 cursors before the
        wedge) gets a less disruptive refresh attempt before we
        sacrifice all of its in-memory state.

        Values:
          None — `reload_and_reopen_review_tab` has never been invoked
            on this session, OR an early-return fired before any
            strategy could be decided (e.g. `ctx is None`).
          "reload_succeeded" — reload-first path ran and the post-
            reload readiness wait observed the sort area within budget.
            Sort-button click ran on the reloaded page. The recreate
            fallback was NOT taken.
          "reload_failed_recreate_fallback" — reload-first path was
            eligible and attempted, but either `page.reload` raised OR
            post-reload readiness wait deadlined. Control fell through
            to the historical close+new_page+goto recreate path.
          "recreate_only" — reload-first path was not eligible (e.g.
            `self._page` was None, `_opened_product_url` was missing,
            or the current page URL didn't contain the target goodsNo).
            Went straight to the recreate path.

        Connector reads this immediately after `recreate_fn()` returns
        and emits one or two narrow `_note` entries describing the
        strategy. On the "reload_succeeded" path only the entry note is
        emitted; on the fallback path both entry and fallback notes
        are emitted; on "recreate_only" / None no strategy note is
        emitted (the existing recreate-attempt note already covers it).
        """
        return self._post_recreate_strategy_used

    def get_observed_sort_types(self) -> dict[str, int]:
        """Phase 2E: tally of `sortType` values seen in request post_data
        across all observed `/reviews/cursor` calls. Includes responses
        that were filtered out before reaching the consumer queue.
        """
        return dict(self._observed_sort_types_count)

    def get_responses_filtered_out_by_sort(self) -> int:
        """Phase 2E: count of responses dropped by the sortType filter
        before reaching the consumer queue. Always 0 when the connector
        was constructed without an `expected_sort_type`.
        """
        return int(self._responses_filtered_out_by_sort)

    def get_request_log(self) -> list[dict]:
        """PR-4: return a copy of the captured request/response log so far.

        Each entry is one observed `/reviews/cursor` call. Entries are
        appended in the same order responses arrive on the queue, so the
        list index aligns with the connector's cold-start + continuation
        sequence within a single attempt.
        """
        return list(self._request_log)

    async def observe_login_state(self) -> str | None:
        """PR-4: best-effort login probe. Looks for OY-specific DOM markers.

        Conservative: returns "unknown" on any error. The login state is
        informational telemetry — the quality gate ignores it. The set of
        DOM selectors here is best-effort and may need maintenance as OY's
        markup changes; that's why every miss returns "unknown" rather
        than "logged_out".
        """
        if self._page is None:
            return "unknown"
        # Logged-in markers observed historically on OY:
        #   - "마이페이지" link in the GNB
        #   - the .ic-mypage icon
        #   - a member greeting span
        # Logged-out markers:
        #   - "로그인" link visible in GNB
        try:
            for selector in (
                'a:has-text("마이페이지")',
                '.gnb_user_name',
                'a[href*="/store/mypage/"]',
            ):
                try:
                    if await self._page.locator(selector).first.count() > 0:
                        return "logged_in"
                except Exception:
                    continue
            for selector in (
                'a:has-text("로그인")',
                'a[href*="/login"]',
            ):
                try:
                    if await self._page.locator(selector).first.count() > 0:
                        return "logged_out"
                except Exception:
                    continue
        except Exception as e:
            logger.debug("OY login-state probe failed: %s", e)
            return "unknown"
        return "unknown"

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        # Close our page unconditionally (we always created it ourselves).
        if self._page is not None:
            try:
                await self._page.close()
            except Exception as e:
                logger.debug("OY browser page close failed: %s", e)
        # Context and browser: close only if we own them. Under CDP-attach the
        # user's Chrome instance owns both; closing the context would discard
        # the user's session, closing the browser would quit their Chrome.
        if self._ctx is not None and self._owns_context:
            try:
                await self._ctx.close()
            except Exception as e:
                logger.debug("OY browser context close failed: %s", e)
        if self._browser is not None and self._owns_browser:
            try:
                await self._browser.close()
            except Exception as e:
                logger.debug("OY browser close failed: %s", e)
        if self._pw is not None:
            try:
                await self._pw.stop()
            except Exception as e:
                logger.debug("OY playwright stop failed: %s", e)
