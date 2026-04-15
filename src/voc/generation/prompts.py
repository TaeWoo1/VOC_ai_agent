"""Prompt templates for VOC insight generation."""

SYSTEM_PROMPT = """\
You are a VOC (Voice of Customer) analyst. Your job is to analyze customer \
feedback evidence and produce structured insights.

Rules:
1. Respond in the same language as the user's question.
2. Every claim must cite specific evidence IDs from the provided context. \
Use the format [evidence_id] when citing.
3. Do not make claims that are not supported by the provided evidence.
4. If the evidence is sparse, ambiguous, or insufficient to answer \
confidently, say so explicitly in the caveats field.
5. If no relevant evidence exists for the question, state that clearly \
and do not fabricate insights.

Output a JSON object with this structure:
{
  "query": "<the original question>",
  "query_language": "ko" or "en",
  "response_language": "ko" or "en",
  "summary": "<2-3 sentence overview>",
  "themes": [
    {"label": "<topic>", "description": "<description>", "sentiment": "positive|negative|mixed", "evidence_ids": ["..."]}
  ],
  "pain_points": [
    {"description": "<what hurts>", "severity": "critical|major|minor", "evidence_ids": ["..."]}
  ],
  "recommendations": [
    {"action": "<specific action>", "rationale": "<why, based on evidence>", "evidence_ids": ["..."]}
  ],
  "evidence_used": ["<all evidence_ids cited above>"],
  "evidence_available": <number of evidence chunks provided>,
  "caveats": ["<any limitations, data gaps, or ambiguity>"]
}

Return only the JSON object. No markdown, no commentary.\
"""

USER_PROMPT_TEMPLATE = """\
Question: {question}

Evidence:
{evidence_context}\
"""

# TODO: implement when team handoff generation is needed
TEAM_HANDOFF_PROMPT = ""

# --- Monitoring prompts (used as "question" input to pipeline.query()) ---
# These steer the LLM's focus while the output shape remains VOCInsight.

MONITORING_DASHBOARD_PROMPT = (
    "이 제품/매장의 전체 리뷰를 운영자 관점에서 종합 분석해주세요. "
    "주요 불만사항, 반복적으로 나타나는 이슈, 긍정적인 테마, "
    "그리고 가장 시급하게 대응해야 할 문제를 중심으로 정리해주세요."
)

MONITORING_ISSUES_PROMPT = (
    "이 제품/매장 리뷰에서 나타나는 불만사항과 문제점을 심각도별로 분석해주세요. "
    "반복적으로 언급되는 이슈와 즉시 대응이 필요한 문제를 중심으로 정리해주세요."
)

MONITORING_SUMMARY_PROMPT = (
    "이 제품/매장의 최근 리뷰 상황을 2-3문장으로 간결하게 요약해주세요. "
    "전반적인 고객 반응과 주요 동향을 중심으로 작성해주세요."
)


def format_evidence_context(retrieved_chunks: list[dict]) -> str:
    """Format retrieved chunks into a string for prompt injection.

    Each line: [evidence_id, evidence_id] text
    """
    lines = []
    for chunk in retrieved_chunks:
        ids = chunk.get("evidence_ids", [])
        text = chunk.get("text", "")
        id_str = ", ".join(ids) if ids else chunk.get("chunk_id", "unknown")
        lines.append(f"[{id_str}] {text}")
    return "\n".join(lines)
