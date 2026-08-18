#!/usr/bin/env bash
#
# Self-Pilot Runtime v1 — mint the operator's STANDING READ GRANT (docs/sellerops_live_approval_contract.md §6a).
#
# Prints one opaque id of the shape the backend requires (`spr-` + 16 hex). It is an ENVIRONMENT-binding
# token, never a credential: putting it in the backend env is the operator's act of arming routine
# READ-only marketplace calls (Coupang signed GETs) for that backend process's lifetime. It opens no
# WRITE gate — the backend refuses it there by construction (CoupangLiveCallGuard.ensureLiveWriteAllowed).
#
# Nothing is written anywhere by this script. Copy the line it prints into backend/.env.local yourself.
#
set -euo pipefail
GRANT="spr-$(openssl rand -hex 8)"
echo "SELLEROPS_SELF_PILOT_READ_GRANT_ID=$GRANT"
echo
echo "  → add that line to backend/.env.local (gitignored), together with (values are yours):"
echo "      SELLEROPS_SELF_PILOT_ENABLED=true"
echo "      SELLEROPS_SELF_PILOT_ORG_IDS=<self-pilot org uuid>"
echo "      SELLEROPS_COLLECT_SCHEDULER_ENABLED=true"
echo "    then restart the backend. Re-run this to rotate; the old grant dies with the old process."
