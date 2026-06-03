"""LLM issue discovery for repeated issues (Slice G).

The primary repeated-issue engine. Instead of letting tag-first cosine clustering
decide the issue grouping (``cluster.py``), this sends the candidate reviews to
an LLM once and lets it BOTH group and judge: it returns coherent single-topic
issues, each with the ``evidence_review_ids`` that directly support it and the
``excluded_review_ids`` that don't. Grouping authority is the review *meaning*,
not embedding geometry — so no domain-specific marker exceptions are needed.

Robustness contract:
- pure surface (``build_candidate_lines`` / ``build_discovery_messages`` /
  ``parse_discovery`` / ``map_issues_to_clusters``) makes NO network calls and is
  fully unit-testable.
- ``parse_discovery`` returns ``None`` ONLY on a hard failure (unparseable JSON,
  top-level not an object, or ``issues`` not a list) so the caller can fall back
  to the legacy ``cluster.cluster_issues`` engine. A valid object with
  ``"issues": []`` returns ``[]`` (a legitimate zero-issue answer — no fallback).
- deterministic guardrails are domain-agnostic: evidence ⊆ candidates, dedup,
  drop issues with < ``MIN_EVIDENCE`` evidence, drop ``ignore``.
- only ``discover_issues_llm`` / ``discover_issues`` touch OpenAI (lazy import);
  any error degrades to the hard-failure sentinel.

Embeddings are NOT used here — grouping is textual. Single-call only this slice:
candidates are capped at ``MAX_CANDIDATES`` (no chunking / batch merge yet).
"""

from __future__ import annotations

import json
import os
from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import date

from src.voc.review_ops.industrial.cluster import (
    DEFAULT_MAX_REPRESENTATIVES,
    MIN_EVIDENCE,
    ClusterCandidate,
    _rep_row,
    _SEVERITY_RANK,
    _strip_fences,
    _tag_label,
    judge_model,
    select_cluster_candidates,
)
from src.voc.review_ops.industrial.rag import resolve_api_key
from src.voc.review_ops.industrial.report_model import RECENT_DAYS
from src.voc.review_ops.industrial.schema import (
    IndustrialReport,
    IndustrialReview,
    IssueCluster,
)
from src.voc.review_ops.industrial.taxonomy import CATEGORY_BY_ID

DEFAULT_MAX_ISSUES = 5
MAX_CANDIDATES = 60
DEFAULT_VERIFIER_MODEL = "gpt-4o"

_VALID_ISSUE_TYPES = {"product", "detail_page", "cs", "shipping", "positive_signal", "ignore"}
_VALID_PRIORITY = {"high", "medium", "low"}
_VALID_BETTER_TYPES = _VALID_ISSUE_TYPES | {"unknown"}


def discovery_model() -> str:
    """Stage-1 discovery model: OPENAI_ISSUE_DISCOVERY_MODEL, else the chat model
    (OPENAI_CHAT_MODEL or gpt-4o-mini via cluster.judge_model)."""
    return os.getenv("OPENAI_ISSUE_DISCOVERY_MODEL") or judge_model()


def verifier_model() -> str:
    """Stage-2 evidence-fit model: OPENAI_ISSUE_VERIFIER_MODEL, else gpt-4o."""
    return os.getenv("OPENAI_ISSUE_VERIFIER_MODEL") or DEFAULT_VERIFIER_MODEL


@dataclass
class DiscoveredIssue:
    issue_title: str
    issue_type: str
    priority: str
    summary: str
    recommended_action: str
    evidence_review_ids: list[str]
    excluded_review_ids: list[str] = field(default_factory=list)
    why_excluded: str = ""


@dataclass
class EvidenceCheck:
    review_id: str
    supports_issue: bool
    reason: str = ""
    better_issue_type: str = "unknown"


# ---------------------------------------------------------------------------
# Candidate serialization (pure)
# ---------------------------------------------------------------------------


def _candidate_line(c: ClusterCandidate) -> str:
    r = c.review
    rating = f"{r.rating:g}점" if r.rating is not None else "평점미상"
    d = r.review_date.isoformat() if r.review_date else "날짜미상"
    prod = " ".join(x for x in (r.product_name, r.option_name) if x) or "상품미상"
    labels = ", ".join(
        CATEGORY_BY_ID[t].label_ko for t in c.tags if t in CATEGORY_BY_ID
    ) or "-"
    return (
        f"- review_id: {r.review_id} | {rating} | {d} | {prod} | 태그: {labels}\n"
        f"  내용: {r.text}"
    )


