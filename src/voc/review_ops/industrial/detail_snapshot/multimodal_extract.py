"""Opt-in multimodal extraction from local detail-image tiles (S2x.3b).

Reads the tiles produced by :mod:`tiling`, asks a vision model to extract ONLY
what is visibly present on each tile, and merges the per-tile findings into a
single ``product_guidance_draft.json`` clearly marked as a draft needing
operator review.

Discipline:
- Multimodal is **opt-in** (``enable_multimodal=True``) AND requires a key; with
  no key the run fails soft and writes no draft.
- The OpenAI client is imported lazily inside the default tile extractor (house
  pattern, mirrors ``rag.py`` / ``issue_discovery.py``); tests inject a mock
  ``tile_extractor`` and never touch OpenAI or the network.
- No OCR, no ProductKnowledge, no Notion/Streamlit/store/review-analysis.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Callable

from src.voc.review_ops.industrial.detail_snapshot import guidance_schema as gs
from src.voc.review_ops.industrial.rag import resolve_api_key

DEFAULT_VISION_MODEL = "gpt-4o"

# System contract for the vision model: visible-only, no general knowledge.
SYSTEM_PROMPT = (
    "당신은 상품 상세페이지 이미지에서 정보를 추출하는 보조 도구입니다. "
    "이미지에 실제로 보이는 텍스트/그림에 근거한 내용만 추출하세요. "
    "일반 지식이나 추측으로 제품 사실을 만들지 마세요. "
    "보이지 않으면 해당 항목은 비워 두세요(빈 배열 또는 null). "
    "가능하면 이미지에 적힌 원문을 verbatim에 담고, 각 항목에 confidence를 "
    "(low|medium|high) 표기하세요. 불확실하면 low로 표기하세요. "
    "출력은 한국어 JSON 객체로만 반환하세요."
)

# JSON shape the model must return per tile (mirrors guidance_schema fields).
USER_PROMPT = (
    "이 이미지 타일에서 다음 키를 가진 JSON 객체를 반환하세요. 각 리스트의 "
    "원소는 {\"value\": 한국어 요약, \"verbatim\": 이미지 원문(없으면 \"\"), "
    "\"confidence\": \"low|medium|high\"} 형태입니다.\n"
    "{\n"
    '  "product_identity": {"product_name": item|null, "package_composition": [item]},\n'
    '  "usage_installation": [item],   // 설치 단계/부착 전 준비/표면 청소·먼지·기름 제거/부착 순서\n'
    '  "surface_adhesion": [item],     // 실크벽지/거친 벽면/습기/페인트면/부착면 조건/양면테이프/피스 고정\n'
    '  "cutting_handling": [item],     // 절단 도구/절단 방법/깨짐 방지 주의\n'
    '  "included_components": [item],  // 본체/마감캡/곡선엘보우/연결캡/피스/양면테이프/기타 구성품\n'
    '  "size_spec": [item],            // 길이/폭/호수/규격/색상/수량\n'
    '  "warnings_faq": [item]          // 설치 전 주의/사용 제한 조건/자주 묻는 질문 후보\n'
    "}\n"
    "보이지 않는 항목은 빈 배열 또는 null로 두세요."
)


def vision_model() -> str:
    """Vision model: ``OPENAI_VISION_MODEL`` env override, else ``gpt-4o``."""
    return os.getenv("OPENAI_VISION_MODEL") or DEFAULT_VISION_MODEL


def _default_tile_extractor(tile_path: Path, *, model: str, api_key: str) -> dict:
    """Live per-tile vision call. Only used when no mock extractor is injected.

    Lazy-imports OpenAI (house pattern). Returns the parsed per-tile JSON dict.
    Not exercised by tests.
    """
    import base64

    from openai import OpenAI

    data = Path(tile_path).read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:image/jpeg;base64,{b64}"
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": USER_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    )
    return json.loads(resp.choices[0].message.content)


def _normalize_tile_fields(raw: dict, tile_name: str) -> dict:
    """Coerce one tile's raw model output into canonical fields, stamping the
    real tile name as ``source_tiles`` on every item."""
    raw = raw or {}
    out = gs.empty_fields()

    ident = raw.get("product_identity") or {}
    pn = ident.get("product_name")
    if pn:
        out["product_identity"]["product_name"] = gs.coerce_item(pn, source_tiles=[tile_name])
    pkg = []
    for it in ident.get("package_composition") or []:
        ci = gs.coerce_item(it, source_tiles=[tile_name])
        if ci:
            pkg.append(ci)
    out["product_identity"]["package_composition"] = pkg

    for key in gs.LIST_FIELD_KEYS:
        items = []
        for it in raw.get(key) or []:
            ci = gs.coerce_item(it, source_tiles=[tile_name])
            if ci:
                items.append(ci)
        out[key] = items
    return out


def _result(status: str, reason: str, snapshot_dir: Path, draft_path: Path | None = None) -> dict:
    return {
        "status": status,
        "reason": reason,
        "snapshot_dir": str(snapshot_dir),
        "draft_path": str(draft_path) if draft_path else None,
    }


def extract_guidance(
    snapshot_dir: str | Path,
    *,
    enable_multimodal: bool = False,
    api_key: str | None = None,
    model: str | None = None,
    tile_extractor: Callable[..., dict] | None = None,
    now: datetime | None = None,
) -> dict:
    """Extract a guidance draft from an existing snapshot's tiles.

    Opt-in: returns ``status="skipped"`` unless ``enable_multimodal`` is True.
    Requires ``tiles_manifest.json`` (run ``--make-tiles`` first) and — when
    using the live extractor — a resolvable API key (else ``skipped_no_key``,
    no draft). A mock ``tile_extractor`` bypasses the key gate so tests never
    call OpenAI. Writes ``product_guidance_draft.json`` when ≥1 tile succeeds.
    """
    d = Path(snapshot_dir)
    generated_at = (now or datetime.now()).isoformat(timespec="seconds")

    if not enable_multimodal:
        return _result("skipped", "멀티모달이 활성화되지 않았습니다(--enable-multimodal).", d)
    if not d.exists() or not d.is_dir():
        return _result("error", "snapshot_dir를 찾을 수 없습니다.", d)

    tiles_manifest_path = d / "tiles_manifest.json"
    if not tiles_manifest_path.exists():
        return _result(
            "error", "tiles_manifest.json이 없습니다. 먼저 --make-tiles 로 타일을 생성하세요.", d
        )
    try:
        tiles_manifest = json.loads(tiles_manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return _result("error", f"tiles_manifest.json 파싱 실패: {exc}", d)

    tile_rows = tiles_manifest.get("tiles") or []
    if not tile_rows:
        return _result("error", "타일이 없습니다. 먼저 --make-tiles 로 타일을 생성하세요.", d)

    resolved_model = model or vision_model()

    # Key gate applies only to the live extractor; an injected one self-authenticates.
    if tile_extractor is None:
        api_key = api_key or resolve_api_key()
        if not api_key:
            return _result(
                "skipped_no_key",
                "OPENAI_API_KEY가 없어 멀티모달 추출을 건너뜁니다. 초안을 생성하지 않습니다.",
                d,
            )

        def _live(path: Path, *, model: str) -> dict:
            return _default_tile_extractor(path, model=model, api_key=api_key)

        tile_extractor = _live

    tiles_dir = d / "tiles"
    identities: list[dict] = []
    per_field: dict[str, list] = {k: [] for k in gs.LIST_FIELD_KEYS}
    tile_results: list[dict] = []
    errors: list[dict] = []
    used_tiles: list[str] = []
    success = 0

    for row in tile_rows:
        name = row.get("local_filename")
        if not name:
            continue
        path = tiles_dir / name
        try:
            raw = tile_extractor(path, model=resolved_model)
            tf = _normalize_tile_fields(raw, name)
            identities.append(tf["product_identity"])
            for key in gs.LIST_FIELD_KEYS:
                per_field[key].extend(tf[key])
            tile_results.append({"tile": name, "ok": True})
            used_tiles.append(name)
            success += 1
        except Exception as exc:  # fail-soft per tile
            errors.append({"tile": name, "error": str(exc)})
            tile_results.append({"tile": name, "ok": False, "error": str(exc)})

    if success == 0:
        return _result(
            "error",
            "모든 타일 추출에 실패했습니다. 초안을 생성하지 않습니다.",
            d,
        )

    fields = {"product_identity": gs.merge_identity(identities)}
    for key in gs.LIST_FIELD_KEYS:
        fields[key] = gs.merge_items(per_field[key])

    draft = gs.build_draft(
        fields=fields,
        generated_from_tiles=used_tiles,
        model=resolved_model,
        generated_at=generated_at,
        tile_results=tile_results,
        errors=errors,
    )
    draft_path = d / "product_guidance_draft.json"
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")

    status = "partial" if errors else "ok"
    return {
        "status": status,
        "reason": "",
        "snapshot_dir": str(d),
        "draft_path": str(draft_path),
        "tile_count": len(tile_rows),
        "success_count": success,
        "confidence": draft["confidence"],
    }
