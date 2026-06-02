#!/usr/bin/env bash
# Canonical Phase 1 signal-quality eval. Single source of truth for scope.
# Any flag drift here is a spec change and MUST be reflected in
# eval_data/phase1/baseline.md in the same commit.
#
# Usage:
#   scripts/eval_phase1_baseline.sh                 # markdown report
#   scripts/eval_phase1_baseline.sh --emit-json     # JSON report
#
# Canonical scope:
#   - product IDs: all products with at least one labeled row (8 today)
#   - --reviewed-only: excludes draft labels so the baseline is stable
#     across curator in-flight edits. Draft rows become part of the
#     unlabeled universe (i.e. their rows can still count as FP) until
#     promoted to reviewed.
#   - golden:     eval_data/phase1/phase1_signals_golden.json
#   - signal_map: eval_data/phase1/phase1_signal_map.json
#   - lexicons:   data/phase1_lexicons/{positive,cautionary}.json
#
# See eval_data/phase1/baseline.md for the latest frozen numbers and the
# canonical-vs-historical scope note.

set -euo pipefail
cd "$(dirname "$0")/.."

PRODUCT_IDS=(
  6870288119
  7156638510
  7287282252
  7683282996
  8801742659
  9182625401
  9205394095
  A000000238828
)

ARGS=()
for p in "${PRODUCT_IDS[@]}"; do
  ARGS+=(--product-id "$p")
done

exec python3 scripts/score_phase1_signals.py \
  "${ARGS[@]}" \
  --reviewed-only \
  "$@"
