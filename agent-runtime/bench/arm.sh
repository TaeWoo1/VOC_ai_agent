#!/usr/bin/env bash
#
# Restart ONLY the backend with one arm's planner settings, then run the benchmark against it.
#
# Planner Model & Prompt Benchmark v1 §3. A long-lived dev process is a version pin: the plan model
# and reasoning effort are bound at boot, so an arm that is not restarted is the previous arm wearing
# a new name. The frontend and agent-runtime are left alone — nothing about them is an arm.
#
# `backend/.env.local` is still sourced (that is the deployment), and SPRING_APPLICATION_JSON is used
# for the arm because it outranks OS environment variables in Spring's property order, so an arm can
# override a value the dotenv sets without editing it. No secret is read, printed or written here.
#
#   bench/arm.sh <arm> <model> <effort> <set> [promptVariant]
set -euo pipefail
ARM="$1"; MODEL="$2"; EFFORT="$3"; SET="${4:-selection}"; VARIANT="${5:-A}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN="$REPO/tools/dev/.run"

pid="$(cat "$RUN/backend.pid" 2>/dev/null || true)"
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do sleep 1; done
fi
rm -f "$RUN/backend.pid"

# The two values `tools/dev/local-stack.sh` reads from the Keychain before every boot. Without them
# this deployment fails its own startup validation (the Cafe24 callback would still be the localhost
# default) — an arm must boot the SAME deployment, not a different one. Never printed.
if [ -z "${SELLEROPS_VAULT_KEY_RING:-}" ] && [ -x "$REPO/tools/vault/keyring-from-keychain.sh" ]; then
  SELLEROPS_VAULT_KEY_RING="$("$REPO/tools/vault/keyring-from-keychain.sh" 2>/dev/null || true)"
  [ -n "$SELLEROPS_VAULT_KEY_RING" ] && export SELLEROPS_VAULT_KEY_RING
fi
if [ -z "${SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI:-}" ]; then
  _cb="$(security find-generic-password -s sellerops-cafe24-oauth -a redirect-uri -w 2>/dev/null || true)"
  [ -n "$_cb" ] && export SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI="$_cb"
  unset _cb
fi

# Enforcement off, metering ON — identically for every arm. Raising the LIMIT was the old way and it
# was worse: the first pass spent part of itself measuring the quota, and the numbers the benchmark
# exists to produce (usage, latency, cost) come from the very rows a disabled subsystem stops writing.
# Enforcement off AND the actor header believed: a benchmark's calls are metered like any other and
# charged to nobody's daily budget (Pilot QA, 2026-09-06). Before this an arm spent the demo seller's
# quota — 1,211 runs against a limit of 200 — which is only invisible because enforcement was off.
export SPRING_APPLICATION_JSON="{\"sellerops\":{\"agent\":{\"quota\":{\"enforced\":false,\"trust-actor-header\":true},\"plan\":{\"model\":\"$MODEL\",\"reasoning-effort\":\"$EFFORT\",\"retry-reasoning-effort\":\"low\"}}}}"
export AGENT_RUNTIME_USAGE_ACTOR=BENCHMARK
export SELLEROPS_AGENT_PLAN_PROMPT_VARIANT="$VARIANT"

(
  cd "$REPO/backend"
  if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
  exec ./gradlew bootRun
) >"$RUN/backend.log" 2>&1 &
echo $! > "$RUN/backend.pid"

for i in $(seq 1 180); do
  curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:8080/health 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:8080/health || { echo "backend did not start" >&2; exit 1; }
echo "arm $ARM: backend up (model=$MODEL effort=$EFFORT prompt=$VARIANT)"

cd "$REPO/agent-runtime"
LOG_MARK="$(date -u +%FT%TZ)"
npx tsx bench/run.ts --arm="$ARM" --set="$SET" --out="bench/.out/$ARM-$SET.json" 2>/dev/null | tail -1
# The vendor's own token counts, from the line the backend logs per plan call.
awk -v m="$LOG_MARK" '$0 ~ /agent_plan / {print}' "$RUN/backend.log" > "bench/.out/$ARM-$SET.planlog"
echo "  planlog: $(wc -l < "bench/.out/$ARM-$SET.planlog") lines"
