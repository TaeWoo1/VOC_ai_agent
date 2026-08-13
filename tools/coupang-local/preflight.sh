#!/usr/bin/env bash
#
# Coupang first-connection + order-routine live-proof PREFLIGHT. Run AFTER bootstrap.sh + run-backend-local.sh
# (and the frontend), and BEFORE the operator enters any credential. It reads ONLY local state + the backend's
# read-only /setup endpoint; it enters NO Coupang credential and makes NO Coupang call.
#
# Its crux is the ARMED-BINDING proof that a green /health alone can never give: the running backend must
# report (via /api/connect/coupang/setup) that the Coupang connector is enabled AND the live-call interlock
# is armed with THIS run's approval id prefix. That proves the operator's "Seated and ready." will bind to the
# exact backend we prepared — not a stale/other process (docs/sellerops_live_approval_contract.md §2).
#
# On any check failing it exits non-zero and prints NO Approval Manifest / requests NO approval.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ENV="$HERE/.run/current.env"
MANIFEST_OUT="${SELLEROPS_MANIFEST_OUT:-${TMPDIR:-/tmp}/coupang-runtime-manifest.json}"
SMOKE_EMAIL="${SMOKE_EMAIL:-demo@sellerops.ai}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-demo1234}"

FAILED=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }
http_status() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" 2>/dev/null || echo "000"; }
jget() { python3 -c "import json,sys;v=json.load(sys.stdin)$1;print('' if v is None else v)" 2>/dev/null; }

# ---- run identity (required; from bootstrap.sh) -------------------------------
if [ ! -f "$RUN_ENV" ]; then
  echo "PREFLIGHT FAIL — no run env at $RUN_ENV. Run tools/coupang-local/bootstrap.sh first."
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$RUN_ENV"; set +a
RUN_ID="$COUPANG_RUN_ID"
RUN_GIT="$COUPANG_GIT_COMMIT"
APPROVAL_ID="$COUPANG_APPROVAL_ID"
BACKEND_ORIGIN="${SELLEROPS_BACKEND_ORIGIN:-$COUPANG_BACKEND_ORIGIN}"
FRONTEND_ORIGIN="${SELLEROPS_FRONTEND_ORIGIN:-$COUPANG_FRONTEND_ORIGIN}"
DB_ALIAS="$COUPANG_DB_ALIAS"
# The run kind the bootstrap minted. A run env without one predates the split and is `orders`.
RUN_KIND="${COUPANG_RUN_KIND:-orders}"
case "$RUN_KIND" in
  orders|inquiries|inquiries-dedupe) ;;
  *) echo "PREFLIGHT FAIL — run env carries an unknown kind '$RUN_KIND'. Re-bootstrap."; exit 1 ;;
esac
# The prefix length the backend surfaces (must match CoupangSetupView.LiveApprovalReadiness.PREFIX_LENGTH).
APPROVAL_PREFIX_LEN=12
EXPECTED_PREFIX="${APPROVAL_ID:0:$APPROVAL_PREFIX_LEN}"

PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-55432}"; PGDATABASE="${PGDATABASE:-coupang_proof}"; PGUSER="${PGUSER:-sellerops}"
export PGHOST PGPORT PGDATABASE PGUSER
[ -n "${PGPASSWORD:-}" ] && export PGPASSWORD
PSQL="$(command -v psql || echo /opt/homebrew/opt/postgresql@15/bin/psql)"
q() { "$PSQL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
coupang_accts() { q "select count(*) from seller_accounts sa join channels c on c.id=sa.channel_id where c.code='COUPANG'"; }

echo "Coupang live-proof preflight — run=$RUN_ID git=$RUN_GIT db=$DB_ALIAS@$PGHOST:$PGPORT"
echo "backend=$BACKEND_ORIGIN — read-only checks + the armed-binding proof (NO Coupang call)"
echo

# 1. Backend health.
[ "$(http_status "$BACKEND_ORIGIN/health")" = "200" ] && pass "backend /health UP" || fail "backend /health not UP at $BACKEND_ORIGIN"

# 2. Login (read-only; disposable demo account) → token for the authed /setup read.
TOKEN="$(curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}" "$BACKEND_ORIGIN/api/auth/login" \
  | jget "['token']")"
if [ -z "$TOKEN" ]; then
  fail "could not log in to read /setup (demo login failed)"
  SETUP="{}"
else
  pass "logged in to the disposable backend (demo account)"
  SETUP="$(curl -s --max-time 8 -H "Authorization: Bearer $TOKEN" "$BACKEND_ORIGIN/api/connect/coupang/setup" 2>/dev/null)"
fi

