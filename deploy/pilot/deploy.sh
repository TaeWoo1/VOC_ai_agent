#!/usr/bin/env bash
# Pilot deploy — Pilot Host Provisioning v1 §12. Run on the host, from the repo checkout.
#
#   deploy/pilot/deploy.sh            # pull → validate env → build → migrate (boot) → health → smoke
#   deploy/pilot/deploy.sh --no-pull  # same, on the checkout as it is
#
# Idempotent and boring on purpose. It never prints an env value; it prints which NAMES are missing.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" -f "$REPO/deploy/pilot/docker-compose.pilot.yml")

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# 1. code
if [[ "${1:-}" != "--no-pull" ]]; then
  step "1/6 code: git pull --ff-only"
  git -C "$REPO" pull --ff-only
fi
printf 'commit: %s\n' "$(git -C "$REPO" rev-parse --short HEAD)"

# 2. env validation — names and shapes only
step "2/6 env: $ENV_FILE"
[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found (copy deploy/pilot/pilot.env.example)"
perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
[[ "$perm" == "600" || "$perm" == "400" ]] || fail "$ENV_FILE must be mode 0600 (is $perm)"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
missing=()
for name in PILOT_PUBLIC_HOST PILOT_ACME_EMAIL POSTGRES_PASSWORD SELLEROPS_JWT_SECRET; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
[[ ${#missing[@]} -eq 0 ]] || fail "required names are blank: ${missing[*]}"
[[ "$PILOT_PUBLIC_HOST" != *"://"* && "$PILOT_PUBLIC_HOST" != *"/"* ]] || fail "PILOT_PUBLIC_HOST must be a bare host name"
[[ "$SELLEROPS_JWT_SECRET" != change-me* ]] || fail "SELLEROPS_JWT_SECRET is the repository placeholder"
[[ ${#SELLEROPS_JWT_SECRET} -ge 32 ]] || fail "SELLEROPS_JWT_SECRET is shorter than 32 characters"
[[ "${SELLEROPS_SEED_ENABLED:-false}" == "false" ]] || fail "SELLEROPS_SEED_ENABLED must be false on a pilot host (demo account)"
# Development and production credentials do not share a file, and a pilot env never becomes a commit:
# the env lives OUTSIDE the checkout (default /etc/sellerops/pilot.env), and the host is a real name.
case "$ENV_FILE" in "$REPO"/*) fail "$ENV_FILE is inside the repository — keep the pilot env outside the checkout (PILOT_ENV_FILE)";; esac
case "$PILOT_PUBLIC_HOST" in localhost|127.0.0.1|*.local) fail "PILOT_PUBLIC_HOST is a development name ($PILOT_PUBLIC_HOST)";; esac
# A model capability that is on but has no key fails the backend's own boot validator; failing here
# names the variable instead of making an operator read a stack trace.
for cap in AGENT_PLAN AGENT_DRAFT AGENT_JUDGE KNOWLEDGE_EMBEDDING KNOWLEDGE_INTENT KNOWLEDGE_ELIGIBILITY; do
  e="SELLEROPS_${cap}_ENABLED"; k="SELLEROPS_${cap}_API_KEY"
  if [[ "${!e:-false}" == "true" && -z "${!k:-}" ]]; then fail "$e=true but $k is blank"; fi
done
if [[ "${PILOT_GUIDED_HELPER_ENABLED:-false}" == "true" ]]; then
  # The helper runs on the SELLER's machine. A non-loopback bridge URL would point every seller's
  # browser at one shared helper, which is neither what this is nor something to configure by accident.
  case "${PILOT_HELPER_BRIDGE_URL:-http://127.0.0.1:47615}" in
    http://127.0.0.1:*|http://localhost:*) : ;;
    *) fail "PILOT_HELPER_BRIDGE_URL must be a loopback address on the seller's own machine";;
  esac
  printf 'note: guided helper ON — build the seller package FOR THIS SITE:
'
  printf '      REVIEWNARY_APP_URL=https://%s REVIEWNARY_BASE_URL=https://%s tools/helper/build-macos.sh
' \
    "$PILOT_PUBLIC_HOST" "$PILOT_PUBLIC_HOST"
fi
[[ "${SELLEROPS_PROACTIVE_ENABLED:-false}" == "false" ]] || printf 'note: proactive is ON — a deliberate choice, not the pilot default\n'
for flag in NAVER COUPANG CAFE24; do
  v="SELLEROPS_CONNECTOR_${flag}_ENABLED"
  if [[ "${!v:-false}" == "true" ]]; then
    [[ -n "${SELLEROPS_VAULT_MASTER_KEY:-}" ]] || fail "$v=true but SELLEROPS_VAULT_MASTER_KEY is blank"
  fi
done
if [[ "${SELLEROPS_CONNECTOR_NAVER_ENABLED:-false}" == "true" ]]; then
  [[ -n "${SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS:-}" ]] || fail "NAVER on but ADVERTISED_EGRESS_IPS blank (run egress-check.sh first)"
fi
printf 'env: ok (host=%s)\n' "$PILOT_PUBLIC_HOST"

# 3. images
step "3/6 build"
"${COMPOSE[@]}" build --pull

# 4. start — Flyway runs the migrations inside the backend boot; PilotConfigValidator refuses a bad env.
step "4/6 up (migrations run on backend boot)"
"${COMPOSE[@]}" up -d --remove-orphans

# 5. health
step "5/6 health"
for i in $(seq 1 60); do
  sleep 5
  b="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1=="backend"{print $2}')"
  if [[ "$b" == "healthy" ]]; then break; fi
  if [[ "$b" == "unhealthy" ]] || [[ "$("${COMPOSE[@]}" ps --format '{{.Service}} {{.State}}' | awk '$1=="backend"{print $2}')" == "exited" ]]; then
    printf '%s\n' "backend did not come up — last log lines:"; "${COMPOSE[@]}" logs --tail=40 backend; fail "backend health"
  fi
done
[[ "$b" == "healthy" ]] || fail "backend not healthy after 300s"
"${COMPOSE[@]}" ps
printf 'migrations: '; "${COMPOSE[@]}" logs backend 2>/dev/null | grep -c "Migrating schema\|Successfully applied\|Schema .* is up to date" || true

# 6. smoke
step "6/6 smoke"
PILOT_PUBLIC_HOST="$PILOT_PUBLIC_HOST" "$REPO/deploy/pilot/smoke.sh"
