#!/usr/bin/env bash
# Reply-State Live Validation — SYNTHETIC proof runner (no live contact, no NAVER, no Chrome).
#
# Stands up a fresh disposable backend, seeds ONE single-NAVER-account org with the committed golden
# review export (ingested via the SAME upload path a live export uses — so its answered/pending
# low-rating mix is real, not hand-built), pins the seller-account→org resolution, runs the reusable
# C2/C4 harness (verify.mjs), then tears down guarded — leaving no persistent test data.
#
# The seed here is the ONLY synthetic part. For the LIVE proof, replace the seed step with the real
# live-export ingest into the same disposable backend and run verify.mjs unchanged.
#
#   bash tools/reply-state-validation/run-synthetic.sh
#
# Requires: local Postgres, JDK/Gradle (backend), node, the collector deps installed.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT=18080
STAMP="$(date -u +%Y%m%dT%H%M%S)"
RUNDB="sellerops_run7_rsv_${STAMP}"          # sellerops_run7_* prefix → the name guard permits dropping it
WORK="$(mktemp -d)"
ENVF="${WORK}/env"
FROM="2026-05-01"; TO="2026-05-31"           # the golden fixture's review window

guarded_dropdb() { case "$1" in sellerops_run7_*) dropdb --if-exists "$1" >/dev/null 2>&1 && echo "  dropped $1";; *) echo "  REFUSED (no sellerops_run7_ prefix): $1"; return 1;; esac; }

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
guarded_dropdb sellerops_dev || echo "  sellerops_dev correctly refused"

echo "== fresh disposable backend =="
createdb "${RUNDB}"; echo "  created ${RUNDB}"
( cd "${REPO}/backend" && SERVER_PORT="${PORT}" SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:5432/${RUNDB}" ./gradlew bootRun --console=plain >"${WORK}/backend.log" 2>&1 ) &
BACKEND_PID=$!
printf "  booting"; UP=""; for i in $(seq 1 90); do
  # curl -w already prints "000" on a connection failure; capture it WITHOUT a second echo (which
  # would concatenate to "000000" and read as a false "up").
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/channels" 2>/dev/null)" || code="000"
  if [ "${code}" != "000" ]; then echo " up (HTTP ${code})"; UP=1; break; fi
  printf "."; sleep 5
done
[ -n "${UP}" ] || { echo " backend did not come up"; exit 1; }

echo "== register single-NAVER-account org + pin resolution =="
EMAIL="rsv-${STAMP}@rsv.local"; PASS="rsv-$(openssl rand -hex 12)"
umask 077; printf 'SELLEROPS_BASE_URL=http://127.0.0.1:%s\nSELLEROPS_EMAIL=%s\nSELLEROPS_PASSWORD=%s\n' "${PORT}" "${EMAIL}" "${PASS}" >"${ENVF}"
curl -s -o /dev/null -w '  signup HTTP %{http_code}\n' -X POST "http://127.0.0.1:${PORT}/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"name\":\"RSV Operator\",\"orgName\":\"RSV Disposable Org\"}"
TOKEN="$(curl -s -X POST "http://127.0.0.1:${PORT}/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write((JSON.parse(d).token)||""))')"
NAVER_CH="$(curl -s "http://127.0.0.1:${PORT}/api/channels" -H "Authorization: Bearer ${TOKEN}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d);const l=Array.isArray(a)?a:(a.content||a.channels||[]);process.stdout.write((l.find(c=>c.code==="NAVER")||{}).id||"")})')"
ACCT="$(curl -s -X POST "http://127.0.0.1:${PORT}/api/seller-accounts/file-channel" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' -d "{\"channelId\":\"${NAVER_CH}\",\"alias\":\"RSV NAVER\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);process.stdout.write(o.id||o.accountId||o.sellerAccountId||"")})')"
echo "  NAVER account resolved: $([ -n "${ACCT}" ] && echo yes || echo NO)"

echo "== seed via the ingest path (committed golden export — SWAP THIS for the live export ingest) =="
( cd "${REPO}/collector" && set -a && . "${ENVF}" && set +a && npm run --silent upload -- "${REPO}/contracts/review-export/naver/v1/naver-review-export-v1.xlsx" 2>&1 | grep -iE "upload.done|run.done|error|fail" | sed 's/^/  /' )

echo "== verify C2/C4 (reusable harness) =="
( set -a && . "${ENVF}" && set +a && RSV_ACCOUNT_ID="${ACCT}" RSV_FROM="${FROM}" RSV_TO="${TO}" node "${REPO}/tools/reply-state-validation/verify.mjs" )
RC=$?
echo "== verify exit ${RC} =="
exit ${RC}