# 3. ARMED-BINDING proof — the running backend must be Coupang-enabled, interlock-armed, bound to THIS run.
CONNECTOR_ENABLED="$(printf '%s' "$SETUP" | jget "['liveApproval']['connectorEnabled']")"
APPROVAL_ARMED="$(printf '%s' "$SETUP" | jget "['liveApproval']['approvalArmed']")"
BACKEND_PREFIX="$(printf '%s' "$SETUP" | jget "['liveApproval']['approvalIdPrefix']")"
[ "$CONNECTOR_ENABLED" = "True" ] && pass "backend reports Coupang connector ENABLED" \
  || fail "backend does not report the Coupang connector enabled (flag off / wrong backend)"
[ "$APPROVAL_ARMED" = "True" ] && pass "backend live-call interlock is ARMED" \
  || fail "backend live-call interlock NOT armed — run-backend-local.sh must arm this run's approval id"
if [ -n "$BACKEND_PREFIX" ] && [ "$BACKEND_PREFIX" = "$EXPECTED_PREFIX" ]; then
  pass "armed approval id prefix matches this run (${EXPECTED_PREFIX})"
else
  fail "armed approval id ('$BACKEND_PREFIX') != this run's ('$EXPECTED_PREFIX') — wrong/stale backend; re-bootstrap + re-run backend"
fi

# 4. Advertised calling IP(s) — surfaced for the operator to eyeball-match against what they registered.
ADVERTISED="$(printf '%s' "$SETUP" | python3 -c "import json,sys;print(','.join(json.load(sys.stdin).get('advertisedEgressIps',[])) or '<none set>')" 2>/dev/null || echo '<parse error>')"
echo "  advertised calling IP(s): $ADVERTISED"
echo "  NOTE: the harness cannot read the backend's REAL OS egress IP. Confirm the backend's actual outbound"
echo "        IP is registered in the Coupang app BEFORE approving — an unregistered IP ⇒ 403 'Not allowed IP'."

# 5. Disposable DB / scheduler off / git drift.
case "${SPRING_DATASOURCE_URL:-jdbc:postgresql://$PGHOST:$PGPORT/$PGDATABASE}" in
  *:5432/*sellerops*|*/sellerops|*/sellerops\?*) fail "datasource looks like the REAL sellerops DB (name 'sellerops')" ;;
  *) pass "datasource is disposable ($DB_ALIAS@$PGHOST:$PGPORT)" ;;
esac
[ "${SELLEROPS_COLLECT_SCHEDULER_ENABLED:-false}" = "false" ] && pass "collection scheduler OFF (this shell)" \
  || fail "scheduler must be OFF"
CUR_GIT="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
[ "$CUR_GIT" = "$RUN_GIT" ] && pass "git commit unchanged since bootstrap ($CUR_GIT)" \
  || fail "git commit changed ($RUN_GIT → $CUR_GIT) — re-bootstrap the run"

# 6. Expected baseline — a live proof starts from a KNOWN state so the counts it records are unambiguous.
#    The two kinds expect different states, and each is checked exactly, never loosely:
#      orders     — nothing yet: the run creates the account, stores the credential, and collects.
#      inquiries  — exactly one connected Coupang account with its credential already stored (the handoff
#                   ran first), and NO inquiry yet, so every inquiry that appears came from this run.
CREDS="$(q 'select count(*) from connector_credentials')"; SYNCS="$(q 'select count(*) from sync_jobs')"
ORDERS="$(q 'select count(*) from channel_orders')"; COUPANG_ACCTS="$(coupang_accts)"
INQUIRIES="$(q 'select count(*) from inquiries')"; WORKITEMS="$(q 'select count(*) from inquiry_work_item')"
if [ -z "$CREDS$SYNCS$ORDERS$COUPANG_ACCTS$INQUIRIES$WORKITEMS" ]; then
  fail "could not query the disposable DB ($PGHOST:$PGPORT/$PGDATABASE)"
  CREDS="?"; SYNCS="?"; ORDERS="?"; COUPANG_ACCTS="?"; INQUIRIES="?"; WORKITEMS="?"
