#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

QUEUE_PATH="${BRAND20_QUEUE_PATH:-ops/brand20_collection_queue.json}"

set +e
PICKED="$(PYTHONPATH=. python3 scripts/pick_next_brand20_target.py --queue "${QUEUE_PATH}" --shell)"
pick_rc=$?
set -e
if [[ "${pick_rc}" -ne 0 ]]; then
  if [[ "${pick_rc}" -eq 2 ]]; then
    echo "No runnable Brand-20 target found in ${QUEUE_PATH}." >&2
    exit 2
  fi
  echo "Failed to pick next Brand-20 target from ${QUEUE_PATH}." >&2
  exit "${pick_rc}"
fi

read -r GOODS_NO SORT_TYPE <<< "${PICKED}"
echo "Selected Brand-20 target: ${GOODS_NO} ${SORT_TYPE}"

set +e
PYTHONPATH=. python3 scripts/run_brand20_queue_runner.py \
  --goods-no "${GOODS_NO}" \
  --sort-type "${SORT_TYPE}" \
  --allow-open-tab \
  --i-authorize-live-collection \
  --max-items-per-session 1
runner_rc=$?
set -e

echo
echo "Queue status after run:"
PYTHONPATH=. python3 scripts/inspect_brand20_collection_status.py --queue "${QUEUE_PATH}"

exit "${runner_rc}"
