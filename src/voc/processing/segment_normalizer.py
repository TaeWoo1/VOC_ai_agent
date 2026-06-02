"""Phase 1 segment normalization (skin_type / age_group / product_option).

Three-dimension normalizer per the Phase 1 design refinement (§D). Phase 1 ships
hand-curated dictionaries; Phase 2 will swap in LLM-based mapping behind the
same Protocol.

Canonical taxonomies (locked for Phase 1):

  skin_type buckets (5):  dry, normal, combination, oily, sensitive, unknown
  age_group buckets (4):  under_20, 20s, 30s, 40_plus, unknown

Mixed-value handling: labels containing one of the recognized separators
("·", "/", ",", "|") are split and the FIRST token is used; a warning is
logged. Labels not in the taxonomy → bucket = "unknown" (also logged).

product_option uses a per-product dictionary (vendor-specific labels are not
canonicalizable across products); unmapped raw labels → None.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Protocol

from src.voc.schemas.channel_meta import (
    NormalizedAgeGroup,
    NormalizedProductOption,
    NormalizedSkinType,
)

logger = logging.getLogger(__name__)


SKIN_TYPE_TAXONOMY: dict[str, str] = {
    "건성": "dry",
    "중성": "normal",
    "복합성": "combination",
    "지성": "oily",
    "민감성": "sensitive",
    "트러블성": "sensitive",
}

AGE_GROUP_TAXONOMY: dict[str, str] = {
    "10대": "under_20",
    "20대 초반": "20s",
    "20대 후반": "20s",
    "20대": "20s",
    "30대 초반": "30s",
    "30대 후반": "30s",
    "30대": "30s",
    "40대": "40_plus",
    "50대 이상": "40_plus",
}

# Mixed-value separators observed in raw OY labels. Space is intentionally NOT
# included here, since legitimate labels like "20대 초반" contain spaces.
_MIXED_SEPARATORS: tuple[str, ...] = ("·", "/", ",", "|")


class SegmentNormalizer(Protocol):
    def normalize_skin_type(self, raw: str | None) -> NormalizedSkinType: ...

    def normalize_age_group(self, raw: str | None) -> NormalizedAgeGroup: ...

    def normalize_product_option(
        self,
        channel: str,
        raw: str | None,
        product_id: str | None,
    ) -> NormalizedProductOption | None: ...


class DictionarySegmentNormalizer:
    """Phase 1 hand-curated normalizer.

    skin_type / age_group: fixed module-level taxonomy maps above.
    product_option: per-product dictionary loaded from a JSON file at construction.
    Missing dictionary file → product_option returns None for every input but
    skin_type / age_group still work via the module-level maps.
    """

    def __init__(self, dictionary_path: str | Path | None = None):
        self._dictionary: dict = {"products": {}}
        if dictionary_path:
            path = Path(dictionary_path)
            if path.is_file():
                with open(path, encoding="utf-8") as f:
                    self._dictionary = json.load(f)
            else:
                logger.warning("Option dictionary not found at %s", path)

    def normalize_skin_type(self, raw: str | None) -> NormalizedSkinType:
        first = _split_first_token(raw)
        if first is None:
            return NormalizedSkinType(bucket="unknown")
        bucket = SKIN_TYPE_TAXONOMY.get(first)
        if bucket is None:
            logger.warning("Unmapped skin_type label: %r", raw)
            return NormalizedSkinType(bucket="unknown")
        if first != raw:
            logger.warning("Mixed skin_type label %r → using first token %r", raw, first)
        return NormalizedSkinType(bucket=bucket)

    def normalize_age_group(self, raw: str | None) -> NormalizedAgeGroup:
        first = _split_first_token(raw)
        if first is None:
            return NormalizedAgeGroup(bucket="unknown")
        bucket = AGE_GROUP_TAXONOMY.get(first)
        if bucket is None:
            logger.warning("Unmapped age_group label: %r", raw)
            return NormalizedAgeGroup(bucket="unknown")
        if first != raw:
            logger.warning("Mixed age_group label %r → using first token %r", raw, first)
        return NormalizedAgeGroup(bucket=bucket)

    def normalize_product_option(
        self,
        channel: str,
        raw: str | None,
        product_id: str | None,
    ) -> NormalizedProductOption | None:
        if raw is None or product_id is None:
            return None
        if channel == "oliveyoung":
            cleaned = _preclean_oliveyoung_option(raw)
            if cleaned is None:
                return None
            raw = cleaned
        product = self._dictionary.get("products", {}).get(product_id)
        if product is None:
            return None
        option = product.get("options", {}).get(raw)
        if option is None:
            logger.warning(
                "Unmapped product option for product_id=%r raw=%r", product_id, raw
            )
            return None
        return NormalizedProductOption(**option)


class LLMSegmentNormalizer:
    """Phase 2 LLM-based normalizer. Stub — every method raises NotImplementedError.

    Pluggable behind the same SegmentNormalizer Protocol. When activated, swap
    instantiation in the OliveYoung CLI without changing call sites.
    """

    def normalize_skin_type(self, raw: str | None) -> NormalizedSkinType:
        raise NotImplementedError("LLM segment normalizer ships in Phase 2")

    def normalize_age_group(self, raw: str | None) -> NormalizedAgeGroup:
        raise NotImplementedError("LLM segment normalizer ships in Phase 2")

    def normalize_product_option(
        self,
        channel: str,
        raw: str | None,
        product_id: str | None,
    ) -> NormalizedProductOption | None:
        raise NotImplementedError("LLM segment normalizer ships in Phase 2")


# Matches a single LEADING `[...]` block (plus any surrounding whitespace).
# The character class `[^\[\]]*` forbids nested brackets, so a bracket that
# re-opens inside the block won't be greedily consumed. Non-anchored brackets
# in the middle of the label are intentionally left alone — they're part of
# the variant name, not a promotional wrapper.
_OY_LEADING_BRACKET_RE = re.compile(r"^\s*\[[^\[\]]*\]\s*")


def _preclean_oliveyoung_option(raw: str) -> str | None:
    """Strip leading promotional bracket blocks from an OY option label.

    OY option names often carry a gift/promo prefix in brackets before the
    actual variant:

        "[미니 블러쉬 증정] 레이지"        → "레이지"
        "[한정 립 듀이젤 기획] 베어리"     → "베어리"
        "[옵션] [립 듀이젤] 베어리"         → "베어리"
        "레이지"                           → "레이지"
        "[피크닉백 증정]"                  → None (empty after strip)

    Only *leading* `[...]` blocks are peeled, iteratively — any bracket that
    follows non-bracket content is preserved as part of the variant name.
    After peeling, internal whitespace runs collapse to a single space and
    a pure-whitespace result degrades to None so the downstream dictionary
    lookup sees the same "nothing to map" signal it already handles.
    """
    s = raw
    while True:
        new_s = _OY_LEADING_BRACKET_RE.sub("", s, count=1)
        if new_s == s:
            break
        s = new_s
    s = " ".join(s.split())
    return s or None


def _split_first_token(raw: str | None) -> str | None:
    """Return the first token after stripping mixed-value separators.

    "건성·복합성" → "건성"
    "건성/지성"  → "건성"
    "20대 초반" → "20대 초반"  (space is intentionally not a separator)
    None / empty → None
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    for sep in _MIXED_SEPARATORS:
        if sep in s:
            return s.split(sep, 1)[0].strip()
    return s
