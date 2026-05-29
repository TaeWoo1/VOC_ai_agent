"""CSV ingest for the industrial review-ops pilot.

Reads an uploaded reviews CSV into a list of canonical-keyed dict rows. Header
matching is tolerant: Korean and English column names are both accepted (an
operator export from 네이버/쿠팡/자사몰 will not have uniform headers).

CSV only — no Excel in this slice.
"""

from __future__ import annotations

import csv
from pathlib import Path

# canonical field -> accepted header names (compared lowercased + stripped)
COLUMN_ALIASES: dict[str, set[str]] = {
    "channel": {"channel", "marketplace", "mall", "채널", "판매처", "쇼핑몰", "마켓"},
    "product_name": {"product", "product_name", "item", "상품명", "제품명", "상품", "품명"},
    "option_name": {"option", "option_name", "variant", "옵션", "옵션명", "선택옵션"},
    "rating": {"rating", "score", "star", "stars", "평점", "별점", "점수"},
    "date": {"date", "review_date", "created_at", "작성일", "날짜", "등록일", "리뷰일"},
    "author": {"author", "name", "user", "작성자", "구매자", "닉네임", "이름"},
    "text": {
        "review", "text", "body", "content", "comment", "리뷰", "내용",
        "리뷰내용", "후기", "본문",
    },
    "reply": {"reply", "answer", "response", "has_reply", "답글", "답변", "사장님답글", "판매자답변"},
    "source_id": {"id", "source_id", "review_id", "리뷰id", "번호", "no"},
}


def _build_header_map(fieldnames: list[str]) -> dict[str, str]:
    """Map raw CSV headers to canonical field names. First match wins."""
    header_map: dict[str, str] = {}
    for raw in fieldnames:
        key = (raw or "").strip().lower()
        for canon, aliases in COLUMN_ALIASES.items():
            if key in aliases and canon not in header_map.values():
                header_map[raw] = canon
                break
    return header_map


def load_csv(path: str | Path) -> list[dict[str, str]]:
    """Read a reviews CSV into canonical-keyed dict rows.

    Rows with empty/whitespace-only review text are skipped. Raises ValueError
    if no column maps to the required ``text`` field.
    """
    path = Path(path)
    rows: list[dict[str, str]] = []

    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        header_map = _build_header_map(reader.fieldnames or [])

        if "text" not in header_map.values():
            raise ValueError(
                f"CSV '{path}' has no review-text column "
                f"(expected one of: {sorted(COLUMN_ALIASES['text'])})"
            )

        for raw_row in reader:
            canon_row: dict[str, str] = {}
            for raw_key, value in raw_row.items():
                canon = header_map.get(raw_key)
                if canon:
                    canon_row[canon] = (value or "").strip()
            if canon_row.get("text"):
                rows.append(canon_row)

    return rows
