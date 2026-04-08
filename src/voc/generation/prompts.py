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
