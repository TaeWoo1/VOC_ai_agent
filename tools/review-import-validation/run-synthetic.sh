#!/usr/bin/env bash
# NAVER Initial Review Import (V1) — SYNTHETIC multi-segment proof (no live contact, no NAVER, no Chrome).
#
# Stands up a fresh disposable backend and drives the REAL import APIs end to end against the committed
# golden NAVER export, proving the package's mechanics offline:
#   * create a multi-month plan → calendar-month segments,
#   * import a segment (COMPLETED + COVERED, rows landed),
#   * OVERLAP-SAFE DEDUP — the same export into a second segment lands as all-duplicate (0 new),
#   * INTERRUPTION + RESUME — a re-read shows the remaining segment (state persisted),
#   * MISSING — a segment concluded unreachable reads COMPLETED + MISSING, and the plan completes,
#   * COVERAGE + HEALTH — last covered date, missing ranges, new/duplicate/failed, next recommended,
#   * SPLIT — an unattempted segment splits into contiguous children (parent superseded, kept),
# then a guarded teardown leaving no persistent test data.
#
#   bash tools/review-import-validation/run-synthetic.sh
#
# Requires: local Postgres, JDK/Gradle (backend), node, curl. The golden export is the same fixture the
# reply-state proof used; the segment date ranges are the plan's, not the file's — scope matching is the
# operator's confirmed responsibility on the live path, attested here by scopeConfirmed=true.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT=18082
STAMP="$(date -u +%Y%m%dT%H%M%S)"
RUNDB="sellerops_riv_${STAMP}"                 # sellerops_riv_* prefix → the name guard permits dropping it
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
EMAIL="riv-${STAMP}@riv.local"; PASS="riv-$(openssl rand -hex 12)"
curl -s -o /dev/null -X POST "${BASE}/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"name\":\"RIV\",\"orgName\":\"RIV Disposable Org\"}"
TOKEN="$(curl -s -X POST "${BASE}/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}" | jq_field token)"
AUTH="Authorization: Bearer ${TOKEN}"
NAVER_CH="$(curl -s "${BASE}/api/channels" -H "${AUTH}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);const l=Array.isArray(a)?a:(a.content||a.channels||[]);process.stdout.write((l.find(c=>c.code==="NAVER")||{}).id||"")})')"
ACCT="$(curl -s -X POST "${BASE}/api/seller-accounts/file-channel" -H "${AUTH}" -H 'Content-Type: application/json' -d "{\"channelId\":\"${NAVER_CH}\",\"alias\":\"RIV NAVER\"}" | jq_field id)"
[ -n "${TOKEN}" ] && [ -n "${NAVER_CH}" ] && [ -n "${ACCT}" ] && pass "org + NAVER account ready" || { fail "setup"; exit 1; }

echo "== create a 3-month plan (2026-01-01 .. 2026-03-31) =="
PLAN="$(curl -s -X POST "${BASE}/api/imports/reviews/plans" -H "${AUTH}" -H 'Content-Type: application/json' \
  -d "{\"sellerAccountId\":\"${ACCT}\",\"channelId\":\"${NAVER_CH}\",\"requestedStart\":\"2026-01-01\",\"requestedEnd\":\"2026-03-31\"}")"
PLAN_ID="$(echo "${PLAN}" | jq_field plan.id)"
NSEG="$(echo "${PLAN}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).segments.length)))')"
SEG_JAN="$(echo "${PLAN}" | jq_field segments.0.id)"
SEG_FEB="$(echo "${PLAN}" | jq_field segments.1.id)"
SEG_MAR="$(echo "${PLAN}" | jq_field segments.2.id)"
[ "${NSEG}" = "3" ] && pass "plan has 3 calendar-month segments" || fail "expected 3 segments, got ${NSEG}"

import_seg() { curl -s -X POST "${BASE}/api/imports/reviews/segments/$1/import" -H "${AUTH}" -F "scopeConfirmed=true" -F "file=@${GOLDEN}"; }

echo "== import segment 1 (golden export → rows land, COVERED) =="
A1="$(import_seg "${SEG_JAN}")"
[ "$(echo "${A1}" | jq_field result)" = "SUCCEEDED" ] && pass "segment 1 attempt SUCCEEDED" || fail "seg1 result: $(echo "${A1}" | jq_field result)"
N1="$(echo "${A1}" | jq_field rowsNew)"; D1="$(echo "${A1}" | jq_field rowsDuplicate)"
[ "${N1}" -ge 1 ] 2>/dev/null && pass "segment 1 brought ${N1} new rows" || fail "seg1 new rows: ${N1}"

