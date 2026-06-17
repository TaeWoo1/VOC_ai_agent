"""Pure cache helpers for repeated-issue stabilization (S1b).

Repeated-issue discovery is an LLM pipeline and is not deterministic across
runs. To make "same file + same scope + same settings" reuse the same result,
we cache the discovery output keyed by everything that legitimately changes it.
This module holds the *pure* pieces of that mechanism:

- :func:`corpus_hash` / :func:`scope_key` / :func:`compute_issue_cache_key` —
  build a deterministic cache key.
- :func:`serialize_issues` / :func:`deserialize_issues` — convert between
  :class:`IssueCluster` objects and a JSON-compatible payload. Serialization
  sanitizes operator-facing text via S1a so the cached payload is clean at rest.
- :func:`canonical_label` — a light, deterministic issue-identity normalizer
  (NOT a taxonomy).

No SQLite, no Streamlit, no Notion, no network. The store table (S1c) and the
app wiring (S1d) consume these helpers; they are intentionally absent here.

The canonical serialize input is a list of :class:`IssueCluster` (the objects on
``report.issue_clusters``). Plain dicts mirroring those fields are also accepted.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import date

from src.voc.review_ops.industrial.issue_sanitize import sanitize_issue_fields
from src.voc.review_ops.industrial.schema import IssueCluster, WorklistRow

# Bump when the discovery / verifier prompt text changes so prior cached results
# (produced under the old prompt) are no longer reused. Plain opaque strings.
DISCOVERY_PROMPT_VERSION = "v1"
VERIFIER_PROMPT_VERSION = "v1"

# Generic suffix / connector tokens dropped when deriving a canonical identity
# label. Intentionally small — this is identity normalization, not a taxonomy.
_CANONICAL_STOPWORDS = frozenset(
    {"부족", "문제", "이슈", "관련", "발생", "현상", "불만", "시", "및", "등"}
)
_CANONICAL_SEPARATORS = ("·", "/", ",", "．", ".")


# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------


def corpus_hash(review_ids: Iterable[str]) -> str:
    """Order-independent, dedup'd sha256 over the in-scope review ids.

    Same id set (any order, with repeats) → same hash; adding or removing an id
    → different hash. This is the corpus-identity component of the cache key.
    """
    ids = sorted({str(x) for x in review_ids})
    return hashlib.sha256("\n".join(ids).encode("utf-8")).hexdigest()


def scope_key(scope_products: Iterable[str] | None) -> str:
    """Stable key for the product scope. ``None``/empty → ``"__ALL__"``.

    Order-independent; different product sets → different keys.
    """
    if not scope_products:
        return "__ALL__"
    items = sorted({str(x) for x in scope_products if x is not None and str(x) != ""})
    if not items:
        return "__ALL__"
    return "|".join(items)


def _to_iso(value: object) -> str:
    if value is None:
        return ""
    iso = getattr(value, "isoformat", None)
    if callable(iso):
        return iso()
    return str(value)


def compute_issue_cache_key(
    *,
    corpus_hash: str,
    scope_key: str,
    recent_days: int,
    resolved_today: object,
    discovery_model: str,
    verifier_model: str,
    discovery_prompt_version: str = DISCOVERY_PROMPT_VERSION,
    verifier_prompt_version: str = VERIFIER_PROMPT_VERSION,
    max_issues: int,
    max_evidence: int,
) -> str:
    """Deterministic cache key over every input that changes the issue result.

    Changing any single component (corpus hash, scope, recent_days,
    resolved_today, either model, either prompt version, max_issues,
    max_evidence) yields a different key.
    """
    parts = [
        ("corpus", corpus_hash),
        ("scope", scope_key),
        ("recent_days", str(recent_days)),
        ("today", _to_iso(resolved_today)),
        ("disc_model", str(discovery_model)),
        ("ver_model", str(verifier_model)),
        ("disc_ver", str(discovery_prompt_version)),
        ("ver_ver", str(verifier_prompt_version)),
        ("max_issues", str(max_issues)),
        ("max_evidence", str(max_evidence)),
    ]
    payload = "\n".join(f"{k}={v}" for k, v in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Canonical identity label
# ---------------------------------------------------------------------------


def canonical_label(issue_title: str) -> str:
    """Light, deterministic identity normalizer for an issue title.

    Drops generic suffix/connector tokens so phrasing drift collapses to a
    stable key (e.g. 접착력 부족 / 접착력 문제 / 접착력 이슈 → "접착력";
    절단 시 깨짐 / 절단 깨짐 문제 → "절단 깨짐"). NOT a taxonomy — purely for
    run-to-run / cross-upload issue identity. Falls back to the stripped title
    when every token would be dropped.
    """
    if not isinstance(issue_title, str):
        return ""
    text = issue_title.strip()
    for sep in _CANONICAL_SEPARATORS:
        text = text.replace(sep, " ")
    tokens = [t for t in text.split() if t]
    kept = [t for t in tokens if t not in _CANONICAL_STOPWORDS]
    if not kept:
        return " ".join(tokens)
    return " ".join(kept)


# ---------------------------------------------------------------------------
# Serialize / deserialize
# ---------------------------------------------------------------------------


def _field(obj: object, name: str, default: object = None) -> object:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _rep_snapshot(rep: object) -> dict:
    """JSON-compatible snapshot of one representative review."""
    rdate = _field(rep, "review_date")
    if isinstance(rdate, date):
        rdate = rdate.isoformat()
    return {
        "review_id": _field(rep, "review_id"),
        "review_date": rdate,  # str | None
        "channel": _field(rep, "channel"),
        "product_name": _field(rep, "product_name"),
        "option_name": _field(rep, "option_name"),
        "rating": _field(rep, "rating"),
        "text": _field(rep, "text"),
    }


def serialize_issues(clusters_or_issue_items: Iterable[object]) -> list[dict]:
    """Convert issues to a JSON-compatible, sanitized payload.

    Accepts :class:`IssueCluster` objects (canonical) or dicts mirroring their
    fields. Operator-facing text (``issue_title`` / ``summary`` /
    ``recommended_action``) is sanitized via S1a, so the payload contains no
    banned wording. Input objects are never mutated.
    """
    out: list[dict] = []
    for item in clusters_or_issue_items:
        review_ids = _field(item, "review_ids")
        if review_ids is None:
            review_ids = _field(item, "evidence_review_ids", [])
        review_ids = [str(x) for x in (review_ids or [])]

        clean = sanitize_issue_fields(
            {
                "issue_title": _field(item, "issue_title", "") or "",
                "summary": _field(item, "summary", "") or "",
                "recommended_action": _field(item, "recommended_action", "") or "",
            }
        )

        count = _field(item, "review_count", None)
        if count is None:
            count = len(review_ids)

        reps_src = _field(item, "representatives", []) or []
        out.append(
            {
                "cluster_id": _field(item, "cluster_id", "") or "",
                "tag": _field(item, "tag", "") or "",
                "tag_label": _field(item, "tag_label", "") or "",
                "issue_title": clean["issue_title"],
                "canonical_label": canonical_label(clean["issue_title"]),
                "issue_type": _field(item, "issue_type", "") or "",
                "severity": _field(item, "severity", "") or "",
                "summary": clean["summary"],
                "recommended_action": clean["recommended_action"],
                "evidence_review_ids": review_ids,
                "review_count": int(count),
                "representatives": [_rep_snapshot(r) for r in reps_src],
                "judged": bool(_field(item, "judged", True)),
            }
        )
    return out


def _rep_from_snapshot(snap: dict) -> WorklistRow:
    rdate = snap.get("review_date")
    parsed = date.fromisoformat(rdate) if isinstance(rdate, str) and rdate else None
    return WorklistRow(
        review_id=snap.get("review_id") or "",
        review_date=parsed,
        channel=snap.get("channel") or "",
        product_name=snap.get("product_name"),
        option_name=snap.get("option_name"),
        rating=snap.get("rating"),
        text=snap.get("text") or "",
    )


def _rep_from_review(rev: object) -> WorklistRow:
    return WorklistRow(
        review_id=_field(rev, "review_id") or "",
        review_date=_field(rev, "review_date"),
        channel=_field(rev, "channel") or "",
        product_name=_field(rev, "product_name"),
        option_name=_field(rev, "option_name"),
        rating=_field(rev, "rating"),
        text=_field(rev, "text") or "",
    )


def deserialize_issues(
    payload: Iterable[dict], corpus_by_id: dict | None = None
) -> list[IssueCluster]:
    """Rebuild :class:`IssueCluster` objects from a serialized payload.

    Representatives are reconstructed from the stored snapshot, preserving which
    reviews were representative and their order. When ``corpus_by_id`` is given,
    a representative's text is pulled fresh from the corpus (authoritative
    verbatim) while falling back to the snapshot for ids not present.
    """
    corpus = corpus_by_id or {}
    out: list[IssueCluster] = []
    for i, issue in enumerate(payload):
        review_ids = [str(x) for x in (issue.get("evidence_review_ids") or [])]
        reps: list[WorklistRow] = []
        for snap in issue.get("representatives") or []:
            rid = snap.get("review_id")
            if rid in corpus:
                reps.append(_rep_from_review(corpus[rid]))
            else:
                reps.append(_rep_from_snapshot(snap))
        out.append(
            IssueCluster(
                cluster_id=issue.get("cluster_id") or f"cache_{i}",
                tag=issue.get("tag") or "",
                tag_label=issue.get("tag_label") or "",
                issue_title=issue.get("issue_title") or "",
                issue_type=issue.get("issue_type") or "",
                severity=issue.get("severity") or "",
                summary=issue.get("summary") or "",
                recommended_action=issue.get("recommended_action") or "",
                review_ids=review_ids,
                representatives=reps,
                judged=bool(issue.get("judged", True)),
            )
        )
    return out
