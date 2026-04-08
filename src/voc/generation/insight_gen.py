"""Insight generator — calls LLM to produce structured VOCInsight."""

from __future__ import annotations

import json
import logging

from openai import OpenAI
from pydantic import ValidationError

from src.voc.config import get_settings
from src.voc.generation.prompts import (
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
    format_evidence_context,
)
from src.voc.schemas.insight import VOCInsight

logger = logging.getLogger(__name__)


class InsightGenerator:
    """Generates structured VOC insights from retrieved evidence chunks."""

    def __init__(self, client: OpenAI | None = None, model: str | None = None):
        settings = get_settings()
        self.client = client or OpenAI(api_key=settings.openai_api_key)
        self.model = model or settings.openai_generation_model

    def generate(self, query: str, retrieved_chunks: list[dict]) -> VOCInsight:
        """Generate a structured VOCInsight from query + retrieved evidence.

        Args:
            query: User's VOC question (Korean or English).
            retrieved_chunks: List of dicts with keys: chunk_id, text,
                evidence_ids, score, rank, language, source_channel.

        Returns:
            Validated VOCInsight instance.

        Raises:
            ValueError: If LLM response cannot be parsed into VOCInsight.
        """
        evidence_context = format_evidence_context(retrieved_chunks)

        user_message = USER_PROMPT_TEMPLATE.format(
            question=query,
            evidence_context=evidence_context,
        )

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            response_format={"type": "json_object"},
        )

        raw_text = response.choices[0].message.content
        logger.debug("LLM response", extra={"raw_text": raw_text})

        try:
            raw_dict = json.loads(raw_text)
        except json.JSONDecodeError as e:
            raise ValueError(f"LLM returned invalid JSON: {e}")

        # Compute evidence_used from sub-schemas if not provided or incomplete
        all_ids: set[str] = set()
        for theme in raw_dict.get("themes", []):
            all_ids.update(theme.get("evidence_ids", []))
        for pp in raw_dict.get("pain_points", []):
            all_ids.update(pp.get("evidence_ids", []))
        for rec in raw_dict.get("recommendations", []):
            all_ids.update(rec.get("evidence_ids", []))
        raw_dict["evidence_used"] = sorted(all_ids)
        raw_dict["evidence_available"] = len(retrieved_chunks)

        try:
            return VOCInsight.model_validate(raw_dict)
        except ValidationError as e:
            raise ValueError(f"LLM output does not match VOCInsight schema: {e}")

    def generate_team_handoff(self, insight: VOCInsight) -> dict[str, str]:
        """Generate team-specific action messages from a VOCInsight.

        TODO: implement using TEAM_HANDOFF_PROMPT
        """
        raise NotImplementedError(
            "Implement team handoff generation from VOCInsight"
        )