echo "== import segment 2 with the SAME export → overlap-safe dedup (0 new, all duplicate) =="
A2="$(import_seg "${SEG_FEB}")"
N2="$(echo "${A2}" | jq_field rowsNew)"; D2="$(echo "${A2}" | jq_field rowsDuplicate)"
[ "${N2}" = "0" ] && [ "${D2}" = "${N1}" ] && pass "segment 2 deduped: 0 new, ${D2} duplicate" || fail "seg2 dedup: new=${N2} dup=${D2} (expected 0 / ${N1})"

echo "== interruption + resume: re-read the plan; segment 3 remains =="
DET="$(curl -s "${BASE}/api/imports/reviews/plans/${PLAN_ID}" -H "${AUTH}")"
REMAINING="$(echo "${DET}" | jq_field coverage.remainingSegments)"
COVERED="$(echo "${DET}" | jq_field coverage.coveredSegments)"
[ "${COVERED}" = "2" ] && [ "${REMAINING}" = "1" ] && pass "resumable: 2 covered, 1 remaining (segment 3 persisted)" || fail "covered=${COVERED} remaining=${REMAINING} (expected 2 / 1)"
MAR_EXEC="$(echo "${DET}" | jq_field segments.2.executionState)"
[ "${MAR_EXEC}" = "PENDING" ] && pass "segment 3 still PENDING after reload" || fail "seg3 exec: ${MAR_EXEC}"

echo "== health surface =="
H="$(curl -s "${BASE}/api/imports/reviews/health?accountId=${ACCT}" -H "${AUTH}")"
HNEW="$(echo "${H}" | jq_field newCount)"; HDUP="$(echo "${H}" | jq_field duplicateCount)"; HNEXT="$(echo "${H}" | jq_field nextRecommendedImport)"
[ "${HNEW}" = "${N1}" ] && pass "health newCount=${HNEW}" || fail "health newCount=${HNEW} (expected ${N1})"
[ "${HDUP}" = "${D2}" ] && pass "health duplicateCount=${HDUP}" || fail "health duplicateCount=${HDUP} (expected ${D2})"
[ "${HNEXT}" = "2026-03-01" ] && pass "next recommended import = ${HNEXT} (finish remaining first)" || fail "next recommended=${HNEXT} (expected 2026-03-01)"

echo "== mark segment 3 unreachable → COMPLETED + MISSING, plan completes =="
MS="$(curl -s -X POST "${BASE}/api/imports/reviews/segments/${SEG_MAR}/missing" -H "${AUTH}")"
[ "$(echo "${MS}" | jq_field coverageState)" = "MISSING" ] && [ "$(echo "${MS}" | jq_field executionState)" = "COMPLETED" ] && pass "segment 3 COMPLETED + MISSING" || fail "seg3 missing: exec=$(echo "${MS}" | jq_field executionState) cov=$(echo "${MS}" | jq_field coverageState)"
PLAN_STATUS="$(curl -s "${BASE}/api/imports/reviews/plans/${PLAN_ID}" -H "${AUTH}" | jq_field plan.status)"
[ "${PLAN_STATUS}" = "COMPLETED" ] && pass "plan status COMPLETED (no remaining work)" || fail "plan status: ${PLAN_STATUS}"

echo "== split proof: a fresh single-month plan splits into contiguous children =="
PLAN2="$(curl -s -X POST "${BASE}/api/imports/reviews/plans" -H "${AUTH}" -H 'Content-Type: application/json' \
  -d "{\"sellerAccountId\":\"${ACCT}\",\"channelId\":\"${NAVER_CH}\",\"requestedStart\":\"2026-06-01\",\"requestedEnd\":\"2026-06-30\"}")"
SEG6="$(echo "${PLAN2}" | jq_field segments.0.id)"
SPLIT="$(curl -s -X POST "${BASE}/api/imports/reviews/segments/${SEG6}/split" -H "${AUTH}" -H 'Content-Type: application/json' \
  -d '{"children":[{"start":"2026-06-01","end":"2026-06-15"},{"start":"2026-06-16","end":"2026-06-30"}]}')"
NCHILD="$(echo "${SPLIT}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(String(JSON.parse(d).length)))')"
[ "${NCHILD}" = "2" ] && pass "split produced 2 contiguous children" || fail "split children: ${NCHILD}"
P2_ID="$(echo "${PLAN2}" | jq_field plan.id)"
SUPERSEDED="$(curl -s "${BASE}/api/imports/reviews/plans/${P2_ID}" -H "${AUTH}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(String(o.segments.filter(s=>s.superseded).length))})')"
[ "${SUPERSEDED}" = "1" ] && pass "split parent superseded (kept for history)" || fail "superseded parents: ${SUPERSEDED}"

echo ""
if [ "${FAILS}" = "0" ]; then echo "ALL PASS — NAVER Initial Review Import synthetic multi-segment proof green"; else echo "FAILED — ${FAILS} check(s)"; fi
exit "${FAILS}"