def build_candidate_lines(candidates: list[ClusterCandidate]) -> str:
    return "\n".join(_candidate_line(c) for c in candidates)


# ---------------------------------------------------------------------------
# Prompt (pure)
# ---------------------------------------------------------------------------

_SYSTEM = (
    "당신은 셀러의 리뷰 운영을 돕는 보조자입니다. "
    "후보 리뷰들을 읽고, 운영자가 챙겨야 할 서로 다른 '반복 이슈'로 나눕니다. "
    "리뷰에 실제로 적힌 사실만 사용하고, 원인을 추측하거나 없는 내용을 지어내지 마세요. "
    "반드시 지정된 JSON 객체 하나만 출력하세요."
)

_RULES = (
    "규칙:\n"
    "- 모든 문구는 한국어, 운영자가 읽는 담백한 실무체로 작성하세요.\n"
    "- 하나의 이슈는 하나의 문제만 다룹니다. 서로 다른 문제(예: 접착·벽면 부착 / 절단 시 깨짐·내구성 / "
    "누수 / 자석·뚜껑 헐거움 / 배송·포장)는 절대 한 이슈로 묶지 마세요. '내구성 및 접착'처럼 두 문제를 "
    "한 제목에 합치지 마세요.\n"
    "- evidence_review_ids: 제시된 review_id 중에서, 그 이슈의 issue_title·summary를 직접 뒷받침하는 "
    "리뷰만 넣으세요.\n"
    "- 다른 문제를 말하거나 애매한 리뷰는 excluded_review_ids에 넣고 why_excluded에 한 줄로 이유를 적으세요.\n"
    "- 한 이슈를 직접 뒷받침하는 리뷰가 2건 미만이면 그 이슈를 만들지 마세요(개별 리뷰는 운영자 worklist 몫).\n"
    "- 챙길 만한 반복 이슈가 없으면 \"issues\": [] 로 비워서 답하세요.\n"
    "- issue_type: product(제품 품질·내구성·접착 등) / detail_page(상세페이지·치수·옵션 설명 보완) / "
    "cs(교환·반품·문의 응대) / shipping(배송·포장) / "
    "positive_signal(상세페이지·마케팅에 쓸 만한 반복 긍정 이유) / ignore(이슈 아님).\n"
    "- shipping은 배송·포장 과정에서 생긴 손상(박스 파손·찌그러짐·찢어짐·분실 등)만 해당합니다. "
    "제품을 사용·시공·절단하는 중에 깨지거나 부서지는 등 제품 자체의 품질·내구성 문제는 shipping이 아니라 "
    "product입니다. 두 가지가 한 리뷰에 섞여 있으면, 그 리뷰는 더 분명한 한쪽 이슈의 evidence로만 쓰세요.\n"
    "- recommended_action은 운영자가 바로 실행할 수 있게 구체적으로, 단 원인을 단정하지 말고 가설·검토 "
    "어조로 적으세요. 예) '상세페이지에 실크벽지 사용 시 추가 양면테이프/피스 고정 안내를 추가할 후보입니다.' / "
    "'포장재 보강 또는 출고 전 박스 상태 확인을 점검하세요.' / '절단 시 사용하는 도구와 작업 방법 안내를 "
    "상세페이지·동봉 안내에 추가할 후보입니다.' '점검하고 개선 방안을 검토해야 합니다'처럼 막연한 문구나, "
    "'필요합니다'·'해야 합니다' 같은 단정·지시 표현은 쓰지 말고, "
    "후보입니다/확인해볼 수 있습니다/검토하세요/점검하세요 같은 어조로 쓰세요.\n"
    "- summary·recommended_action에 제시된 리뷰에 없는 내용을 넣지 마세요.\n"
)

_SCHEMA_HINT = (
    "다음 JSON 형식으로만 답하세요:\n"
    "{\n"
    '  "issues": [\n'
    "    {\n"
    '      "issue_title": "이슈 제목 (짧게, 한 가지 문제)",\n'
    '      "issue_type": "product"|"detail_page"|"cs"|"shipping"|"positive_signal"|"ignore",\n'
    '      "priority": "high"|"medium"|"low",\n'
    '      "summary": "묶음 요약 (제시된 리뷰 근거)",\n'
    '      "recommended_action": "운영자가 할 구체적 다음 조치",\n'
    '      "evidence_review_ids": ["이슈를 직접 뒷받침하는 review_id ..."],\n'
    '      "excluded_review_ids": ["같은 묶음이지만 다른 문제라 제외한 review_id ..."],\n'
    '      "why_excluded": "제외 이유 (선택)"\n'
    "    }\n"
    "  ]\n"
    "}"
)


