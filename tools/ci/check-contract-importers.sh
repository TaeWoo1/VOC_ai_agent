#!/usr/bin/env bash
# Guards the Collector CI path filter against going stale.
#
# The workflow only runs when certain paths change. That is exactly what makes it fast AND exactly what
# makes it fragile: the day someone imports the shared contract from a frontend file outside the filtered
# paths, the boundary stops being checked and NOTHING says so. The failure mode is silence — a green PR that
# never ran the check — which is worse than a red one.
#
# So this asserts the two facts the filter depends on:
#   1. every frontend file importing `contracts/action-window` lives under a filtered path;
#   2. the schemas and fixtures the contract conformance tests read are actually present (a .gitignore or
#      move that dropped them would otherwise turn 123 assertions into a silent 0).
#
# Run locally exactly as CI does:  bash tools/ci/check-contract-importers.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO}"
FAILS=0

# Keep in lockstep with the `paths:` filter in .github/workflows/collector-ci.yml.
FILTERED_PREFIXES=(
  "frontend/src/lib/"
  "frontend/src/components/actionWindow/"
  "frontend/src/components/bridge/"
  # Added 2026-07-26: the review-import cards compose the guidance pack the runtime renders inside the
  # marketplace page, so they consume the shared contract directly.
  "frontend/src/components/reviewImport/"
  # Added 2026-08-05: the guided-connection walkthrough (NAVER issuance) renders from the shared Action
  # Window run view, so it imports the contract directly and must be a filtered path too.
  "frontend/src/components/guidedConnection/"
  # Added 2026-08-16: 상품평 is a page, not a component — `[쿠팡에서 보기]` on ChannelReviews renders from the
  # shared run view. This guard has been failing on main since that page merged, which is the guard working:
  # the boundary went unchecked and it said so rather than going quiet.
  "frontend/src/pages/app/"
)

echo "== every frontend contract importer must sit under a filtered path =="
IMPORTERS="$(grep -rl "contracts/action-window" frontend/src 2>/dev/null | sort || true)"
if [ -z "${IMPORTERS}" ]; then
  # Not "fine": the frontend is supposed to consume the shared contract. Zero importers means either the
  # grep target moved or the consumption was refactored away — both need a human to look.
  echo "  [FAIL] no frontend file imports contracts/action-window — has the contract import path changed?"
  FAILS=$((FAILS + 1))
fi
while IFS= read -r file; do
  [ -z "${file}" ] && continue
  covered=0
  for prefix in "${FILTERED_PREFIXES[@]}"; do
    case "${file}" in "${prefix}"*) covered=1; break;; esac
  done
  if [ "${covered}" = "1" ]; then
    echo "  [ok]   ${file}"
  else
    echo "  [FAIL] ${file} imports the shared contract but is NOT under any Collector CI filtered path."
    echo "         Add its directory to BOTH .github/workflows/collector-ci.yml paths: and FILTERED_PREFIXES here."
    FAILS=$((FAILS + 1))
  fi
done <<< "${IMPORTERS}"

echo "== contract schemas + fixtures the conformance tests read must be present =="
for schema in contracts/action-window/v1/schema.json contracts/action-window/v2/schema.json; do
  if [ -f "${REPO}/${schema}" ]; then echo "  [ok]   ${schema}"; else echo "  [FAIL] missing ${schema}"; FAILS=$((FAILS + 1)); fi
done
for dir in contracts/action-window/v1/fixtures contracts/action-window/v2/fixtures; do
  count="$(find "${REPO}/${dir}" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  # The conformance suites are fixture-DRIVEN (it.each over the directory), so an empty directory does not
  # fail them — it silently reduces them to nothing. A floor is the only way that shows up as a failure.
  if [ "${count}" -ge 10 ] 2>/dev/null; then
    echo "  [ok]   ${dir} (${count} fixtures)"
  else
    echo "  [FAIL] ${dir} has ${count} fixtures — a fixture-driven suite would silently assert nothing"
    FAILS=$((FAILS + 1))
  fi
done

echo
if [ "${FAILS}" -eq 0 ]; then echo "== path-filter + fixture guards OK =="; else echo "== ${FAILS} guard failure(s) =="; fi
exit "${FAILS}"
