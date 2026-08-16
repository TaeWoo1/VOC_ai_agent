#!/usr/bin/env bash
# Guards the Collector CI path filter against going stale.
#
# The workflow only runs when certain paths change. That is exactly what makes it fast AND exactly what
# makes it fragile: the day someone imports the shared contract from a frontend file outside the filtered
# paths, the boundary stops being checked and NOTHING says so. The failure mode is silence — a green PR that
# never ran the check — which is worse than a red one.
#
# So this asserts the four facts the filter depends on:
#   1. every frontend file importing `contracts/action-window` lives under a filtered path;
#   2. the workflow's own two `paths:` lists (pull_request and push) are identical;
#   3. the workflow's frontend paths and FILTERED_PREFIXES below name the same directories;
#   4. the schemas and fixtures the contract conformance tests read are actually present (a .gitignore or
#      move that dropped them would otherwise turn 123 assertions into a silent 0).
#
# 2 and 3 exist because 1 cannot see them. The coverage check reads only THIS file's list, so a
# directory added here and not to the workflow passes every assertion while the workflow keeps skipping
# it — the guard would be satisfied by a filter that does not exist. And a directory added to
# `pull_request` alone gives a green PR and an unchecked main. Both are the same failure as a stale
# filter, arriving from the other side.
#
# Run locally exactly as CI does:  bash tools/ci/check-contract-importers.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO}"
FAILS=0

WORKFLOW=".github/workflows/collector-ci.yml"

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

# Reads one trigger's `paths:` entries out of the workflow, in order. Deliberately a small awk rather
# than a YAML parser: this step runs before `npm ci`, so it may use nothing that is not already on a
# bare runner. It relies on the file's fixed shape — a trigger at two spaces, its entries at six — so a
# reformat that breaks the shape empties the list and trips the guard below rather than passing quietly.
workflow_paths() {
  awk -v want="$1" '
    /^  [a-z_]+:[[:space:]]*$/ {
      key = $0; sub(/^  /, "", key); sub(/:.*$/, "", key)
      want_here = (key == want); in_paths = 0; next
    }
    /^[^[:space:]]/ { want_here = 0; in_paths = 0 }
    # Only entries under this trigger`s own paths: key. Keyed rather than "any list item under the
    # trigger" so a sibling list (types:, branches:) can never be counted as a path filter, and so a
    # DELETED paths: block reads as an empty list — which the caller treats as a failure, not a pass.
    want_here && /^    [a-z_]+:/ { in_paths = ($0 ~ /^    paths:[[:space:]]*$/); next }
    want_here && in_paths && /^      - / {
      entry = $0; sub(/^      - /, "", entry); gsub(/^'\''|'\''$/, "", entry); print entry
    }
  ' "${WORKFLOW}"
}

echo "== the workflow's two paths: lists must be identical =="
PR_PATHS="$(workflow_paths pull_request)"
PUSH_PATHS="$(workflow_paths push)"
if [ -z "${PR_PATHS}" ] || [ -z "${PUSH_PATHS}" ]; then
  # Not "the filter is gone, so everything runs". It means this guard can no longer verify anything,
  # and a guard that cannot see its subject must say so rather than pass.
  echo "  [FAIL] could not read pull_request and/or push paths: from ${WORKFLOW}."
  echo "         If the path filters were removed deliberately, remove these two checks with them."
  FAILS=$((FAILS + 1))
elif [ "${PR_PATHS}" = "${PUSH_PATHS}" ]; then
  echo "  [ok]   pull_request and push filter the same $(printf '%s\n' "${PR_PATHS}" | wc -l | tr -d ' ') paths"
else
  echo "  [FAIL] pull_request and push paths: differ — a PR would be checked and main would not (or vice versa)."
  diff <(printf '%s\n' "${PR_PATHS}") <(printf '%s\n' "${PUSH_PATHS}") | sed 's/^/         /'
  FAILS=$((FAILS + 1))
fi

echo "== the workflow's frontend paths and FILTERED_PREFIXES must name the same directories =="
# `frontend/src/lib/**` and `frontend/src/lib/` are the same directory written two ways; normalise the
# workflow's glob to this file's prefix form. Anything else under frontend/ is refused rather than
# guessed at — a narrower glob would silently mean something this comparison cannot express.
WORKFLOW_FE=""
while IFS= read -r entry; do
  case "${entry}" in
    frontend/*) ;;
    *) continue;;
  esac
  case "${entry}" in
    */\*\*) WORKFLOW_FE="${WORKFLOW_FE}${entry%\*\*}"$'\n';;
    *)
      echo "  [FAIL] ${entry} is a frontend path this guard cannot compare — write it as '<dir>/**'."
      FAILS=$((FAILS + 1));;
  esac
done <<< "${PR_PATHS}"
SCRIPT_FE="$(printf '%s\n' "${FILTERED_PREFIXES[@]}" | sort)"
WORKFLOW_FE="$(printf '%s' "${WORKFLOW_FE}" | sort)"
if [ "${WORKFLOW_FE}" = "${SCRIPT_FE}" ]; then
  echo "  [ok]   both lists name $(printf '%s\n' "${SCRIPT_FE}" | wc -l | tr -d ' ') frontend directories"
else
  echo "  [FAIL] the workflow's frontend paths and FILTERED_PREFIXES have drifted apart."
  echo "         '<' = only in ${WORKFLOW}; '>' = only in FILTERED_PREFIXES. Add it to BOTH."
  diff <(printf '%s\n' "${WORKFLOW_FE}") <(printf '%s\n' "${SCRIPT_FE}") | sed 's/^/         /'
  FAILS=$((FAILS + 1))
fi

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
