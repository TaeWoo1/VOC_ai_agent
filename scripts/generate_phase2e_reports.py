"""Generate Phase 2E manufacturer-facing reports for the 3 anchor products.

Two source modes:
  --source seed    : use seed_v0.2 (human-annotated; the "ideal" report)
  --source pipeline: use /tmp/phase2e_e2e_eval_results.json (actual E2E
                     pipeline output from the latest eval)

Default: pipeline. Both modes share the same renderer
(`src/voc/reporting/phase2e/report.py`) so output structure is identical.

Outputs to docs/phase2e_report_{product_short_name}.md.

NO pipeline operations, NO DB access, NO LLM calls.
"""
from __future__ import annotations
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.reporting.phase2e.report import (  # noqa: E402
    aggregate_product,
    render_markdown,
)

SEED_PATH = REPO / "eval_data/phase2e/seed_v0.2.json"
PIPELINE_OUT = Path("/tmp/phase2e_e2e_eval_results.json")

PRODUCT_FILENAME_MAP = {
    "A000000152396": "phase2e_report_3CE.md",
    "A000000213429": "phase2e_report_alternative_stereo.md",
    "A000000131581": "phase2e_report_holika_holika.md",
}


def sample_id(r: dict) -> str:
    return r.get("sample_key") or r.get("calib_id") or r["review_id"]


def load_from_seed() -> dict:
    """Build {product_id: {product_name, reviews}} from seed_v0.2."""
    seed = json.load(open(SEED_PATH))
    by_product: dict[str, dict] = {}
    by_review: dict[str, dict] = {}

    for r in seed["records"]:
        sid = sample_id(r)
        rid = r["review_id"]
        pid = r["product_id"]
        if pid not in by_product:
            by_product[pid] = {
                "product_id": pid,
                "product_name": r["product_name"],
                "reviews": {},
            }
        if rid not in by_product[pid]["reviews"]:
            by_product[pid]["reviews"][rid] = {
                "review_id": rid,
                "sample_id": sid,
                "mixed_review_flag": r.get("mixed_review_flag", False),
                "tradeoff_pair": r.get("tradeoff_pair"),
                "records": [],
            }
        by_product[pid]["reviews"][rid]["records"].append({
            "attribute": r["attribute"],
            "polarity": r["polarity"],
            "intensity": r["intensity"],
            "evidence_span": r.get("evidence_span", ""),
            "confidence": r.get("confidence", "medium"),
            "delivery_condition_flag": r.get("delivery_condition_flag", False),
        })

    # Convert reviews dict to list
    for pid, info in by_product.items():
        info["reviews"] = list(info["reviews"].values())
    return by_product


def load_from_pipeline() -> dict:
    """Build product groups from the cached E2E eval results."""
    if not PIPELINE_OUT.exists():
        raise FileNotFoundError(
            f"{PIPELINE_OUT} not found. Run scripts/eval_phase2e_e2e.py first."
        )
    eval_data = json.load(open(PIPELINE_OUT))
    by_product: dict[str, dict] = {}
    for rev in eval_data["review_results"]:
        # The eval_results store per_record_detail (Stage 1 + Stage 2 outputs)
        pid = None
        # Recover product_id by looking at sample_id prefix or join to seed
        # Easier: use product_name to derive product_id
        if "Holika" in rev["product_name"]:
            pid = "A000000131581"
        elif "3CE" in rev["product_name"]:
            pid = "A000000152396"
        elif "Alternative" in rev["product_name"]:
            pid = "A000000213429"
        else:
            continue
        if pid not in by_product:
            by_product[pid] = {
                "product_id": pid,
                "product_name": rev["product_name"],
                "reviews": [],
            }
        # Build records from per_record_detail (Stage 2 outputs)
        records = []
        for det in rev.get("per_record_detail", []):
            if det.get("stage2_drop"):
                continue
            if det.get("stage2_polarity") is None:
                continue
            records.append({
                "attribute": det["attribute"],
                "polarity": det["stage2_polarity"],
                "intensity": det.get("stage2_intensity"),
                "evidence_span": det.get("clause", "")[:80],
                "confidence": det.get("stage2_confidence", "medium"),
                "delivery_condition_flag": False,  # Stage 2 doesn't emit this in current cache
            })
        # mixed_review_flag and tradeoff_pair come from Stage 3 results in the eval
        by_product[pid]["reviews"].append({
            "review_id": rev["sample_id"],
            "sample_id": rev["sample_id"],
            "mixed_review_flag": rev.get("pred_mixed_flag", False),
            "tradeoff_pair": rev.get("pred_tradeoff_pair"),
            "records": records,
        })
    return by_product


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["seed", "pipeline"], default="pipeline")
    ap.add_argument("--out-dir", default=str(REPO / "docs"))
    args = ap.parse_args()

    if args.source == "seed":
        by_product = load_from_seed()
        source_label = "human-annotated seed v0.2 (40 samples; the 'ideal' baseline)"
    else:
        by_product = load_from_pipeline()
        source_label = "Phase 2E pipeline E2E output (Stage 1 + Stage 2 + Stage 3)"

    out_dir = Path(args.out_dir)
    out_dir.mkdir(exist_ok=True)

    print(f"Generating reports from source: {args.source}")
    print(f"Products: {len(by_product)}")
    print()

    for pid, info in sorted(by_product.items()):
        data = aggregate_product(
            product_id=info["product_id"],
            product_name=info["product_name"],
            reviews=info["reviews"],
        )
        md = render_markdown(data, source_label=source_label)

        # Suffix with source for differentiation
        base = PRODUCT_FILENAME_MAP.get(pid, f"phase2e_report_{pid}.md")
        if args.source == "seed":
            base = base.replace(".md", "_seed.md")
        else:
            base = base.replace(".md", "_pipeline.md")
        out_path = out_dir / base
        out_path.write_text(md)
        print(f"  ✓ {info['product_name']} → {out_path.name} ({len(md)} bytes, {data.n_reviews} reviews, {data.n_records} records)")


if __name__ == "__main__":
    main()
