# tools/self-pilot — Self-Pilot Runtime v1 operator tools

Canonical: `docs/self_pilot_runtime_v1.md` (design, recovery matrix, honest gaps) ·
`docs/demo_runbook_v1.md` §0.2 (the procedure) · `docs/sellerops_live_approval_contract.md` §6a (the
standing READ grant) · `docs/product-scope-v1.md` v1.9 (the decision).

| File | Purpose |
|---|---|
| `mint-read-grant.sh` | Prints one `SELLEROPS_SELF_PILOT_READ_GRANT_ID=spr-<hex>` line for `backend/.env.local`. Writes nothing. Opens READ gates only. |
| `agent-supervisor.sh` | Keeps one routine READ carrier of the local agent resident: `start [naver-import\|coupang-locate] [-d]` · `stop` · `status` · `switch <carrier>` · `logs`. Restart-on-crash with backoff; boot refusals are not retried; first pairing in the foreground. |
| `self-pilot.env.example` | Names of the agent env (self-pilot org credentials, URLs). Copy to `.run/self-pilot.env` (gitignored) and fill. |
| `.run/` | Operator-owned env + supervisor state. Never committed; never printed. |

Backend env names (values are the operator's): `SELLEROPS_SELF_PILOT_ENABLED`, `SELLEROPS_SELF_PILOT_ORG_IDS`,
`SELLEROPS_SELF_PILOT_READ_GRANT_ID`, `SELLEROPS_SELF_PILOT_DEFAULT_INTERVAL_MINUTES`,
`SELLEROPS_SELF_PILOT_TRIAGE_AUTO_ENABLED` / `_TRIAGE_PER_TICK` / `_TRIAGE_PER_DAY`, plus
`SELLEROPS_COLLECT_SCHEDULER_ENABLED=true` and the connector/vault names of the runbook.

Nothing in this directory can perform or schedule a marketplace WRITE.