def build_discovery_messages(candidates: list[ClusterCandidate]) -> list[dict]:
    """Build the single discovery call's chat messages. Pure — no network."""
    user = (
        f"다음은 운영자가 확인할 만한 후보 리뷰 {len(candidates)}건입니다.\n"
        "이 리뷰들을 서로 다른 반복 이슈로 나누세요.\n\n"
        f"[후보 리뷰]\n{build_candidate_lines(candidates)}\n\n"
        f"{_RULES}\n{_SCHEMA_HINT}"
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


# ---------------------------------------------------------------------------
# Parse + validate (pure)
# ---------------------------------------------------------------------------


def _parse_issue_item(item, allowed: set[str]) -> DiscoveredIssue | None:
    """Validate one issue object; return None to drop it (not the whole batch)."""
    if not isinstance(item, dict):
        return None
    issue_type = item.get("issue_type")
    priority = item.get("priority")
    title = item.get("issue_title")
    summary = item.get("summary")
    action = item.get("recommended_action")
    if issue_type not in _VALID_ISSUE_TYPES or priority not in _VALID_PRIORITY:
        return None
    if issue_type == "ignore":
        return None
    if not (isinstance(title, str) and isinstance(summary, str) and isinstance(action, str)):
        return None
    if not title.strip() or not summary.strip():
        return None

    raw_ev = item.get("evidence_review_ids")
    evidence: list[str] = []
    if isinstance(raw_ev, list):
        for x in raw_ev:
            if isinstance(x, str) and x in allowed and x not in evidence:
                evidence.append(x)
    if len(evidence) < MIN_EVIDENCE:
        return None

    raw_ex = item.get("excluded_review_ids")
    excluded = [x for x in raw_ex if isinstance(x, str)] if isinstance(raw_ex, list) else []
    why = item.get("why_excluded")
    return DiscoveredIssue(
        issue_title=title.strip(),
        issue_type=issue_type,
        priority=priority,
        summary=summary.strip(),
        recommended_action=action.strip(),
        evidence_review_ids=evidence,
        excluded_review_ids=excluded,
        why_excluded=why.strip() if isinstance(why, str) else "",
    )


def parse_discovery(content: str, allowed_ids: list[str]) -> list[DiscoveredIssue] | None:
    """Parse the discovery JSON. ``None`` on HARD failure only (unparseable, not
    an object, or ``issues`` not a list); ``[]`` for a valid zero-issue answer."""
    try:
        data = json.loads(_strip_fences(content))
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    raw_issues = data.get("issues")
    if not isinstance(raw_issues, list):
        return None
    allowed = set(allowed_ids)
    out: list[DiscoveredIssue] = []
    for item in raw_issues:
        di = _parse_issue_item(item, allowed)
        if di is not None:
            out.append(di)
    return out


# ---------------------------------------------------------------------------
# Map to IssueCluster (pure)
# ---------------------------------------------------------------------------


def _dominant_tag(cands: list[ClusterCandidate]) -> tuple[str, str]:
    """Most common primary tag among the evidence (metadata only, not grouping)."""
    tag = Counter(c.primary_tag for c in cands).most_common(1)[0][0]
    return tag, _tag_label(tag)


def map_issues_to_clusters(
    issues: list[DiscoveredIssue],
    cand_by_id: dict[str, ClusterCandidate],
    *,
    max_evidence: int = DEFAULT_MAX_REPRESENTATIVES,
) -> list[IssueCluster]:
    """Map validated issues to IssueClusters. Display evidence capped at
    ``max_evidence``; ``review_ids`` / ``review_count`` are the supported
    evidence (consistent with the current visible-count policy)."""
    clusters: list[IssueCluster] = []
    for i, iss in enumerate(issues):
        ev = [rid for rid in iss.evidence_review_ids if rid in cand_by_id]
        if len(ev) < MIN_EVIDENCE:
            continue
        cands = [cand_by_id[rid] for rid in ev]
        tag, tag_label = _dominant_tag(cands)
        shown = cands[:max_evidence]
        clusters.append(
            IssueCluster(
                cluster_id=f"llm__{i}",
                tag=tag,
                tag_label=tag_label,
                issue_title=iss.issue_title,
                issue_type=iss.issue_type,
                severity=iss.priority,
                summary=iss.summary,
                recommended_action=iss.recommended_action,
                review_ids=list(ev),
                representatives=[_rep_row(c) for c in shown],
                judged=True,
            )
        )
    clusters.sort(
        key=lambda c: (-_SEVERITY_RANK.get(c.severity, 0), -c.review_count, c.cluster_id)
    )
    return clusters


# ---------------------------------------------------------------------------
# OpenAI-backed (lazy import; degrade gracefully)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Stage 2 — evidence-fit verification (pure prompt/parse)
# ---------------------------------------------------------------------------

_VERIFY_SYSTEM = (
    "당신은 리뷰 근거를 검증하는 보조자입니다. 하나의 이슈와 후보 근거 리뷰들을 받고, "
    "각 리뷰가 그 이슈를 '직접' 뒷받침하는지 판단합니다. "
    "리뷰에 실제로 적힌 사실만 보고 판단하고, 추측하거나 지어내지 마세요. "
    "반드시 지정된 JSON 객체 하나만 출력하세요."
)

_VERIFY_RULES = (
    "판단 규칙:\n"
    "- supports_issue: 그 리뷰가 이 이슈의 제목·요약이 가리키는 바로 그 문제를 직접 말하면 true, "
    "아니면 false.\n"
    "- 막연히 부정적이거나 관련 단어가 겹친다는 이유로 true를 주지 마세요. 다른 문제를 말하면 false.\n"
    "- 이슈가 배송·포장(shipping)이면, 제품을 사용·시공·절단하는 도중에 생긴 손상·파손은 "
    "리뷰가 '배송·포장 과정에서 손상됐다'고 분명히 말하지 않는 한 직접 증거가 아닙니다(false).\n"
    "- better_issue_type: 그 리뷰가 더 잘 맞는 유형을 추정해 적으세요"
    "(product|detail_page|cs|shipping|positive_signal|ignore|unknown).\n"
    "- 모든 리뷰를 false로 둘 수도 있습니다.\n"
    "- reason은 한 줄로 짧게.\n"
)

_VERIFY_SCHEMA = (
    "다음 JSON 형식으로만 답하세요:\n"
    "{\n"
    '  "evidence_checks": [\n'
    '    {"review_id": "...", "supports_issue": true 또는 false, '
    '"reason": "...", "better_issue_type": "product"|"detail_page"|"cs"|"shipping"'
    '|"positive_signal"|"ignore"|"unknown"}\n'
    "  ]\n"
    "}"
)


def build_verifier_messages(
    issue: DiscoveredIssue, candidates: list[ClusterCandidate]
) -> list[dict]:
    """Build the per-issue evidence-fit messages. Pure — no network."""
    lines = []
    for c in candidates:
        r = c.review
        rating = f"{r.rating:g}점" if r.rating is not None else "평점미상"
        d = r.review_date.isoformat() if r.review_date else "날짜미상"
        lines.append(f"- review_id: {r.review_id} | {rating} | {d}\n  내용: {r.text}")
    user = (
        "[이슈]\n"
        f"제목: {issue.issue_title}\n유형: {issue.issue_type}\n요약: {issue.summary}\n\n"
        f"[검증할 근거 리뷰]\n{chr(10).join(lines)}\n\n"
        f"{_VERIFY_RULES}\n{_VERIFY_SCHEMA}"
    )
    return [
        {"role": "system", "content": _VERIFY_SYSTEM},
        {"role": "user", "content": user},
    ]


def parse_verifier(content: str, allowed_ids: list[str]) -> list[EvidenceCheck] | None:
    """Parse the verifier JSON. ``None`` on HARD failure (unparseable, not an
    object, or ``evidence_checks`` not a list). Invalid items are skipped."""
    try:
        data = json.loads(_strip_fences(content))
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    raw = data.get("evidence_checks")
    if not isinstance(raw, list):
        return None
    allowed = set(allowed_ids)
    out: list[EvidenceCheck] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        rid = item.get("review_id")
        sup = item.get("supports_issue")
        if not isinstance(rid, str) or rid not in allowed or not isinstance(sup, bool):
            continue
        bit = item.get("better_issue_type")
        if bit not in _VALID_BETTER_TYPES:
            bit = "unknown"
        reason = item.get("reason")
        out.append(
            EvidenceCheck(
                review_id=rid, supports_issue=sup,
                reason=reason.strip() if isinstance(reason, str) else "",
                better_issue_type=bit,
            )
        )
    return out


# ---------------------------------------------------------------------------
# OpenAI-backed (lazy import; degrade gracefully)
# ---------------------------------------------------------------------------


def discover_issues_llm(
    candidates: list[ClusterCandidate], *, api_key: str, model: str | None = None
) -> list[DiscoveredIssue] | None:
    """Single discovery call. Returns parsed issues, or ``None`` on hard failure
    (call error or unparseable/garbage JSON)."""
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model or discovery_model(),
            messages=build_discovery_messages(candidates),
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=1500,
        )
        content = resp.choices[0].message.content or ""
        allowed = [c.review.review_id for c in candidates]
        return parse_discovery(content, allowed)
    except Exception:
        return None


