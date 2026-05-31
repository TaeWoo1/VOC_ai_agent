"""Cluster-based repeated-issue rollup (Slice 2C).

The rule-based pipeline and the optional per-row LLM refinement (Slice 2B) stay
unchanged. This module adds an optional third stage: it groups *similar*
candidate reviews into repeated-issue clusters and uses an LLM **once per
cluster** to judge whether the cluster is a real operator issue.

Altitude vs. 2B: 2B cleans individual worklist rows; 2C rolls candidates up into
"반복 이슈". 2C never modifies worklist rows — it only adds ``issue_clusters`` to
the report.

Graceful degradation is the contract: no API key (or no candidates) returns the
report unchanged with an empty issue section; a per-cluster judge failure drops
that cluster rather than fabricating one. The pure surface
(``select_cluster_candidates`` / ``cluster_candidates`` / ``pick_representatives``
/ ``parse_issue_judgement`` / ``apply_issue_clusters``) makes NO network calls
and is fully unit-testable; only ``judge_cluster`` / ``cluster_issues`` touch
OpenAI, via a lazy import.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import date

from src.voc.review_ops.industrial.classify import classify
from src.voc.review_ops.industrial.rag import (
    build_document,
    chat_model,
    cosine_similarity,
    embed_texts,
    resolve_api_key,
)
from src.voc.review_ops.industrial.report_model import LOW_RATING_THRESHOLD, RECENT_DAYS
from src.voc.review_ops.industrial.schema import (
    IndustrialReport,
    IndustrialReview,
    IssueCluster,
    WorklistRow,
)
from src.voc.review_ops.industrial.taxonomy import (
    CATEGORY_BY_ID,
    SEVERITY,
    WORKLIST_FORCING_KINDS,
)

DEFAULT_JUDGE_MODEL = "gpt-4o-mini"
DEFAULT_SIM_THRESHOLD = 0.5
MIN_CLUSTER_SIZE = 2
DEFAULT_MAX_CLUSTERS = 10
DEFAULT_MAX_REPRESENTATIVES = 5
MAX_WORKERS = 8

# Candidates with no risk/operational tag (low-rating only) share this pseudo
# group so they can still cluster by similarity without a taxonomy id.
LOW_RATING_BUCKET = "_low_rating"

_VALID_ISSUE_TYPES = {"product", "detail_page", "cs", "shipping", "positive_signal", "ignore"}
_VALID_SEVERITY = {"high", "medium", "low"}
_SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1}


def judge_model() -> str:
    """Cluster-judge model: reuse the RAG chat-model env, default gpt-4o-mini."""
    return chat_model() or DEFAULT_JUDGE_MODEL


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class ClusterCandidate:
    review: IndustrialReview
    tags: list[str]
    primary_tag: str  # taxonomy id, or LOW_RATING_BUCKET


@dataclass
class RawCluster:
    cluster_id: str
    tag: str
    tag_label: str
    members: list[ClusterCandidate]
    representatives: list[ClusterCandidate]


@dataclass
class IssueJudgement:
    cluster_id: str
    is_real_issue: bool
    issue_title: str
    issue_type: str
    severity: str
    summary: str
    recommended_action: str
    evidence_review_ids: list[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Candidate selection (pure)
# ---------------------------------------------------------------------------


def _is_recent(review_date: date | None, today: date, recent_days: int) -> bool:
    if review_date is None:
        return False
    return 0 <= (today - review_date).days <= recent_days


def _is_low_rating(rating: float | None) -> bool:
    return rating is not None and rating <= LOW_RATING_THRESHOLD


def _tag_severity(tag: str) -> int:
    cat = CATEGORY_BY_ID.get(tag)
    return SEVERITY[cat.kind] if cat else SEVERITY["signal"]


def _tag_label(tag: str) -> str:
    cat = CATEGORY_BY_ID.get(tag)
    return cat.label_ko if cat else "저평점"


def _primary_tag(tags: list[str]) -> str:
    """Highest-severity forcing tag, else the low-rating pseudo bucket.

    Mirrors the primary-tag selection ``report_model._build_row`` uses, without
    changing it.
    """
    forcing = [t for t in tags if CATEGORY_BY_ID[t].kind in WORKLIST_FORCING_KINDS]
    if forcing:
        return max(forcing, key=lambda t: SEVERITY[CATEGORY_BY_ID[t].kind])
    return LOW_RATING_BUCKET


def select_cluster_candidates(
    reviews: list[IndustrialReview],
    *,
    today: date | None = None,
    recent_days: int = RECENT_DAYS,
) -> list[ClusterCandidate]:
    """Recent candidates that carry a risk/operational tag OR a low rating.

    Reuses ``classify`` and the taxonomy as-is — no detector/scoring change. A
    5★ review with a real problem (it carries a forcing tag) is included; a
    positive low-rating review is included too but will be filtered by the LLM
    judge downstream.
    """
    active = [r for r in reviews if not r.is_duplicate]
    if today is None:
        known = [r.review_date for r in active if r.review_date is not None]
        today = max(known) if known else date.today()

    candidates: list[ClusterCandidate] = []
    for review in active:
        if not _is_recent(review.review_date, today, recent_days):
            continue
        tags = classify(review)
        forced = any(CATEGORY_BY_ID[t].kind in WORKLIST_FORCING_KINDS for t in tags)
        if not (forced or _is_low_rating(review.rating)):
            continue
        candidates.append(
            ClusterCandidate(review=review, tags=tags, primary_tag=_primary_tag(tags))
        )
    return candidates


# ---------------------------------------------------------------------------
# Clustering (pure)
# ---------------------------------------------------------------------------


def _order_key(c: ClusterCandidate):
    """Deterministic worst-first order: severity desc, rating asc, date desc, id."""
    return (
        -_tag_severity(c.primary_tag),
        c.review.rating if c.review.rating is not None else 99.0,
        -(c.review.review_date.toordinal() if c.review.review_date else 0),
        c.review.review_id,
    )


def pick_representatives(
    members: list[ClusterCandidate], *, max_representatives: int = DEFAULT_MAX_REPRESENTATIVES
) -> list[ClusterCandidate]:
    """Up to N representative members, worst-first and deterministic."""
    return sorted(members, key=_order_key)[:max_representatives]


def _greedy_cluster(
    members: list[ClusterCandidate],
    embeddings: dict[str, list[float]],
    threshold: float,
) -> list[list[ClusterCandidate]]:
    """Order-stable greedy clustering: each member joins the first existing
    cluster whose anchor (first member) is within ``threshold`` cosine, else it
    opens a new cluster. Deterministic for a fixed input order."""
    clusters: list[list[ClusterCandidate]] = []
    for cand in members:
        vec = embeddings[cand.review.review_id]
        placed = False
        for cluster in clusters:
            anchor_vec = embeddings[cluster[0].review.review_id]
            if cosine_similarity(vec, anchor_vec) >= threshold:
                cluster.append(cand)
                placed = True
                break
        if not placed:
            clusters.append([cand])
    return clusters


def _cluster_rank_key(rc: RawCluster):
    latest = max(
        (m.review.review_date.toordinal() for m in rc.members if m.review.review_date),
        default=0,
    )
    return (-len(rc.members), -_tag_severity(rc.tag), -latest, rc.cluster_id)


def cluster_candidates(
    candidates: list[ClusterCandidate],
    embeddings: dict[str, list[float]],
    *,
    sim_threshold: float = DEFAULT_SIM_THRESHOLD,
    min_cluster_size: int = MIN_CLUSTER_SIZE,
    max_clusters: int = DEFAULT_MAX_CLUSTERS,
    max_representatives: int = DEFAULT_MAX_REPRESENTATIVES,
) -> list[RawCluster]:
    """Group by primary tag, then cluster by cosine similarity within each group.

    Drops clusters smaller than ``min_cluster_size`` and caps at ``max_clusters``
    (largest / most-severe / most-recent first). Candidates without an embedding
    are skipped. Pure — no network.
    """
    usable = [c for c in candidates if c.review.review_id in embeddings]

    groups: dict[str, list[ClusterCandidate]] = {}
    for cand in usable:
        groups.setdefault(cand.primary_tag, []).append(cand)

    raw: list[RawCluster] = []
    for tag, members in groups.items():
        members_sorted = sorted(members, key=_order_key)
        for members_cl in _greedy_cluster(members_sorted, embeddings, sim_threshold):
            if len(members_cl) < min_cluster_size:
                continue
            anchor = members_cl[0]
            raw.append(
                RawCluster(
                    cluster_id=f"{tag}__{anchor.review.review_id}",
                    tag=tag,
                    tag_label=_tag_label(tag),
                    members=members_cl,
                    representatives=pick_representatives(
                        members_cl, max_representatives=max_representatives
                    ),
                )
            )

    raw.sort(key=_cluster_rank_key)
    return raw[:max_clusters]


# ---------------------------------------------------------------------------
# Judge prompt (pure)
# ---------------------------------------------------------------------------

_SYSTEM = (
    "당신은 셀러의 리뷰 운영을 돕는 보조자입니다. "
    "서로 비슷한 리뷰를 묶은 그룹을 보고, 이것이 운영자가 챙겨야 할 '반복되는 이슈'인지 판단합니다. "
    "제공된 리뷰에 실제로 적힌 사실만 근거로 하고, 원인을 추측하거나 없는 사실을 지어내지 마세요. "
    "반드시 지정된 JSON 객체 하나만 출력하세요."
)

_RULES = (
    "판단 규칙:\n"
    "- 모든 문구는 한국어, 운영자가 읽는 담백한 실무체로 작성하세요.\n"
    "- is_real_issue: 대표 리뷰들이 공통적으로 운영자가 확인·조치할 만한 문제를 가리키면 true, "
    "단순 만족·감사·무내용이거나 우연히 키워드만 겹친 묶음이면 false.\n"
    "- issue_type: product(제품 품질·내구성·접착 등) / detail_page(상세페이지·치수·옵션 설명 보완) / "
    "cs(교환·반품·문의 응대) / shipping(배송·포장) / "
    "positive_signal(상세페이지·마케팅에 쓸 만한 반복되는 긍정 구매 이유) / ignore(이슈 아님).\n"
    "- 포장·배송이 손상됐더라도 제품 자체는 손상·분실이 없다고 하면 shipping으로 보고, "
    "교환 안내 대신 포장 상태 점검을 제안하세요.\n"
    "- positive_signal은 마케팅·상세페이지에 활용할 만한 반복 긍정 이유일 때만 is_real_issue=true로 두고, "
    "그 외 단순 칭찬이면 ignore로 분류하세요.\n"
    "- recommended_action: 운영자가 할 다음 조치를 가설·검토 어조로 적고, 원인을 단정하지 마세요.\n"
    "- summary·recommended_action에 대표 리뷰에 없는 내용을 넣지 마세요.\n"
    "- evidence_review_ids: 위 대표 리뷰의 review_id 중에서만 고르세요.\n"
)

_SCHEMA_HINT = (
    "다음 JSON 형식으로만 답하세요:\n"
    "{\n"
    '  "is_real_issue": true 또는 false,\n'
    '  "issue_title": "이슈 제목 (짧게)",\n'
    '  "issue_type": "product"|"detail_page"|"cs"|"shipping"|"positive_signal"|"ignore",\n'
    '  "severity": "high"|"medium"|"low",\n'
    '  "summary": "묶음 요약 (대표 리뷰 근거)",\n'
    '  "recommended_action": "운영자가 할 다음 조치",\n'
    '  "evidence_review_ids": ["대표 리뷰 review_id ..."]\n'
    "}"
)


def _rep_block(reps: list[ClusterCandidate]) -> str:
    lines: list[str] = []
    for c in reps:
        r = c.review
        rating = f"{r.rating:g}점" if r.rating is not None else "평점미상"
        d = r.review_date.isoformat() if r.review_date else "날짜미상"
        lines.append(f"- review_id: {r.review_id} | {d} · {r.channel} · {rating}\n  내용: {r.text}")
    return "\n".join(lines)


def build_judge_messages(rc: RawCluster) -> list[dict]:
    """Build the per-cluster chat messages. Pure — no network."""
    user = (
        f"다음은 '{rc.tag_label}'(으)로 1차 분류된, 서로 비슷한 리뷰 {len(rc.representatives)}건입니다.\n"
        "이 묶음이 운영자가 챙겨야 할 반복 이슈인지 판단하세요.\n\n"
        f"[대표 리뷰]\n{_rep_block(rc.representatives)}\n\n"
        f"{_RULES}\n{_SCHEMA_HINT}"
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


# ---------------------------------------------------------------------------
# Judge parsing (pure)
# ---------------------------------------------------------------------------


def _strip_fences(content: str) -> str:
    s = (content or "").strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else ""
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    return s.strip()


def parse_issue_judgement(
    cluster_id: str, content: str, allowed_ids: list[str]
) -> IssueJudgement | None:
    """Strictly parse the model JSON into an IssueJudgement, or None on problems.

    ``evidence_review_ids`` is intersected with ``allowed_ids`` (the ids the model
    was actually shown), order-preserving and deduped — the model's claimed
    evidence is never trusted blindly.
    """
    try:
        data = json.loads(_strip_fences(content))
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None

    is_real = data.get("is_real_issue")
    issue_type = data.get("issue_type")
    severity = data.get("severity")
    title = data.get("issue_title")
    summary = data.get("summary")
    action = data.get("recommended_action")

    if not isinstance(is_real, bool):
        return None
    if issue_type not in _VALID_ISSUE_TYPES:
        return None
    if severity not in _VALID_SEVERITY:
        return None
    if not (isinstance(title, str) and isinstance(summary, str) and isinstance(action, str)):
        return None
    if is_real and (not title.strip() or not summary.strip()):
        return None

    allowed = set(allowed_ids)
    raw_ev = data.get("evidence_review_ids")
    evidence: list[str] = []
    if isinstance(raw_ev, list):
        for x in raw_ev:
            if isinstance(x, str) and x in allowed and x not in evidence:
                evidence.append(x)

    return IssueJudgement(
        cluster_id=cluster_id,
        is_real_issue=is_real,
        issue_title=title.strip(),
        issue_type=issue_type,
        severity=severity,
        summary=summary.strip(),
        recommended_action=action.strip(),
        evidence_review_ids=evidence,
        raw=data,
    )


# ---------------------------------------------------------------------------
# Apply judgements to the report (pure)
# ---------------------------------------------------------------------------


def _rep_row(cand: ClusterCandidate) -> WorklistRow:
    r = cand.review
    return WorklistRow(
        review_id=r.review_id,
        review_date=r.review_date,
        channel=r.channel,
        product_name=r.product_name,
        option_name=r.option_name,
        rating=r.rating,
        text=r.text,
        tags=list(cand.tags),
        tag_labels=[CATEGORY_BY_ID[t].label_ko for t in cand.tags if t in CATEGORY_BY_ID],
    )


def apply_issue_clusters(
    report: IndustrialReport,
    raw_clusters: list[RawCluster],
    judgements: dict[str, IssueJudgement],
) -> IndustrialReport:
    """Return a new report whose ``issue_clusters`` reflect the judgements.

    A cluster is included only when it has a judgement with ``is_real_issue`` and
    ``issue_type`` != "ignore". Clusters with no judgement (failed/absent call)
    are dropped — the section shows only LLM-confirmed issues, never fabricated
    fallbacks. Ordered by severity then size.
    """
    clusters: list[IssueCluster] = []
    for rc in raw_clusters:
        j = judgements.get(rc.cluster_id)
        if j is None:
            continue
        if not j.is_real_issue or j.issue_type == "ignore":
            continue
        clusters.append(
            IssueCluster(
                cluster_id=rc.cluster_id,
                tag=rc.tag,
                tag_label=rc.tag_label,
                issue_title=j.issue_title,
                issue_type=j.issue_type,
                severity=j.severity,
                summary=j.summary,
                recommended_action=j.recommended_action,
                review_ids=[m.review.review_id for m in rc.members],
                representatives=[_rep_row(c) for c in rc.representatives],
                judged=True,
            )
        )

    clusters.sort(
        key=lambda c: (-_SEVERITY_RANK.get(c.severity, 0), -c.review_count, c.cluster_id)
    )
    return replace(report, issue_clusters=clusters)


# ---------------------------------------------------------------------------
# OpenAI-backed (lazy import; degrade gracefully)
# ---------------------------------------------------------------------------


def judge_cluster(rc: RawCluster, *, api_key: str, model: str | None = None) -> IssueJudgement | None:
    """Judge a single cluster. Returns None on any failure."""
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model or judge_model(),
            messages=build_judge_messages(rc),
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=400,
        )
        content = resp.choices[0].message.content or ""
        allowed = [c.review.review_id for c in rc.representatives]
        return parse_issue_judgement(rc.cluster_id, content, allowed)
    except Exception:
        return None


def _resolve_embeddings(
    candidates: list[ClusterCandidate],
    reuse: dict[str, list[float]] | None,
    *,
    api_key: str,
    model: str | None,
) -> dict[str, list[float]]:
    """Embeddings for every candidate, reusing ``reuse`` (e.g. an existing RAG
    index) and embedding only the missing ones. May raise on a hard embed
    failure (the caller wraps the feature)."""
    embeddings: dict[str, list[float]] = {}
    if reuse:
        for c in candidates:
            rid = c.review.review_id
            if rid in reuse:
                embeddings[rid] = reuse[rid]
    missing = [c for c in candidates if c.review.review_id not in embeddings]
    if missing:
        docs = [build_document(c.review, c.tags) for c in missing]
        vecs = embed_texts(docs, api_key=api_key, model=model)
        for c, vec in zip(missing, vecs):
            embeddings[c.review.review_id] = vec
    return embeddings


def cluster_issues(
    report: IndustrialReport,
    reviews: list[IndustrialReview],
    *,
    api_key: str | None = None,
    model: str | None = None,
    embeddings: dict[str, list[float]] | None = None,
    embedding_model: str | None = None,
    today: date | None = None,
    recent_days: int = RECENT_DAYS,
    sim_threshold: float = DEFAULT_SIM_THRESHOLD,
    min_cluster_size: int = MIN_CLUSTER_SIZE,
    max_clusters: int = DEFAULT_MAX_CLUSTERS,
    max_representatives: int = DEFAULT_MAX_REPRESENTATIVES,
) -> tuple[IndustrialReport, dict]:
    """Build repeated-issue clusters and judge them. Adds ``issue_clusters``.

    With no API key (or no candidates) the report is returned unchanged.
    ``embeddings`` (review_id -> vector) is reused when provided; missing
    candidates are embedded on demand. ``summary`` carries counts for the UI:
    ``candidates / clusters / issues``.
    """
    api_key = api_key or resolve_api_key()
    candidates = select_cluster_candidates(reviews, today=today, recent_days=recent_days)

    base_summary = {
        "candidates": len(candidates),
        "clusters": 0,
        "issues": 0,
        "had_key": bool(api_key),
    }
    if not api_key or not candidates:
        return report, base_summary

    resolved = _resolve_embeddings(
        candidates, embeddings, api_key=api_key, model=embedding_model
    )
    raw_clusters = cluster_candidates(
        candidates,
        resolved,
        sim_threshold=sim_threshold,
        min_cluster_size=min_cluster_size,
        max_clusters=max_clusters,
        max_representatives=max_representatives,
    )
    if not raw_clusters:
        return report, {**base_summary, "had_key": True}

    judgements: dict[str, IssueJudgement] = {}
    workers = min(MAX_WORKERS, len(raw_clusters))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(
            pool.map(
                lambda rc: (rc.cluster_id, judge_cluster(rc, api_key=api_key, model=model)),
                raw_clusters,
            )
        )
    for cluster_id, judgement in results:
        if judgement is not None:
            judgements[cluster_id] = judgement

    new_report = apply_issue_clusters(report, raw_clusters, judgements)
    return new_report, {
        "candidates": len(candidates),
        "clusters": len(raw_clusters),
        "issues": len(new_report.issue_clusters),
        "had_key": True,
    }
