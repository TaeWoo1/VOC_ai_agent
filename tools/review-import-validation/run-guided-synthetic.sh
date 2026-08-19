#!/usr/bin/env bash
# NAVER Initial Review Import (V1) — GUIDED-ORCHESTRATION proof (no live contact, no NAVER, no Chrome).
#
# The sibling of run-synthetic.sh. That script proves the segment mechanics through the MANUAL path (the
# fallback). This one proves the PRODUCT path: one seller click authorizes one guided Action Window run, and
# the run's download is ingested into the segment its ticket is bound to — no file picking, no operator
# typing a period.
#
# It drives the REAL launch APIs on a fresh disposable backend, standing in for the local-agent runtime
# (which is the only piece a live run adds: opening Chrome and guiding the seller). Proven here:
#   * DISCOVERY FIRST — a discovery ticket is issued with NO plan, because the plan is built from whatever
#     range the marketplace turns out to allow;
#   * IDENTITY-FREE RESOLVE — what the runtime is told carries no plan/segment/account id;
#   * PLAN FROM THE DISCOVERED RANGE — recording the range creates the plan + calendar-month segments;
#   * SINGLE USE — a spent ticket cannot be replayed, in either direction (discovery or ingest);
#   * AUTOMATIC SEGMENT INGEST — the file lands in the bound segment (COMPLETED + COVERED), attempt linked
#     to its own sync job;
#   * EVIDENCE IS RECORDED, NOT ASSUMED — an OPERATOR_CONFIRMED run is stored as that, never upgraded to a
#     machine match;
#   * RE-CLICK IDEMPOTENCY — asking twice for the same segment returns the SAME authorization, so one
#     segment can never be driven by two concurrent runs;
#   * OVERLAP-SAFE DEDUP on the guided path too (same export into the next segment ⇒ 0 new);
#   * RESUME — after an interruption the next remaining segment is the one offered;
#   * COVERAGE + HEALTH + MISSING, ending with the plan COMPLETED,
# then a guarded teardown leaving no persistent test data.
#
#   bash tools/review-import-validation/run-guided-synthetic.sh
#
# Requires: local Postgres, JDK/Gradle (backend), node, curl.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT=18083                                     # distinct from run-synthetic.sh so both can run back-to-back
STAMP="$(date -u +%Y%m%dT%H%M%S)"
RUNDB="sellerops_riv_guided_${STAMP}"          # sellerops_riv_* prefix → the name guard permits dropping it
GOLDEN="${REPO}/contracts/review-export/naver/v1/naver-review-export-v1.xlsx"
WORK="$(mktemp -d)"
BASE="http://127.0.0.1:${PORT}"
FAILS=0

pass() { echo "  [PASS] $1"; }
fail() { echo "  [FAIL] $1"; FAILS=$((FAILS + 1)); }
jq_field() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);let v=o;for(const k of process.argv[1].split("."))v=Array.isArray(v)?v[Number(k)]:v[k];process.stdout.write(v==null?"":String(v))}catch(e){process.stdout.write("")}})' "$1"; }

guarded_dropdb() { case "$1" in sellerops_riv_*) dropdb --if-exists "$1" >/dev/null 2>&1 && echo "  dropped $1";; *) echo "  REFUSED (no sellerops_riv_ prefix): $1"; return 1;; esac; }

BACKEND_PID=""
cleanup() {
  echo "== guarded teardown =="
  [ -n "${BACKEND_PID}" ] && kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  lsof -ti "tcp:${PORT}" 2>/dev/null | xargs -r kill >/dev/null 2>&1 || true
  guarded_dropdb "${RUNDB}" || true
  echo "  surviving sellerops* DBs: $(psql -lqt | cut -d'|' -f1 | grep -i sellerops | tr -d ' ' | tr '\n' ' ')"
  rm -rf "${WORK}"
  echo "  scratch removed (no persistent test data)"
}
trap cleanup EXIT

echo "== name-guard falsification (must refuse the persistent DBs) =="
guarded_dropdb sellerops || echo "  sellerops correctly refused"

[ -f "${GOLDEN}" ] || { echo "golden fixture missing: ${GOLDEN}"; exit 1; }

