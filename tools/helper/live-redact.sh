#!/usr/bin/env bash
#
# **A stdin filter for live-harness output, so a store identity cannot reach a transcript by accident.**
#
# The rule this serves is the product owner's: the raw 업체코드 travels from the helper to the paired
# seller browser over authenticated loopback and nowhere else. The helper obeys it — its log line carries
# `"bootstrap":"CANDIDATE"`, the state and not the value — but the HARNESS around a live sitting does not
# automatically: on 2026-09-13 the code appeared in my own stdout, from a command I ran, after I had said
# it would not.
#
# So every harness command whose output I read goes through this. It is a discipline, not a privacy
# control: it masks a SHAPE, and a shape can be wrong in both directions. It is here because the thing it
# guards against is me pasting a value I did not mean to, and a filter is the only part of that loop that
# does not forget.
#
#   some-command | tools/helper/live-redact.sh [--mask <literal>]...
#
# Masks:
#   - the Coupang 업체코드 shape (A + 8 or more digits)
#   - any literal named with --mask (use it for a value already known to the sitting)
set -euo pipefail

MASKS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --mask) MASKS+=("${2:-}"); shift 2;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

# The shape first, then the named literals — a literal that is also the shape is already masked, and
# masking it twice is harmless.
sed -E 's/A[0-9]{8,}/A********/g' | {
  if [ ${#MASKS[@]} -eq 0 ]; then
    cat
  else
    ARGS=()
    for m in "${MASKS[@]}"; do
      [ -n "$m" ] || continue
      # Escape the literal for sed; the values this is used on are ids, but a rule that only works on
      # well-behaved input is a rule that fails on the day it matters.
      esc="$(printf '%s' "$m" | sed -e 's/[][\.*^$\/&]/\\&/g')"
      ARGS+=(-e "s/$esc/[redacted]/g")
    done
    if [ ${#ARGS[@]} -eq 0 ]; then cat; else sed "${ARGS[@]}"; fi
  fi
}