elif [ "$RUN_KIND" = "inquiries-dedupe" ]; then
  # The idempotency re-run inverts the usual baseline: it needs rows to ALREADY be there, because the
  # property under test is that re-collecting them changes nothing. The count is captured here and
  # printed in the manifest as the number the run must leave untouched.
  echo "  baseline: credentials=$CREDS coupang_accounts=$COUPANG_ACCTS inquiries=$INQUIRIES work_items=$WORKITEMS"
  { [ "$CREDS" = 1 ] && [ "$COUPANG_ACCTS" = 1 ]; } \
    && pass "exactly one connected Coupang account with a stored credential" \
    || fail "needs exactly ONE Coupang account with ONE stored credential"
  [ "${INQUIRIES:-0}" -gt 0 ] 2>/dev/null \
    && pass "$INQUIRIES inquiry row(s) already collected — there is something to re-collect" \
    || fail "no inquiry collected yet — run the acquisition proof first; there is nothing to dedupe against"
  CURSOR="$(q "select count(*) from sync_cursors where data_type='INQUIRY'")"
  [ "${CURSOR:-0}" -gt 0 ] 2>/dev/null \
    && pass "an INQUIRY cursor exists (the run's first action clears it to re-sweep the same window)" \
    || fail "no INQUIRY cursor — the previous acquisition run did not complete"
elif [ "$RUN_KIND" = "inquiries" ]; then
  echo "  baseline: credentials=$CREDS coupang_accounts=$COUPANG_ACCTS inquiries=$INQUIRIES work_items=$WORKITEMS"
  { [ "$CREDS" = 1 ] && [ "$COUPANG_ACCTS" = 1 ]; } \
    && pass "exactly one connected Coupang account with a stored credential" \
    || fail "inquiry proof needs exactly ONE Coupang account with ONE stored credential (run the credential handoff first)"
  { [ "$INQUIRIES" = 0 ] && [ "$WORKITEMS" = 0 ]; } \
    && pass "no inquiry collected yet (every row this run records is its own)" \
    || fail "inquiries/work items already present — reset the disposable DB so the counts are unambiguous"
else
  echo "  baseline: credentials=$CREDS sync_jobs=$SYNCS channel_orders=$ORDERS coupang_accounts=$COUPANG_ACCTS"
  { [ "$CREDS" = 0 ] && [ "$SYNCS" = 0 ] && [ "$ORDERS" = 0 ] && [ "$COUPANG_ACCTS" = 0 ]; } \
    && pass "pristine baseline (all zero)" || fail "baseline not pristine — reset the disposable DB"
fi

# ---- Approval Manifest (sanitized) --------------------------------------------
# mode=WRITE per docs/sellerops_live_approval_contract.md §7: credential entry + connection test + first sync
# is a WRITE-class step (it writes a credential + account + sync state to OUR system). Every Coupang
# MARKETPLACE call in this run is a read-only GET — no order/shipping/product mutation.
if [ "$RUN_KIND" = "inquiries-dedupe" ]; then
  # mode=WRITE for the same reason: sync state is written to OUR system. The ONLY local write outside the
  # sync itself is the cursor delete named below — no inquiry, work item, product or credential row is
  # touched by hand, and the whole point of the run is that the sync does not change them either.
  APPROVAL_OPERATION="${SELLEROPS_APPROVAL_OPERATION:-INQUIRY idempotency proof: clear the INQUIRY cursor on this account, re-sweep the SAME 30-day window, and prove the re-collected rows are skipped rather than duplicated}"
  APPROVAL_MAX="${SELLEROPS_APPROVAL_MAX:-cursor delete=1 (INQUIRY, this account), re-sync=1, expected inserted=0 / skipped=$INQUIRIES, replies posted=0}"
elif [ "$RUN_KIND" = "inquiries" ]; then
  # Still mode=WRITE: the first sync writes collection state to OUR system (contract §7 lists
  # "first sync" as WRITE-class). Every Coupang MARKETPLACE call is a read-only GET.
  #
  # **The guided reply entry is included, and the reply is deliberately NOT posted.** Bundling the
  # verifications into one run is the point — but a posted reply is a real answer to a real buyer on a
  # live account, and that is the seller's product decision, not a proof artifact. The run reaches the
  # submit barrier, shows the draft, and is cancelled there. Posting for real is its own decision on
  # its own day.
  APPROVAL_OPERATION="${SELLEROPS_APPROVAL_OPERATION:-상품별 고객문의 acquisition + routine proof (first INQUIRY sync + idempotent re-sync + work queue/proposal/draft + guided reply ENTRY, no reply posted)}"
  APPROVAL_MAX="${SELLEROPS_APPROVAL_MAX:-sync=1, re-sync=1, guided-entry=1, replies posted=0 (cancelled at the submit barrier)}"
else
  APPROVAL_OPERATION="${SELLEROPS_APPROVAL_OPERATION:-guided first-connection + order-routine read-only proof (credential + connect-test + first ORDER_SUMMARY sync + idempotent re-sync)}"
  APPROVAL_MAX="${SELLEROPS_APPROVAL_MAX:-credential=1, test=1, sync=1, re-sync=1}"
