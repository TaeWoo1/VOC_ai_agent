#!/usr/bin/env bash
# Pilot preflight — Pilot Launch Readiness v1 §3. Run BEFORE the first deploy, on the host.
#
#   PILOT_ENV_FILE=/etc/sellerops/pilot.env deploy/pilot/preflight.sh
#
# The checklist as something that runs, rather than something an operator reads and believes they did.
# It checks only what is checkable WITHOUT the stack being up, because that is when its answers are
# still cheap: a wrong host name costs a certificate rate-limit, and a wrong Cafe24 redirect URI is
# not discovered until a real seller is standing in front of a consent screen.
#
# Read-only. Starts nothing, writes nothing, creates no cloud resource, prints no secret — for every
# secret it prints only whether the NAME has a value.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
pass=0; failn=0; warn=0
ok()   { printf '  ok    %s\n' "$*"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$*"; failn=$((failn+1)); }
note() { printf '  note  %s\n' "$*"; warn=$((warn+1)); }
set_() { [[ -n "${!1:-}" ]]; }

echo "preflight: $ENV_FILE"

# ── 1. the env file itself ───────────────────────────────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then ok "env file exists"; else bad "env file not found (copy deploy/pilot/pilot.env.example)"; fi
perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null)"
[[ "$perm" == "600" || "$perm" == "400" ]] && ok "env file mode $perm" || bad "env file must be 0600 (is ${perm:-unknown})"
case "$ENV_FILE" in "$REPO"/*) bad "env file is INSIDE the checkout — a pilot secret must never be one git add away";; *) ok "env file is outside the checkout";; esac
set -a; [[ -f "$ENV_FILE" ]] && . "$ENV_FILE"; set +a

# ── 2. the values a deploy cannot invent ─────────────────────────────────────────────────────────
for n in PILOT_PUBLIC_HOST PILOT_ACME_EMAIL POSTGRES_PASSWORD SELLEROPS_JWT_SECRET; do
  set_ "$n" && ok "$n is set" || bad "$n is blank"
done
[[ "${SELLEROPS_JWT_SECRET:-}" != change-me* ]] && ok "JWT secret is not the repository placeholder" || bad "JWT secret is the repository placeholder"
[[ ${#SELLEROPS_JWT_SECRET} -ge 32 ]] && ok "JWT secret length ≥ 32" || bad "JWT secret shorter than 32 characters"

# ── 3. the public name — DNS before ACME ─────────────────────────────────────────────────────────
# Let's Encrypt rate-limits failures. Resolving the name first is the difference between "fix a typo"
# and "wait an hour to try again".
H="${PILOT_PUBLIC_HOST:-}"
if [[ -n "$H" ]]; then
  case "$H" in localhost|127.0.0.1|*.local) bad "PILOT_PUBLIC_HOST is a development name ($H)";; *) ok "PILOT_PUBLIC_HOST is a real name";; esac
  [[ "$H" != *"://"* && "$H" != *"/"* ]] && ok "PILOT_PUBLIC_HOST is a bare host name" || bad "PILOT_PUBLIC_HOST must have no scheme and no path"
  dns="$(getent hosts "$H" 2>/dev/null | awk '{print $1}' | head -1)"
  [[ -z "$dns" ]] && dns="$(dig +short A "$H" 2>/dev/null | tail -1)"
  if [[ -n "$dns" ]]; then
    ok "DNS: $H → $dns"
    mine="$(curl -4 -sS --max-time 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]')"
    if [[ -n "$mine" ]]; then
      [[ "$dns" == "$mine" ]] && ok "DNS points at THIS host ($mine)" \
        || bad "DNS points at $dns but this host leaves through $mine — ACME will fail and the Cafe24 callback will not arrive here"
    else
      note "could not determine this host's outbound address; DNS target unverified"
    fi
  else
    bad "DNS does not resolve $H — create the A record before deploying (ACME rate-limits failures)"
  fi
  # :80 and :443 must be free for the edge, and reachable from outside for the HTTP-01 challenge.
  for p in 80 443; do
    if command -v ss >/dev/null && ss -ltn "( sport = :$p )" 2>/dev/null | grep -q ":$p"; then
      bad "port $p is already in use on this host — the edge cannot bind it"
    else ok "port $p is free for the edge"; fi
  done
  note "reachability of :80 / :443 FROM THE INTERNET is a security-group/firewall fact this script cannot see; confirm it before the first deploy"
fi

# ── 4. Cafe24-only posture (2026-09-13 decision) ─────────────────────────────────────────────────
if [[ "${SELLEROPS_CONNECTOR_NAVER_ENABLED:-false}" == "true" ]]; then
  note "NAVER is ON — this is no longer a Cafe24-only pilot; a fixed outbound IPv4 IS required (run egress-check.sh)"
  set_ SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS && ok "advertised call IP is set" || bad "NAVER on but no advertised call IP"
else
  ok "NAVER OFF — a fixed outbound IPv4 is NOT a prerequisite of this pilot"
fi
if [[ "${SELLEROPS_CONNECTOR_CAFE24_ENABLED:-false}" == "true" ]]; then
  set_ SELLEROPS_CONNECTOR_CAFE24_CLIENT_ID && set_ SELLEROPS_CONNECTOR_CAFE24_CLIENT_SECRET \
    && ok "Cafe24 app credentials are set" || bad "Cafe24 on but CLIENT_ID / CLIENT_SECRET blank"
  set_ SELLEROPS_VAULT_MASTER_KEY && ok "vault master key is set" || bad "a connector is on but SELLEROPS_VAULT_MASTER_KEY is blank"
  uri="${SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI:-https://$H/api/connect/cafe24/callback}"
  [[ "$uri" == "https://$H/api/connect/cafe24/callback" ]] && ok "redirect URI is this host's callback" \
    || bad "redirect URI ($uri) is not this host's callback"
  printf '\n  ── REGISTER THIS EXACT STRING in the Cafe24 app (byte-identical, no trailing slash):\n     %s\n\n' "$uri"
else
  note "Cafe24 connector is OFF — turn it on once the app is registered with the URI printed by this script"
fi

# ── 5. clean data: nothing on this host may manufacture rows ─────────────────────────────────────
for n in SELLEROPS_SEED_ENABLED SELLEROPS_SEED_DEMO_CONTENT SELLEROPS_CONNECTOR_MOCK_ENABLED SELLEROPS_CONNECTOR_MOCK_FALLBACK_ENABLED; do
  [[ "${!n:-false}" == "false" ]] && ok "$n=false" || bad "$n must be false on a pilot host"
done
[[ "${SELLEROPS_MAIL_MODE:-off}" != "dev-outbox" ]] && ok "mail mode is not the developer outbox" || bad "SELLEROPS_MAIL_MODE=dev-outbox logs password-reset links"

# ── 5-A. routine collection actually runs (Pilot Readiness v3 §1-3 · blocker B3) ─────────────────
# Two halves: self-pilot CREATES the schedules, the collect poller EXECUTES them. Only the first and
# the schedules sit due forever while the connect-result screen promises automatic collection. This
# is the cheapest possible moment to learn it — before an image is built, and long before a seller
# connects a store and waits for data that is never coming.
if [[ "${SELLEROPS_SELF_PILOT_ENABLED:-false}" == "true" ]]; then
  [[ "${SELLEROPS_COLLECT_SCHEDULER_ENABLED:-false}" == "true" ]] \
    && ok "routine collection: self-pilot creates schedules and the collect poller runs them" \
    || bad "SELLEROPS_SELF_PILOT_ENABLED=true but SELLEROPS_COLLECT_SCHEDULER_ENABLED is not true — schedules would be created and never executed"
  case "${SELLEROPS_SELF_PILOT_SCOPE:-ALLOW_LIST}" in
    CONNECTED_SELLERS) ok "self-pilot scope CONNECTED_SELLERS — a new seller is picked up without an env edit" ;;
    ALLOW_LIST)
      [[ -n "${SELLEROPS_SELF_PILOT_ORG_IDS:-}" ]] \
        && ok "self-pilot scope ALLOW_LIST with named organisations" \
        || bad "self-pilot scope ALLOW_LIST with SELLEROPS_SELF_PILOT_ORG_IDS blank collects for nobody" ;;
    LOCAL_SINGLE_USER) bad "self-pilot scope LOCAL_SINGLE_USER is the local single-user posture, not a pilot answer" ;;
    *) bad "SELLEROPS_SELF_PILOT_SCOPE must be CONNECTED_SELLERS or ALLOW_LIST" ;;
  esac
else
  note "self-pilot is OFF — no routine collection will be scheduled on this host"
fi

# ── 6. schema safety (§1) ────────────────────────────────────────────────────────────────────────
[[ "${SELLEROPS_FLYWAY_BASELINE_ON_MIGRATE:-false}" == "false" ]] && ok "baseline-on-migrate is false" \
  || bad "SELLEROPS_FLYWAY_BASELINE_ON_MIGRATE must be false (a half-restored schema must fail the boot, not be assumed current)"
d="${PILOT_BACKUP_DIR:-/var/backups/sellerops}"
[[ -d "$d" ]] && ok "backup directory $d exists" || bad "backup directory $d does not exist (host-bootstrap.sh creates it) — deploy.sh takes the pre-migration dump there"
[[ -w "$d" ]] 2>/dev/null && ok "backup directory is writable" || note "backup directory not writable as this user (deploy.sh runs as root)"
# BLOCKER, not a note (blocker B5, item B5-1). Without a schedule the ONLY dump this host ever takes
# is deploy.sh's pre-migration one — a dump per deploy, on a host that may not be deployed for weeks,
# and never copied off the host because `--local-only` is exactly what that dump is. «Backups exist»
# and «a backup ran today» are different claims, and only the second one is worth anything in March.
#
# The schedule is a systemd timer, not cron (2026-09-26): Ubuntu 24.04's default cron cannot be relied
# on for per-job timezone scheduling, and this host's own zone is not set by this repository. What is
# checked here is the whole contract — the units exist, the timer is enabled, systemd can load it, and
# its calendar is the 03:17 Asia/Seoul one. A timer that exists but is disabled, or one whose calendar
# has drifted to the host's zone, fires at the wrong hour and looks installed either way.
# The unit directory is a seam for deploy/pilot/backup-guard.test.sh, exactly as PILOT_ENV_FILE and
# PILOT_BACKUP_DIR already are. The default is the canonical one; an operator on a pilot host never
# sets it.
UNIT_DIR="${PILOT_SYSTEMD_DIR:-/etc/systemd/system}"
SVC="$UNIT_DIR/sellerops-backup.service"
TMR="$UNIT_DIR/sellerops-backup.timer"
LEGACY_CRON="${PILOT_CRON_DIR:-/etc/cron.d}/sellerops-backup"
CAL='*-*-* 03:17:00 Asia/Seoul'
if command -v systemctl >/dev/null 2>&1; then
  [[ -f "$SVC" && -f "$TMR" ]] && ok "backup units installed" \
    || bad "sellerops-backup.service/.timer are NOT installed — run deploy/pilot/install-backup-job.sh; until then the only dump this host takes is the pre-migration one, and it is --local-only by design"
  [[ "$(systemctl is-enabled sellerops-backup.timer 2>/dev/null)" == "enabled" ]] \
    && ok "backup timer is enabled" \
    || bad "sellerops-backup.timer is not enabled — an installed unit that nothing starts is not a schedule"
  [[ "$(systemctl show sellerops-backup.timer -p LoadState --value 2>/dev/null)" == "loaded" ]] \
    && ok "systemd can load the backup timer" \
    || bad "systemd cannot load sellerops-backup.timer (LoadState is not 'loaded') — check systemctl status sellerops-backup.timer"
  # Read from the unit rather than from `systemctl show -p TimersCalendar`, whose rendering of the zone
  # differs across versions: the contract is the string this repository writes.
  grep -qsF "OnCalendar=$CAL" "$TMR" && ok "timer calendar is 03:17 Asia/Seoul (zone named in the unit)" \
    || bad "sellerops-backup.timer does not carry OnCalendar=$CAL — without the zone it fires in the host's own timezone (UTC on this image, i.e. 12:17 in Seoul)"
  grep -qsF "Persistent=true" "$TMR" && ok "timer is Persistent (a run missed while the host was off is made up)" \
    || bad "sellerops-backup.timer is not Persistent=true — a night the host was off is silently skipped"
  grep -qsF "Environment=TZ=Asia/Seoul" "$SVC" && ok "backup service runs with TZ=Asia/Seoul (the dump filename)" \
    || bad "sellerops-backup.service does not set TZ=Asia/Seoul — the dump's name would disagree with the hour it ran at"
  # The earlier cron file and the timer would both fire: two nightly dumps, one of them at the wrong hour.
  [[ -e "$LEGACY_CRON" ]] \
    && bad "$LEGACY_CRON still exists beside the timer — TWO nightly dumps of the same database; remove that one file" \
    || ok "no legacy backup cron file beside the timer"
  note "next firing is observable with: systemctl list-timers sellerops-backup.timer (this script does not start the job — a timer that fires is not proof that an upload succeeds)"
else
  bad "systemctl not found — the pilot host contract is Ubuntu 24.04 with systemd, and the backup schedule is a systemd timer"
fi

# ── 6-A. off-host backup (blocker B5) ────────────────────────────────────────────────────────────
# A dump that only ever exists on this host does not survive this host. Checked here because every
# one of these is knowable before anything is built, and the alternative is learning it from a cron
# job at 03:17 — or, worse, from the day the host is gone.
if [[ "${SELLEROPS_BACKUP_S3_ENABLED:-false}" == "true" ]]; then
  ok "off-host backup is ON"
  miss=()
  for n in SELLEROPS_BACKUP_S3_BUCKET SELLEROPS_BACKUP_S3_REGION \
           SELLEROPS_BACKUP_S3_ACCESS_KEY_ID SELLEROPS_BACKUP_S3_SECRET_ACCESS_KEY; do
    [[ -n "${!n:-}" ]] || miss+=("$n")
  done
  [[ ${#miss[@]} -eq 0 ]] && ok "off-host backup: every required value is set" \
    || bad "SELLEROPS_BACKUP_S3_ENABLED=true but these are blank: ${miss[*]}"
  # An endpoint is optional (AWS S3 needs none) but, when given, must be a URL the signer can use.
  if [[ -n "${SELLEROPS_BACKUP_S3_ENDPOINT:-}" ]]; then
    case "${SELLEROPS_BACKUP_S3_ENDPOINT}" in
      https://*) ok "off-host endpoint is HTTPS" ;;
      http://*)  bad "SELLEROPS_BACKUP_S3_ENDPOINT is plain HTTP — the dump carries sealed credentials and seller data" ;;
      *)         bad "SELLEROPS_BACKUP_S3_ENDPOINT must be an absolute URL" ;;
    esac
  fi
else
  # Was a note. deploy.sh now refuses this host outright, so a preflight that merely mentions it would
  # be telling the operator they are ready for a deploy that is about to stop.
  bad "SELLEROPS_BACKUP_S3_ENABLED is not true — a dump that only exists on this host does not survive this host (blocker B5); deploy.sh refuses to deploy in this state"
fi
# The uploader is the AWS CLI, and it is checked whichever way the flag went: an off-host copy this
# host cannot perform is not an off-host copy, and turning the flag off does not make the CLI less
# required — it only moves the moment the absence is discovered to the night it matters.
command -v aws >/dev/null 2>&1 && ok "aws cli present (the off-host uploader)" \
  || bad "the aws cli is not installed — nothing on this host can upload a dump (deploy/pilot/host-bootstrap.sh installs AWS CLI v2)"
# Retention belongs to the bucket, and the credential is PutObject-only — neither is checkable from
# here without a read grant this deliberately does not have. Said, so it is not assumed.
note "off-host retention (30d) is the BUCKET's lifecycle policy, and the credential must be PutObject-only — neither is verifiable from this host by design"
note "the off-host copy of SELLEROPS_VAULT_MASTER_KEY is what makes a dump restorable — keep it OUTSIDE this bucket; only the restore rehearsal on a NEW host proves it"
# What this section does NOT prove: that an upload actually succeeds. That needs one real PutObject
# against the real bucket with the real credential, and it is a separate package (B5-2) — every check
# above is an env value or a binary on PATH, which is exactly as far as a read-only preflight reaches.

# ── 7. the host can actually build and run this ──────────────────────────────────────────────────
command -v docker >/dev/null && ok "docker present" || bad "docker not installed (host-bootstrap.sh)"
docker compose version >/dev/null 2>&1 && ok "docker compose plugin present" || bad "docker compose plugin missing (the overlay needs ≥ 2.24 for '!reset')"
free_kb="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)"
if [[ -z "$free_kb" ]]; then note "could not read total RAM (not a Linux host?) — unverified"
elif [[ "$free_kb" -ge 3500000 ]]; then ok "RAM ≥ 4 GB"
else note "less than 4 GB RAM — the Gradle image build peaks above 2 GB; keep the swap host-bootstrap.sh adds"; fi

printf '\npreflight: %s ok, %s failed, %s notes\n' "$pass" "$failn" "$warn"
echo "next: deploy/pilot/deploy.sh   (env → pre-migration dump → build → migrate → health → smoke)"
[[ $failn -eq 0 ]]