echo "== fresh disposable backend on ${PORT} =="
createdb "${RUNDB}"; echo "  created ${RUNDB}"
( cd "${REPO}/backend" && SERVER_PORT="${PORT}" SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5432/${RUNDB}" ./gradlew bootRun --console=plain >"${WORK}/backend.log" 2>&1 ) &
BACKEND_PID=$!
printf "  booting"; UP=""
for i in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/channels" 2>/dev/null)" || code="000"
  if [ "${code}" != "000" ]; then echo " up (HTTP ${code})"; UP=1; break; fi
  printf "."; sleep 5
done
[ -n "${UP}" ] || { echo " backend did not come up"; tail -30 "${WORK}/backend.log"; exit 1; }

echo "== org + NAVER file-channel account =="
EMAIL="rivg-${STAMP}@riv.local"; PASS="rivg-$(openssl rand -hex 12)"
curl -s -o /dev/null -X POST "${BASE}/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"name\":\"RIVG\",\"orgName\":\"RIV Guided Disposable Org\",\"termsAccepted\":true}"
TOKEN="$(curl -s -X POST "${BASE}/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}" | jq_field token)"
AUTH="Authorization: Bearer ${TOKEN}"
NAVER_CH="$(curl -s "${BASE}/api/channels" -H "${AUTH}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);const l=Array.isArray(a)?a:(a.content||a.channels||[]);process.stdout.write((l.find(c=>c.code==="NAVER")||{}).id||"")})')"
ACCT="$(curl -s -X POST "${BASE}/api/seller-accounts/file-channel" -H "${AUTH}" -H 'Content-Type: application/json' -d "{\"channelId\":\"${NAVER_CH}\",\"alias\":\"RIV NAVER\"}" | jq_field id)"
[ -n "${TOKEN}" ] && [ -n "${NAVER_CH}" ] && [ -n "${ACCT}" ] && pass "org + NAVER account ready" || { fail "setup"; exit 1; }

# ─────────────────────────── 1. the seller's ONE click ───────────────────────────
echo "== 과거 리뷰 전체 연동하기 → a discovery authorization (no plan yet) =="
DISC="$(curl -s -X POST "${BASE}/api/imports/reviews/launches/discovery?accountId=${ACCT}" -H "${AUTH}")"
DREF="$(echo "${DISC}" | jq_field launchRef)"
DKIND="$(echo "${DISC}" | jq_field kind)"
DPLAN="$(echo "${DISC}" | jq_field planId)"
[ "${DKIND}" = "DISCOVERY" ] && pass "kind DISCOVERY" || fail "kind was '${DKIND}'"
[ -z "${DPLAN}" ] && pass "carries NO plan — the plan is built from what discovery finds" || fail "unexpected planId '${DPLAN}'"
echo "${DREF}" | grep -Eq '^[0-9a-f]{16}$' && pass "ref is an opaque 16-hex the AW wire accepts" || fail "ref shape '${DREF}'"

# Re-clicking must not start a second run against the same account.
DREF2="$(curl -s -X POST "${BASE}/api/imports/reviews/launches/discovery?accountId=${ACCT}" -H "${AUTH}" | jq_field launchRef)"
[ "${DREF}" = "${DREF2}" ] && pass "re-click returns the SAME authorization (no double run)" || fail "re-click minted a second ref"

echo "== what the RUNTIME is told: channel + dates only, no identity =="
SCOPE="$(curl -s "${BASE}/api/imports/reviews/launches/${DREF}/scope" -H "${AUTH}")"
[ "$(echo "${SCOPE}" | jq_field channelCode)" = "naver" ] && pass "channelCode is the semantic code 'naver'" || fail "channelCode was '$(echo "${SCOPE}" | jq_field channelCode)'"
[ -z "$(echo "${SCOPE}" | jq_field requiredStart)" ] && pass "a discovery run is given no dates (finding them is its job)" || fail "discovery scope carried dates"
if echo "${SCOPE}" | grep -qiE '"(planId|segmentId|sellerAccountId|orgId)"'; then fail "resolved scope leaked an identifier to the runtime"; else pass "resolved scope carries no plan/segment/account id"; fi

# ─────────────────────── 2. the plan is built from the found range ───────────────────────
echo "== runtime reports the discovered range → plan + monthly segments =="
PLAN="$(curl -s -X POST "${BASE}/api/imports/reviews/launches/${DREF}/discovered-range" -H "${AUTH}" -H 'Content-Type: application/json' \
  -d '{"availableStart":"2026-01-01","availableEnd":"2026-03-31","evidence":"MACHINE_DISCOVERED"}')"
