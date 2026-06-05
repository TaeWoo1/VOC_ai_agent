"""Draft schema + merge helpers for multimodal guidance extraction (S2x.3b).

Pure, offline: defines the ``product_guidance_draft.json`` shape and the
deterministic merge of per-tile field arrays into one draft. NO network, NO
OpenAI, NO OCR. This is a *draft* representation only — NOT ProductKnowledge.
The field keys are deliberately named to map 1:1 onto a future ProductKnowledge
schema, but nothing here imports or depends on it.

Every draft is explicitly marked ``extraction_mode="multimodal_draft"`` /
``needs_operator_review=True`` / ``visibility="consumer_visible"`` so no
downstream consumer can mistake it for verified product facts.
"""

from __future__ import annotations

SOURCE_TYPE = "local_detail_images"
VISIBILITY = "consumer_visible"
EXTRACTION_MODE = "multimodal_draft"

EXTRACTION_NOTES = (
    "초안입니다. 운영자 확인이 필요합니다. "
    "이미지에 보이는 내용만 추출했으며 일반 지식으로 추론하지 않았습니다."
)

# The six list-valued field groups (product_identity is handled separately).
LIST_FIELD_KEYS: tuple[str, ...] = (
    "usage_installation",
    "surface_adhesion",
    "cutting_handling",
    "included_components",
    "size_spec",
    "warnings_faq",
)

_CONF_ORDER = {"low": 0, "medium": 1, "high": 2}
_VALID_CONF = tuple(_CONF_ORDER)


def normalize_value(value: str) -> str:
    """Normalized dedup key for an item value (lowercase, whitespace-collapsed)."""
    return " ".join((value or "").split()).strip().lower()


def _coerce_conf(conf) -> str:
    return conf if conf in _VALID_CONF else "low"


def coerce_item(raw, *, source_tiles: list[str] | None = None) -> dict | None:
    """Coerce a model-returned item into the canonical item shape.

    Accepts a plain string or a dict; returns ``{value, verbatim, confidence,
    source_tiles}`` or ``None`` when there is no usable value. When
    ``source_tiles`` is given it overrides any tile attribution the model
    invented (the real tile is authoritative).
    """
    if isinstance(raw, str):
        item = {"value": raw, "verbatim": "", "confidence": "low"}
    elif isinstance(raw, dict):
        item = {
            "value": raw.get("value") or raw.get("text") or "",
            "verbatim": raw.get("verbatim") or "",
            "confidence": _coerce_conf(raw.get("confidence")),
        }
    else:
        return None
    if not str(item["value"]).strip():
        return None
    item["value"] = str(item["value"]).strip()
    item["verbatim"] = str(item["verbatim"] or "")
    if source_tiles is not None:
        item["source_tiles"] = list(source_tiles)
    else:
        st = raw.get("source_tiles") if isinstance(raw, dict) else None
        item["source_tiles"] = list(st) if isinstance(st, list) else []
    return item


def merge_items(items: list[dict]) -> list[dict]:
    """Merge a flat list of items: dedup by normalized value, accumulate
    ``source_tiles``, keep the highest confidence, prefer a non-empty verbatim.
    Insertion order of first appearance is preserved."""
    by_norm: dict[str, dict] = {}
    order: list[str] = []
    for raw in items:
        it = coerce_item(raw)
        if it is None:
            continue
        key = normalize_value(it["value"])
        if not key:
            continue
        if key not in by_norm:
            by_norm[key] = {
                "value": it["value"],
                "verbatim": it["verbatim"],
                "confidence": it["confidence"],
                "source_tiles": list(it["source_tiles"]),
            }
            order.append(key)
        else:
            cur = by_norm[key]
            for st in it["source_tiles"]:
                if st not in cur["source_tiles"]:
                    cur["source_tiles"].append(st)
            if _CONF_ORDER[it["confidence"]] > _CONF_ORDER[cur["confidence"]]:
                cur["confidence"] = it["confidence"]
            if not cur["verbatim"] and it["verbatim"]:
                cur["verbatim"] = it["verbatim"]
    return [by_norm[k] for k in order]


def merge_identity(identities: list[dict]) -> dict:
    """Merge per-tile ``product_identity`` dicts.

    ``product_name`` takes the highest-confidence non-empty candidate (first
    wins on ties); ``package_composition`` merges like any list field.
    """
    names: list[dict] = []
    pkg: list[dict] = []
    for ident in identities:
        ident = ident or {}
        pn = coerce_item(ident.get("product_name")) if ident.get("product_name") else None
        if pn:
            names.append(pn)
        pkg.extend(ident.get("package_composition") or [])
    product_name = None
    if names:
        product_name = max(names, key=lambda it: _CONF_ORDER[it["confidence"]])
    return {"product_name": product_name, "package_composition": merge_items(pkg)}


def empty_fields() -> dict:
    """An all-empty ``fields`` block."""
    return {
        "product_identity": {"product_name": None, "package_composition": []},
        **{k: [] for k in LIST_FIELD_KEYS},
    }


def overall_confidence(fields: dict) -> str:
    """Conservative overall confidence: the minimum across all present items
    (``"low"`` when there are no items)."""
    confs: list[str] = []
    pi = fields.get("product_identity") or {}
    if pi.get("product_name"):
        confs.append(_coerce_conf(pi["product_name"].get("confidence")))
    for it in pi.get("package_composition") or []:
        confs.append(_coerce_conf(it.get("confidence")))
    for key in LIST_FIELD_KEYS:
        for it in fields.get(key) or []:
            confs.append(_coerce_conf(it.get("confidence")))
    if not confs:
        return "low"
    return min(confs, key=lambda c: _CONF_ORDER[c])


def build_draft(
    *,
    fields: dict,
    generated_from_tiles: list[str],
    model: str,
    generated_at: str,
    tile_results: list[dict],
    errors: list[dict],
    confidence: str | None = None,
) -> dict:
    """Assemble the top-level ``product_guidance_draft.json`` payload."""
    return {
        "source_type": SOURCE_TYPE,
        "visibility": VISIBILITY,
        "extraction_mode": EXTRACTION_MODE,
        "needs_operator_review": True,
        "generated_at": generated_at,
        "model": model,
        "generated_from_tiles": list(generated_from_tiles),
        "confidence": confidence or overall_confidence(fields),
        "extraction_notes": EXTRACTION_NOTES,
        "fields": fields,
        "tile_results": tile_results,
        "errors": errors,
    }