def verify_issue_evidence_llm(
    issue: DiscoveredIssue,
    candidates: list[ClusterCandidate],
    *,
    api_key: str,
    model: str | None = None,
) -> set[str] | None:
    """Verify which candidate reviews directly support ``issue``. Returns the set
    of supporting review_ids, or ``None`` on hard failure (call error / bad JSON)
    so the caller can drop just this issue."""
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model or verifier_model(),
            messages=build_verifier_messages(issue, candidates),
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=800,
        )
        content = resp.choices[0].message.content or ""
        allowed = [c.review.review_id for c in candidates]
        checks = parse_verifier(content, allowed)
        if checks is None:
            return None
        return {c.review_id for c in checks if c.supports_issue}
    except Exception:
        return None


def discover_issues(
    report: IndustrialReport,
    reviews: list[IndustrialReview],
    *,
    api_key: str | None = None,
    model: str | None = None,
    today: date | None = None,
    recent_days: int = RECENT_DAYS,
    max_issues: int = DEFAULT_MAX_ISSUES,
    max_evidence: int = DEFAULT_MAX_REPRESENTATIVES,
) -> tuple[IndustrialReport, dict]:
    """Discover repeated issues over candidate reviews (primary engine).

    Two stages: (1) discovery proposes single-topic issues with candidate
    evidence; (2) a per-issue evidence-fit verifier (stronger model by default)
    confirms each proposed evidence review directly supports the issue. Evidence
    failing verification is dropped; an issue with < ``MIN_EVIDENCE`` confirmed
    evidence is dropped. A verifier hard failure drops only that issue.

    ``summary['status']`` is ``ok`` / ``no_key`` / ``hard_failure`` (discovery
    only — the caller falls back to the legacy engine on ``hard_failure``).
    Candidates are capped at ``MAX_CANDIDATES`` (no chunking this slice).
    """
    api_key = api_key or resolve_api_key()
    ver_model = verifier_model()
    candidates = select_cluster_candidates(reviews, today=today, recent_days=recent_days)
    used = candidates[:MAX_CANDIDATES]
    summary = {
        "engine": "discovery",
        "candidate_count": len(candidates),
        "used_candidate_count": len(used),
        "issues": 0,
        "evidence_rejected": 0,
        "verifier_used": False,
        "verifier_model": ver_model,
        "had_key": bool(api_key),
        "status": "ok",
    }
    if not api_key:
        return report, {**summary, "status": "no_key"}
    if not used:
        return report, summary  # zero candidates -> zero issues (valid)

    issues = discover_issues_llm(used, api_key=api_key, model=model)
    if issues is None:
        return report, {**summary, "status": "hard_failure"}

    cand_by_id = {c.review.review_id: c for c in used}
    verified: list[DiscoveredIssue] = []
    rejected = 0
    for iss in issues:
        cands = [cand_by_id[rid] for rid in iss.evidence_review_ids if rid in cand_by_id]
        if len(cands) < MIN_EVIDENCE:
            continue
        summary["verifier_used"] = True
        supported = verify_issue_evidence_llm(iss, cands, api_key=api_key, model=ver_model)
        if supported is None:
            continue  # verifier hard failure for THIS issue -> drop issue only
        kept = [rid for rid in iss.evidence_review_ids if rid in supported]
        rejected += len(cands) - len(kept)
        if len(kept) < MIN_EVIDENCE:
            continue
        verified.append(replace(iss, evidence_review_ids=kept))

    clusters = map_issues_to_clusters(verified, cand_by_id, max_evidence=max_evidence)[:max_issues]
    summary["issues"] = len(clusters)
    summary["evidence_rejected"] = rejected
    return replace(report, issue_clusters=clusters), summary