PLAN_ID="$(echo "${PLAN}" | jq_field plan.id)"
NSEG="$(echo "${PLAN}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).segments.length))}catch(e){process.stdout.write("0")}})')"
[ -n "${PLAN_ID}" ] && pass "plan created from the discovered range" || { fail "no plan created"; echo "${PLAN}"; }
[ "${NSEG}" = "3" ] && pass "3 calendar-month segments" || fail "expected 3 segments, got ${NSEG}"
[ "$(echo "${PLAN}" | jq_field plan.requestedStart)" = "2026-01-01" ] && pass "plan spans the DISCOVERED range, not an operator-typed one" || fail "plan range mismatch"
SEG3="$(echo "${PLAN}" | jq_field segments.2.id)"

echo "== a spent discovery authorization cannot be replayed =="
REPLAY="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/imports/reviews/launches/${DREF}/discovered-range" -H "${AUTH}" -H 'Content-Type: application/json' \
  -d '{"availableStart":"2020-01-01","availableEnd":"2026-03-31","evidence":"MACHINE_DISCOVERED"}')"
[ "${REPLAY}" = "409" ] && pass "replay refused (HTTP 409)" || fail "replay returned HTTP ${REPLAY}"
PLANS_N="$(curl -s "${BASE}/api/imports/reviews/plans?accountId=${ACCT}" -H "${AUTH}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).length))}catch(e){process.stdout.write("?")}})')"
[ "${PLANS_N}" = "1" ] && pass "no second plan was created by the replay" || fail "plan count is ${PLANS_N}"

# ─────────────────────── 3. segment 1: guided run → automatic ingest ───────────────────────
echo "== 계속 가져오기 → authorization for the next remaining segment =="
L1="$(curl -s -X POST "${BASE}/api/imports/reviews/plans/${PLAN_ID}/launches/next-segment" -H "${AUTH}")"
L1REF="$(echo "${L1}" | jq_field launchRef)"
[ "$(echo "${L1}" | jq_field kind)" = "SEGMENT" ] && pass "kind SEGMENT" || fail "kind was '$(echo "${L1}" | jq_field kind)'"
[ "$(echo "${L1}" | jq_field requiredStart)" = "2026-01-01" ] && [ "$(echo "${L1}" | jq_field requiredEnd)" = "2026-01-31" ] \
  && pass "bound to the earliest remaining segment (2026-01-01..01-31)" || fail "bound to the wrong window"
S1SCOPE="$(curl -s "${BASE}/api/imports/reviews/launches/${L1REF}/scope" -H "${AUTH}")"
[ "$(echo "${S1SCOPE}" | jq_field requiredStart)" = "2026-01-01" ] && pass "runtime is told the exact dates to guide to" || fail "segment scope missing dates"

echo "== download detected → ingested into the BOUND segment (no file picking) =="
A1="$(curl -s -X POST "${BASE}/api/imports/reviews/launches/${L1REF}/ingest" -H "${AUTH}" -F "scopeEvidence=MACHINE_MATCHED" -F "file=@${GOLDEN}")"
[ "$(echo "${A1}" | jq_field result)" = "SUCCEEDED" ] && pass "attempt SUCCEEDED" || { fail "attempt was '$(echo "${A1}" | jq_field result)'"; echo "${A1}"; }
A1NEW="$(echo "${A1}" | jq_field rowsNew)"
[ "${A1NEW}" -gt 0 ] 2>/dev/null && pass "rows landed (${A1NEW} new)" || fail "no rows landed"
[ -n "$(echo "${A1}" | jq_field syncJobId)" ] && pass "attempt links its own sync job" || fail "no sync job linked"
[ "$(echo "${A1}" | jq_field scopeEvidence)" = "MACHINE_MATCHED" ] && pass "scope evidence recorded as MACHINE_MATCHED" || fail "evidence was '$(echo "${A1}" | jq_field scopeEvidence)'"

DET="$(curl -s "${BASE}/api/imports/reviews/plans/${PLAN_ID}" -H "${AUTH}")"
[ "$(echo "${DET}" | jq_field segments.0.executionState)" = "COMPLETED" ] && [ "$(echo "${DET}" | jq_field segments.0.coverageState)" = "COVERED" ] \
  && pass "segment 1 is COMPLETED + COVERED" || fail "segment 1 state wrong"

echo "== a spent ingest authorization cannot be replayed =="
RE_ING="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/imports/reviews/launches/${L1REF}/ingest" -H "${AUTH}" -F "scopeEvidence=MACHINE_MATCHED" -F "file=@${GOLDEN}")"
[ "${RE_ING}" = "409" ] && pass "re-ingest refused (HTTP 409)" || fail "re-ingest returned HTTP ${RE_ING}"

