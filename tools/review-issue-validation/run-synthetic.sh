#!/usr/bin/env bash
# Review Issue Memory — SYNTHETIC proof runner (no live contact, no NAVER, no Chrome, no browser).
#
# Stands up a fresh disposable backend on a real Postgres database, which is the ONLY thing that
# executes V31__review_issue_memory.sql: the JVM suite runs H2 with Flyway disabled, so a migration
# that disagreed with the entities is green there and fails only here.
#
# Then it seeds two corpora through the SAME upload path a real export uses —
#   1. the committed golden NAVER export (contracts/review-export/naver/v1), so the ingest path is
#      real rather than hand-built, and
#   2. a synthetic 5-star corpus whose dates place each judgement in the window
#      contracts/review-issue/v1/THRESHOLDS.md defines for it.
# Every synthetic row is rated 5, which is the point: those reviews are invisible to the needs-a-look
# queue, so the run proves both that issues appear from them AND that the queue's own
# LOW_RATING_REVIEW count does not move (the regression gate in review-eval/naver/v1/RUBRIC.md §5).
#
#   bash tools/review-issue-validation/run-synthetic.sh
#
# Requires: local Postgres, JDK/Gradle (backend), node 20+.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT=18085
STAMP="$(date -u +%Y%m%dT%H%M%S)"
RUNDB="sellerops_issueproof_${STAMP}"   # sellerops_issueproof_* → the only prefix the guard permits
WORK="$(mktemp -d)"

# Fixed reference date. The synthetic corpus is generated backwards from it, so every window boundary
# is deterministic and a run is reproducible months later.
REF="2026-07-25"
# The golden export's own review window, for the attention (queue) reading.
FROM="2026-05-01"; TO="2026-05-31"

guarded_dropdb() {
  case "$1" in
    sellerops_issueproof_*) dropdb --if-exists "$1" >/dev/null 2>&1 && echo "  dropped $1";;
    *) echo "  REFUSED (no sellerops_issueproof_ prefix): $1"; return 1;;
  esac
}

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

echo "== name-guard falsification (must refuse every persistent DB) =="
guarded_dropdb sellerops || echo "  sellerops correctly refused"
guarded_dropdb sellerops_dev || echo "  sellerops_dev correctly refused"

echo "== fresh disposable backend (this is what runs Flyway V1..V31 for real) =="
createdb "${RUNDB}"; echo "  created ${RUNDB}"
( cd "${REPO}/backend" && SERVER_PORT="${PORT}" \
    SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5432/${RUNDB}" \
    ./gradlew bootRun --console=plain >"${WORK}/backend.log" 2>&1 ) &
BACKEND_PID=$!
printf "  booting"; UP=""
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/channels" 2>/dev/null)" || code="000"
  if [ "${code}" != "000" ]; then echo " up (HTTP ${code})"; UP=1; break; fi
  printf "."; sleep 5
done
[ -n "${UP}" ] || { echo " backend did not come up"; tail -40 "${WORK}/backend.log"; exit 1; }

echo "== confirm V31 actually applied (not skipped, not failed) =="
psql -qtA -d "${RUNDB}" -c \
  "select version || ' ' || success || ' ' || description from flyway_schema_history where version = '31';" \
  | sed 's/^/  /'
APPLIED="$(psql -qtA -d "${RUNDB}" -c "select count(*) from flyway_schema_history where version='31' and success;")"
[ "${APPLIED}" = "1" ] || { echo "  V31 did not apply"; exit 1; }
for t in review_issues review_issue_evidence review_issue_unknown_units review_issue_state_events; do
  n="$(psql -qtA -d "${RUNDB}" -c "select count(*) from information_schema.tables where table_name='${t}';")"
  echo "  table ${t}: ${n}"
  [ "${n}" = "1" ] || { echo "  missing table ${t}"; exit 1; }
done
echo "  unique + window indexes:"
psql -qtA -d "${RUNDB}" -c \
  "select indexname from pg_indexes where tablename like 'review_issue%' order by indexname;" | sed 's/^/    /'

echo "== register org + resolve the NAVER file channel =="
EMAIL="issueproof-${STAMP}@riv.local"; PASS="riv-$(openssl rand -hex 12)"
curl -s -o /dev/null -w '  signup HTTP %{http_code}\n' -X POST "http://127.0.0.1:${PORT}/api/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"name\":\"Issue Proof\",\"orgName\":\"Issue Proof Org\",\"termsAccepted\":true}"
TOKEN="$(curl -s -X POST "http://127.0.0.1:${PORT}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).token||""))')"
[ -n "${TOKEN}" ] || { echo "  login failed"; exit 1; }
NAVER_CH="$(curl -s "http://127.0.0.1:${PORT}/api/channels" -H "Authorization: Bearer ${TOKEN}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);const l=Array.isArray(a)?a:(a.content||a.channels||[]);process.stdout.write((l.find(c=>c.code==="NAVER")||{}).id||"")})')"
ACCT="$(curl -s -X POST "http://127.0.0.1:${PORT}/api/seller-accounts/file-channel" \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"channelId\":\"${NAVER_CH}\",\"alias\":\"Issue Proof NAVER\"}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.id||o.accountId||o.sellerAccountId||"")})')"
echo "  NAVER channel + account resolved: $([ -n "${NAVER_CH}" ] && [ -n "${ACCT}" ] && echo yes || echo NO)"
[ -n "${ACCT}" ] || exit 1

upload() {  # upload <path>
  curl -s -X POST "http://127.0.0.1:${PORT}/api/uploads?channelId=${NAVER_CH}&uploadType=REVIEW" \
    -H "Authorization: Bearer ${TOKEN}" -F "file=@$1" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);console.log("  ingest inserted="+(o.inserted??o.created??"?")+" duplicate="+(o.duplicate??o.duplicates??"?"))})'
}

echo "== seed 1: the committed golden NAVER export (real ingest path) =="
upload "${REPO}/contracts/review-export/naver/v1/naver-review-export-v1.xlsx"

echo "== seed 2: synthetic 5-star corpus, dated for each judgement window =="
node "${REPO}/tools/review-issue-validation/synthetic-corpus.mjs" "${REF}" >"${WORK}/corpus.csv"
echo "  rows: $(( $(wc -l <"${WORK}/corpus.csv") - 1 )) (all rated 5 — invisible to the low-rating queue)"
upload "${WORK}/corpus.csv"

echo "== verify =="
SELLEROPS_BASE_URL="http://127.0.0.1:${PORT}" RIV_TOKEN="${TOKEN}" RIV_ACCOUNT_ID="${ACCT}" \
  RIV_REFERENCE_DATE="${REF}" RIV_FROM="${FROM}" RIV_TO="${TO}" \
  node "${REPO}/tools/review-issue-validation/verify.mjs"
RC=$?
echo "== verify exit ${RC} =="
exit ${RC}
