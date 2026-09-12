#!/usr/bin/env bash
# Pilot deploy — Pilot Host Provisioning v1 §12. Run on the host, from the repo checkout.
#
#   deploy/pilot/deploy.sh            # pull → validate env → backup → build → migrate (boot) → health → smoke
#   deploy/pilot/deploy.sh --no-pull  # same, on the checkout as it is
#   deploy/pilot/deploy.sh --no-backup # retry a failed deploy without a second dump of unchanged data
#
# Idempotent and boring on purpose. It never prints an env value; it prints which NAMES are missing.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" -f "$REPO/deploy/pilot/docker-compose.pilot.yml")

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# 1. code
if [[ " $* " != *" --no-pull "* ]]; then
  step "1/7 code: git pull --ff-only"
  git -C "$REPO" pull --ff-only
fi
printf 'commit: %s\n' "$(git -C "$REPO" rev-parse --short HEAD)"

# 2. env validation — names and shapes only
step "2/7 env: $ENV_FILE"
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
# Clean production data: nothing on this host may manufacture rows. SEED_ENABLED gates the demo
# organisation (and the demo content nested inside it); the two mock switches gate a connector that
# writes synthesized reviews and inquiries as data_origin=REAL, which is inseparable afterwards.
[[ "${SELLEROPS_SEED_ENABLED:-false}" == "false" ]] || fail "SELLEROPS_SEED_ENABLED must be false on a pilot host (demo account)"
[[ "${SELLEROPS_SEED_DEMO_CONTENT:-false}" == "false" ]] || fail "SELLEROPS_SEED_DEMO_CONTENT must be false on a pilot host (fixture rows)"
[[ "${SELLEROPS_CONNECTOR_MOCK_ENABLED:-false}" == "false" ]] || fail "SELLEROPS_CONNECTOR_MOCK_ENABLED must be false on a pilot host (synthesized rows land as REAL)"
[[ "${SELLEROPS_CONNECTOR_MOCK_FALLBACK_ENABLED:-false}" == "false" ]] || fail "SELLEROPS_CONNECTOR_MOCK_FALLBACK_ENABLED must be false on a pilot host"
# Development and production credentials do not share a file, and a pilot env never becomes a commit:
# the env lives OUTSIDE the checkout (default /etc/sellerops/pilot.env), and the host is a real name.
case "$ENV_FILE" in "$REPO"/*) fail "$ENV_FILE is inside the repository — keep the pilot env outside the checkout (PILOT_ENV_FILE)";; esac
case "$PILOT_PUBLIC_HOST" in localhost|127.0.0.1|*.local) fail "PILOT_PUBLIC_HOST is a development name ($PILOT_PUBLIC_HOST)";; esac
# A model capability that is on but has no key fails the backend's own boot validator; failing here
# names the variable instead of making an operator read a stack trace.
for cap in AGENT_PLAN AGENT_DRAFT AGENT_JUDGE AGENT_CONVERSE AGENT_REPORT KNOWLEDGE_EMBEDDING KNOWLEDGE_INTENT KNOWLEDGE_ELIGIBILITY; do
  e="SELLEROPS_${cap}_ENABLED"; k="SELLEROPS_${cap}_API_KEY"
  if [[ "${!e:-false}" == "true" && -z "${!k:-}" ]]; then fail "$e=true but $k is blank"; fi
done
# The three retrieval capabilities are not widened by SELLEROPS_AGENT_ACCESS_SCOPE: they send the
# customer's question to a vendor, and a seller does not ask for that by connecting a channel. So an
# organisation list is not optional for them, and `*` is not a pilot answer. (The backend refuses the
# same shape at boot; failing here names the variable instead of a stack trace.)
for cap in KNOWLEDGE_EMBEDDING KNOWLEDGE_INTENT KNOWLEDGE_ELIGIBILITY; do
  e="SELLEROPS_${cap}_ENABLED"; o="SELLEROPS_${cap}_ORG_IDS"
  if [[ "${!e:-false}" == "true" ]]; then
    [[ -n "${!o:-}" ]] || fail "$e=true but $o is blank — name the pilot organisation explicitly"
    [[ "${!o}" != "*" ]] || fail "$o=* would send every organisation's customer questions to the vendor"
  fi
done
# `*` means "every organisation on this backend". The three retrieval capabilities above are already
# refused it; the five model capabilities were not, and the asymmetry was not a decision — on a
# multi-tenant pilot host a `*` here points one seller's paid capability at every other seller's data.
# The same hole one level up is SELLEROPS_AGENT_ACCESS_SCOPE=ALL_ORGS, which application.yml itself
# describes as the local single-user posture and warns against on a shared backend.
for cap in AGENT_PLAN AGENT_DRAFT AGENT_JUDGE AGENT_CONVERSE AGENT_REPORT; do
  o="SELLEROPS_${cap}_ORG_IDS"
  [[ "${!o:-}" != "*" ]] || fail "$o=* would admit every organisation on this host"
done
case "${SELLEROPS_AGENT_ACCESS_SCOPE:-ALLOW_LIST}" in
  ALLOW_LIST|CONNECTED_SELLERS) ;;
  ALL_ORGS) fail "SELLEROPS_AGENT_ACCESS_SCOPE=ALL_ORGS is the single-user posture — not a pilot answer" ;;
  *) fail "SELLEROPS_AGENT_ACCESS_SCOPE must be ALLOW_LIST or CONNECTED_SELLERS" ;;
esac

# Forward-only schema, and the rollback is the dump taken below — never an undo script, which this
# repository has never had. `baseline-on-migrate: true` would let a half-restored or hand-built
# database be ASSUMED current: Flyway writes a baseline row, skips every earlier migration, and
# reports success. The shipped default is false; a pilot host does not turn it back on.
case "${SELLEROPS_FLYWAY_BASELINE_ON_MIGRATE:-false}" in
  false) ;;
  *) fail "SELLEROPS_FLYWAY_BASELINE_ON_MIGRATE must be false on a pilot host (a non-empty schema with no history must fail the boot, not be assumed current)" ;;
esac

# The mail mode that writes the whole message — including a password-reset link — into the log at
# INFO. It is a developer outbox, and a pilot host keeps real sellers' reset links out of its logs.
case "${SELLEROPS_MAIL_MODE:-off}" in
  dev-outbox) fail "SELLEROPS_MAIL_MODE=dev-outbox logs full mail bodies (password reset links)" ;;
esac

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

# 3. pre-migration backup — the rollback plan, taken before the thing it rolls back.
#
# Step 5 boots the backend, and the backend runs Flyway. The schema is FORWARD-ONLY: there is no undo
# script for any of the 97 migrations and none will be written after the fact, so "roll back the
# deploy" means "restore this dump and check out the previous commit". A dump taken after the
# migration ran would restore the new schema — i.e. it would not be a rollback at all. The window in
# which it must be taken is therefore exactly here.
#
# Skipped on a host whose database has not been created yet (a first deploy has nothing to lose), and
# on an explicit --no-backup, which exists so a failed deploy can be retried without a second dump of
# the same unchanged data. A dump that FAILS stops the deploy: proceeding would be migrating without
# the rollback the operator thinks they have.
step "3/7 backup (pre-migration)"
if [[ " $* " == *" --no-backup "* ]]; then
  printf 'skipped: --no-backup\n'
elif ! "${COMPOSE[@]}" ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -q '^postgres running'; then
  printf 'skipped: postgres is not running yet (first deploy — no data to lose)\n'
else
  PILOT_ENV_FILE="$ENV_FILE" "$REPO/deploy/pilot/backup.sh" || fail "pre-migration backup failed — not migrating without a rollback point"
  printf 'restore with: deploy/pilot/restore.sh <that file>   (then: git checkout %s && deploy/pilot/deploy.sh --no-pull --no-backup)\n' \
    "$(git -C "$REPO" rev-parse --short HEAD)"
fi

# 4. images
step "4/7 build"
"${COMPOSE[@]}" build --pull

# 5. start — Flyway runs the migrations inside the backend boot; PilotConfigValidator refuses a bad env.
step "5/7 up (migrations run on backend boot)"
"${COMPOSE[@]}" up -d --remove-orphans

# 6. health
step "6/7 health"
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

# 7. smoke
step "7/7 smoke"
PILOT_PUBLIC_HOST="$PILOT_PUBLIC_HOST" "$REPO/deploy/pilot/smoke.sh"