# ─────────────────── 4. resume + dedup + honest evidence on segment 2 ───────────────────
echo "== resume: the next authorization is for segment 2, not segment 1 =="
L2="$(curl -s -X POST "${BASE}/api/imports/reviews/plans/${PLAN_ID}/launches/next-segment" -H "${AUTH}")"
L2REF="$(echo "${L2}" | jq_field launchRef)"
[ "$(echo "${L2}" | jq_field requiredStart)" = "2026-02-01" ] && pass "resumed at 2026-02-01 (segment 1 not re-offered)" || fail "resumed at '$(echo "${L2}" | jq_field requiredStart)'"
L2AGAIN="$(curl -s -X POST "${BASE}/api/imports/reviews/plans/${PLAN_ID}/launches/next-segment" -H "${AUTH}" | jq_field launchRef)"
[ "${L2REF}" = "${L2AGAIN}" ] && pass "re-click returns the SAME segment authorization" || fail "a second concurrent authorization was minted"

echo "== same export into segment 2 → overlap-safe dedup, evidence NOT upgraded =="
A2="$(curl -s -X POST "${BASE}/api/imports/reviews/launches/${L2REF}/ingest" -H "${AUTH}" -F "scopeEvidence=OPERATOR_CONFIRMED" -F "file=@${GOLDEN}")"
A2NEW="$(echo "${A2}" | jq_field rowsNew)"; A2DUP="$(echo "${A2}" | jq_field rowsDuplicate)"
[ "${A2NEW}" = "0" ] && [ "${A2DUP}" -gt 0 ] 2>/dev/null && pass "0 new / ${A2DUP} duplicate (dedup holds on the guided path)" || fail "dedup wrong: new=${A2NEW} dup=${A2DUP}"
[ "$(echo "${A2}" | jq_field result)" = "SUCCEEDED" ] && pass "an all-duplicate re-import is a success, not a failure" || fail "all-duplicate read as '$(echo "${A2}" | jq_field result)'"
# The honesty rule: what the run reported is what is stored.
[ "$(echo "${A2}" | jq_field scopeEvidence)" = "OPERATOR_CONFIRMED" ] && pass "OPERATOR_CONFIRMED stored as-is (never upgraded to a machine match)" || fail "evidence was '$(echo "${A2}" | jq_field scopeEvidence)'"

# ─────────────────────── 5. missing, coverage, health, completion ───────────────────────
echo "== segment 3 concluded unreachable → COMPLETED + MISSING, plan COMPLETED =="
curl -s -o /dev/null -X POST "${BASE}/api/imports/reviews/segments/${SEG3}/missing" -H "${AUTH}"
DET2="$(curl -s "${BASE}/api/imports/reviews/plans/${PLAN_ID}" -H "${AUTH}")"
[ "$(echo "${DET2}" | jq_field segments.2.coverageState)" = "MISSING" ] && pass "segment 3 coverage MISSING" || fail "segment 3 coverage wrong"
[ "$(echo "${DET2}" | jq_field plan.status)" = "COMPLETED" ] && pass "plan COMPLETED with nothing remaining" || fail "plan status '$(echo "${DET2}" | jq_field plan.status)'"
[ "$(echo "${DET2}" | jq_field coverage.remainingSegments)" = "0" ] && pass "coverage reports 0 remaining" || fail "remaining was '$(echo "${DET2}" | jq_field coverage.remainingSegments)'"

echo "== nothing remains ⇒ a further authorization is refused, not invented =="
NO_MORE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/imports/reviews/plans/${PLAN_ID}/launches/next-segment" -H "${AUTH}")"
[ "${NO_MORE}" = "409" ] && pass "no-remaining-work refused (HTTP 409)" || fail "returned HTTP ${NO_MORE}"

echo "== health surface =="
H="$(curl -s "${BASE}/api/imports/reviews/health?accountId=${ACCT}" -H "${AUTH}")"
HNEW="$(echo "${H}" | jq_field newCount)"; HDUP="$(echo "${H}" | jq_field duplicateCount)"
[ -n "${HNEW}" ] && [ -n "${HDUP}" ] && pass "health reports new=${HNEW} duplicate=${HDUP}" || fail "health unreadable"
[ -n "$(echo "${H}" | jq_field lastCoveredDate)" ] && pass "last covered date present" || fail "no last covered date"

echo
if [ "${FAILS}" -eq 0 ]; then echo "== ALL GUIDED-ORCHESTRATION CHECKS PASSED =="; else echo "== ${FAILS} CHECK(S) FAILED =="; fi
exit "${FAILS}"