fi
APPROVAL_ACCOUNT="${SELLEROPS_APPROVAL_ACCOUNT:-operator-owned Coupang WING vendor (test)}"
# Sanitized account binding only — fail closed if an override looks like a raw id/token (contract §2).
if printf '%s' "$APPROVAL_ACCOUNT" | grep -Eq '^[0-9]{4,}$|^[0-9a-fA-F]{16,}$'; then
  echo "PREFLIGHT FAIL: SELLEROPS_APPROVAL_ACCOUNT looks like a raw id/token — the manifest carries only a sanitized description."
  exit 1
fi
echo
if [ "$FAILED" = "0" ]; then
  echo "PREFLIGHT PASS"
  # Emit the manifest ONLY on PASS — a manifest is prepared/displayed only when the run is immediately
  # executable (contract §2). On FAIL no manifest is written or shown.
  cat > "$MANIFEST_OUT" <<JSON
{
  "approvalId": "$APPROVAL_ID",
  "runId": "$RUN_ID",
  "gitCommit": "$CUR_GIT",
  "channel": "COUPANG",
  "runKind": "$RUN_KIND",
  "surface": "$( [ "$RUN_KIND" = "inquiries" ] && echo "operations inbox + guided WING inquiry window" || echo "connect/coupang" )",
  "operation": "$APPROVAL_OPERATION",
  "mode": "WRITE",
  "accountBinding": "$APPROVAL_ACCOUNT",
  "backendOrigin": "$BACKEND_ORIGIN",
  "frontendOrigin": "$FRONTEND_ORIGIN",
  "dbAlias": "$DB_ALIAS@$PGHOST:$PGPORT",
  "scheduler": "${SELLEROPS_COLLECT_SCHEDULER_ENABLED:-false}",
  "coupangFlag": "$CONNECTOR_ENABLED",
  "interlockArmed": "$APPROVAL_ARMED",
  "advertisedCallingIps": "$ADVERTISED",
  "baseline": { "credentials": "$CREDS", "syncJobs": "$SYNCS", "channelOrders": "$ORDERS", "coupangAccounts": "$COUPANG_ACCTS" },
  "maxActions": "$APPROVAL_MAX",
  "operatorPresenceRequired": true,
  "expiresAt": "process-lifetime"
}
JSON
  echo "runtime + approval manifest (sanitized) → $MANIFEST_OUT"; sed 's/^/  /' "$MANIFEST_OUT"
  echo
  echo "  operator URL   : $FRONTEND_ORIGIN/connect/coupang"
  echo "  expected run   : ${RUN_ID:0:8}…"
  echo "  expected git   : $CUR_GIT"
  echo "  expected db    : $DB_ALIAS"
  echo
  echo "  ── APPROVAL MANIFEST (sanitized) ──"
  echo "  COUPANG · $APPROVAL_OPERATION"
  echo "  WRITE · run ${RUN_ID:0:8}… · approval ${APPROVAL_ID:0:8}… · max: $APPROVAL_MAX"
  echo "  account: $APPROVAL_ACCOUNT · operator presence: required · expires: process-lifetime · git $CUR_GIT"
  echo "  interlock: ARMED · advertised calling IP(s): $ADVERTISED"
  echo "  Standing Safety Contract + full scope: docs/sellerops_live_approval_contract.md"
  echo
  echo "  All Coupang MARKETPLACE calls in this run are read-only GETs — no order/shipping/product write."
  if [ "$RUN_KIND" = "inquiries-dedupe" ]; then
    echo "  The run FIRST deletes exactly one row: this account's INQUIRY sync cursor. Nothing else is"
    echo "  hand-modified. Then one sync re-sweeps the same 30 days. PASS = inserted 0, skipped $INQUIRIES,"
    echo "  failed 0, inquiries still $INQUIRIES, work items still $WORKITEMS. Any insert is a dedupe FAILURE."
    echo "  onlineInquiries ONLY — the PII-bearing callCenterInquiries endpoint is never called."
  fi
  if [ "$RUN_KIND" = "inquiries" ]; then
    echo "  The inquiry stream calls onlineInquiries ONLY. The PII-bearing callCenterInquiries endpoint"
    echo "  (buyerEmail / buyerPhone) is never called, and no buyer identity is stored or displayed."
    echo "  NO reply is posted: the guided run stops at the submit barrier and is cancelled there."
  fi
  echo "  If this manifest is correct and displayed, the operator's entire single-use grant is one line:"
  echo "    Seated and ready."
  echo "  (Re-bootstrap ⇒ new approval id ⇒ old approval is dead. A code/branch/run/scope change ⇒ REVOKED.)"
  exit 0
else
  echo "PREFLIGHT FAIL — do NOT enter a credential or trigger any Coupang call until every check passes."
  exit 1
fi
