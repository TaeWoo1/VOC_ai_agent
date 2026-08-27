#!/usr/bin/env bash
# Pilot smoke — Pilot Host Provisioning v1 §13. Read-only, no marketplace credential, no WRITE.
# Usage: PILOT_PUBLIC_HOST=host.example deploy/pilot/smoke.sh
set -uo pipefail
H="${PILOT_PUBLIC_HOST:?}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PILOT_ENV_FILE:-/etc/sellerops/pilot.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO/docker-compose.yml" -f "$REPO/deploy/pilot/docker-compose.pilot.yml")
pass=0; failn=0
ok()   { printf '  ok    %s\n' "$*"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$*"; failn=$((failn+1)); }
code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null || echo 000; }

echo "smoke: https://$H"
[[ "$(code "https://$H/")" == "200" ]]                       && ok "HTTPS frontend 200"            || bad "HTTPS frontend"
[[ "$(code "http://$H/")" =~ ^30[18]$ ]]                     && ok "HTTP → HTTPS redirect"         || bad "HTTP redirect"
[[ "$(curl -sS --max-time 15 "https://$H/health")" == *'"UP"'* ]] && ok "backend /health UP via edge" || bad "backend health"
[[ "$(code "https://$H/agent-runtime/health")" == "200" ]]   && ok "agent-runtime /health via edge" || bad "agent-runtime health"
[[ "$(code "https://$H/agent-runtime/ready")" == "200" ]]    && ok "agent-runtime /ready (backend reachable)" || bad "agent-runtime ready"
[[ "$(curl -sS --max-time 15 "https://$H/api/auth/demo/config")" == *'"enabled":false'* ]] && ok "demo entry OFF" || bad "demo entry must be OFF"
# Cafe24 callback endpoint is routed (a GET with no code is refused by the backend, never 404/502 from the edge).
c="$(code "https://$H/api/connect/cafe24/callback")"; [[ "$c" != "404" && "$c" != "502" && "$c" != "000" ]] && ok "Cafe24 callback route reachable (HTTP $c)" || bad "Cafe24 callback route ($c)"
# Auth-gated API refuses anonymous reads (org isolation floor, not a login test).
[[ "$(code "https://$H/api/inquiries")" =~ ^40[13]$ ]]       && ok "API refuses anonymous"          || bad "API anonymous access"
# Raw ports are not public: from the host they must be closed on the public interface.
for p in 5432 8080 8787 5173; do
  if command -v ss >/dev/null && ss -ltn "( sport = :$p )" | grep -q ":$p"; then bad "port $p is listening on the host"; else ok "port $p not published"; fi
done
# Persistence: the data volume exists and is attached.
docker volume inspect "$(docker volume ls -q | grep -m1 sellerops_pgdata)" >/dev/null 2>&1 && ok "postgres named volume present" || bad "postgres volume"
# Restart policy.
for s in postgres backend agent-runtime frontend edge; do
  rp="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$("${COMPOSE[@]}" ps -q "$s" 2>/dev/null)" 2>/dev/null)"
  [[ "$rp" == "unless-stopped" ]] && ok "$s restart=unless-stopped" || bad "$s restart policy ($rp)"
done
# Startup validator: a refused boot never reaches healthy, so healthy == validator green.
[[ "$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="backend"{print $2}')" == "healthy" ]] && ok "backend validator green (healthy)" || bad "backend not healthy"
# Outbound IP == advertised (only meaningful once NAVER is configured).
"$REPO/deploy/pilot/egress-check.sh" >/dev/null 2>&1 && ok "egress-check: host and container outbound IP agree with ADVERTISED (or NAVER not configured)" || bad "egress-check"
echo "smoke: $pass ok, $failn failed"
echo "browser steps (manual, no credential): signup → disconnected home shows 「판매 채널을 연결하면 시작할 수 있습니다」 → home command 「미답변 문의 보여줘」 returns an object → panel free-text run completes READ-only."
[[ $failn -eq 0 ]]
