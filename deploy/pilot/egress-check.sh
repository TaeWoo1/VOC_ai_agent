#!/usr/bin/env bash
# NAVER fixed egress proof — Pilot Host Provisioning v1 §7.
# Both the host and the backend container must leave through the Elastic IP, and that must equal
# what the product tells sellers to register (SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS).
# Read-only: two outbound HTTPS GETs to AWS's public IP echo. Never prints anything else.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" -f "$REPO/deploy/pilot/docker-compose.pilot.yml")
ECHO_URL="https://checkip.amazonaws.com"
host_ip="$(curl -4 -sS --max-time 10 "$ECHO_URL" | tr -d '[:space:]')"
# The backend image is a JRE image without curl; use the JVM's own resolver path through a tiny Java call
# is heavier than needed — the container shares the host's default route, so probe from a throwaway
# container on the same compose network instead.
net="$("${COMPOSE[@]}" ps -q backend | head -1 | xargs -r docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
container_ip="$(docker run --rm --network "${net:-bridge}" curlimages/curl:8.8.0 -4 -sS --max-time 10 "$ECHO_URL" | tr -d '[:space:]')"
advertised="$(grep -E '^SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')"
printf 'host outbound      : %s\ncontainer outbound : %s\nadvertised (env)   : %s\n' "$host_ip" "$container_ip" "${advertised:-<blank>}"
[[ -n "$host_ip" && "$host_ip" == "$container_ip" ]] || { echo "FAIL: host and container egress differ or unknown"; exit 1; }
if [[ -n "$advertised" ]]; then
  [[ ",$advertised," == *",$host_ip,"* ]] || { echo "FAIL: actual egress $host_ip is not in ADVERTISED"; exit 1; }
  echo "ok: actual == advertised"
else
  echo "ok: egress consistent; ADVERTISED not set yet (NAVER not configured)"
fi
