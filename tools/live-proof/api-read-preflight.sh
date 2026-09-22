#!/usr/bin/env zsh
# REAL API read preflight — boot one backend that reads each approved source's first page, then stops being useful.
#
# Usage:
#   api-read-preflight.sh <approvalId> <orgId> <outputJson> [envFile]
#     approvalId  apr-api-read-<8–32 hex>, from the displayed READ_ONLY manifest (docs/sellerops_live_approval_contract.md)
#     envFile     defaults to backend/.env.local of the canonical checkout; never printed
#
# What it guarantees (and where):
#   - no concurrent collection  — every scheduler / self-pilot / proactive switch is forced OFF here, and the runner
#                                 refuses if any is still on (ApiReadPreflightConfiguration);
#   - no model call             — every AI capability switch is forced OFF here;
#   - no standing grant         — SELLEROPS_SELF_PILOT_READ_GRANT_ID is unset, so the Coupang gate opens only on
#                                 THIS approval id;
#   - settings before reads     — the preflight is the last ApplicationReadyEvent listener and asks
#                                 PilotConfigValidator.passed(); a process the validator refuses makes no read;
#   - one page per source       — Coupang NOANSWER/ANSWERED and NAVER PRODUCT_QNA/CUSTOMER_INQUIRY through
#                                 BoundedReadProbe (no page parameter exists); Cafe24 fetch is one board page.
set -eu
[[ $# -ge 3 ]] || { print -u2 "usage: $0 <approvalId> <orgId> <outputJson> [envFile]"; exit 2; }
APPROVAL=$1 ORG=$2 OUT=$3
ENV_FILE=${4:-/Users/taewookang/workspace/sellerops/repo/backend/.env.local}
[[ $APPROVAL =~ '^apr-api-read-[0-9a-f]{8,32}$' ]] || { print -u2 "malformed approval id"; exit 2; }
[[ -f $ENV_FILE ]] || { print -u2 "env file not found"; exit 2; }

set -a; . "$ENV_FILE"; set +a

# The Cafe24 callback must be the one registered on the Cafe24 app (runbook §1.4); the validator refuses the loopback
# default and this script does not invent one.
[[ -n ${SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI:-} ]] || {
  print -u2 "SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI missing — set the registered callback (docs/cafe24_live_e2e_runbook.md §1.4)"; exit 2; }

export SELLEROPS_COLLECT_SCHEDULER_ENABLED=false SELLEROPS_SELF_PILOT_ENABLED=false \
  SELLEROPS_RESPONSIBILITY_SCHEDULER_ENABLED=false SELLEROPS_PROACTIVE_ENABLED=false \
  SELLEROPS_INQUIRY_PUBLISH_EXECUTION_ENABLED=false
for k in $(env | grep -oE '^SELLEROPS_[A-Z0-9_]+_ENABLED' | grep -E 'AGENT_|KNOWLEDGE_|AI_TRIAGE|IMAGE_KNOWLEDGE|INQUIRY_SIGNATURE|INQUIRY_GOAL|RESPONSIBILITY_ASIDE|RESPONSIBILITY_INVESTIGATION|PRODUCT_DETAIL_ENRICHMENT|KNOWLEDGE_BOOTSTRAP'); do
  export "$k=false"
done
unset SELLEROPS_SELF_PILOT_READ_GRANT_ID
export SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID=$APPROVAL
export SELLEROPS_PREFLIGHT_API_READ_APPROVAL_ID=$APPROVAL SELLEROPS_PREFLIGHT_API_READ_ORG_ID=$ORG \
  SELLEROPS_PREFLIGHT_API_READ_DAYS=7 SELLEROPS_PREFLIGHT_API_READ_LIMIT=10 SELLEROPS_PREFLIGHT_API_READ_OUTPUT=$OUT

cd "${0:A:h}/../../backend"
exec ./gradlew bootRun --console=plain
