# Cafe24 First Connection Tutorial v1 — live onboarding proof (sanitized)

**Date:** 2026-07-31 · **Branch:** `feat/cafe24-first-connection-tutorial-v1` · **Impl commit:** `03c8c22`
**Store:** 전선몰딩 (real Cafe24, operator-driven) · **Environment:** disposable — real `sellerops` DB untouched.

## Scope & approval
Fresh single-use in-turn approval: channel **Cafe24**, store **전선몰딩**, operation **first-connection tutorial only**, operator seated, browser interaction + OAuth consent + **read-only** capability probes + **one** ORDER_SUMMARY sync approved. **No** inquiry/review backfill, **no** reply API, **no** external write, **no** `mall.write_community`. Read-only scopes only (`mall.read_order`, `mall.read_community`).

The operator performed the browser OAuth consent themselves; SellerOps verified every result server-side. No secret value was printed, logged, or stored in the repo.

## Environment
- Backend booted from the tutorial branch against a **fresh disposable DB** `cafe24_tutorial_proof` (Postgres :55432), `cafe24.enabled=true`, Admin-API version `2025-12-01`, scheduler OFF, diagnostic-boards OFF. Secrets (vault master key, app client id/secret, redirect_uri) sourced from the macOS Keychain at boot.
- OAuth callback via the operator's public tunnel; redirect_uri byte-matched the registered Cafe24 app value. Public `/health` returned `{"status":"UP"}`.
- Frontend served the tutorial branch (Vite :5173), real backend (no mocks).

## Baseline (before the run)
`organizations=1, users=1` (disposable test org/user), `channels=13` (CAFE24 present), **`seller_accounts=0`, `connector_credentials=0`, `channel_orders=0`, `order_daily_summaries=0`, `inquiries=0`, `reviews=0`** — a genuine first connection, not a reconnect.

## Browser flow (operator) — all steps completed
소개 → 쇼핑몰 확인 (full `https://…cafe24.com` URL entered, normalized to the bare Mall ID and confirmed) → 권한 안내 (read-only scopes shown; write/reply and the 1:1 board shown as not collected) → **카페24 공식 OAuth 동의** (operator logged into 전선몰딩 and approved) → callback → **연결 검증 자동 재개** (no manual restart needed) → **첫 동기화** (ORDER_SUMMARY, one run) → **완료 화면** → **새로고침 후 완료 상태 복구 확인**.

## Server-side verification (all green)
| Check | Result |
|---|---|
| Seller account created | **exactly 1**, channel CAFE24, `CONNECTED`, api-mode (`is_file_upload=false`) |
| Connector credential created | **exactly 1**, `encryption_key_id=local-dev-1`, payload present, `auth_type=OAUTH2` |
| Credential decryptable | **`decryptable=true`** (boolean gate, no plaintext printed) |
| Seller identity match | **`identityConfirmed=true`** (live authorize returned the mall + authenticated `/boards` read reached it) |
| Order read capability | **AVAILABLE** — derived solely from the latest ORDER_SUMMARY sync-job (SUCCESS) |
| Review board mapping (board 4) | **REVIEW_COLLECT = AVAILABLE** (live board discovery) |
| Inquiry board mapping (board 6) | **INQUIRY_COLLECT = AVAILABLE** (live board discovery) |
| Order ↔ community independence | order from sync history, community from board discovery — separate sources, both AVAILABLE |
| Board 9 (1:1 상담) | **not exposed** — `ONE_TO_ONE_EXCLUDED = NOT_ENABLED`; no board-9 feature emitted (**structural — always excluded by the evaluator, not a live board-9 detection claim**) |
| Inquiry reply (write) | **INQUIRY_REPLY = NOT_ENABLED (READ_ONLY_CONNECTION)** — honest |
| ORDER_SUMMARY first sync | **SUCCESS**, 5/5 rows, trigger MANUAL, `433 ms` |
| OAuth refresh-token rotation | recorded — `last_rotated_at` set, after create (single-use rotation on each authorize) |
| **Cafe24 business-data write** | **0** — no write client exists; no write/`/comments`/auto-reply call in logs; the only sync was a read (ORDER_SUMMARY) |
| Inquiry/review backfill, reply, external send | **0** — no INQUIRY/REVIEW sync job; no reply/send call |
| Secret leak (logs + capability response) | **0** — refresh_token / access_token / client_secret / master key / `code=` / `state=` / `mall_id` / encrypted_payload all 0 hits in backend+frontend logs; capability response validated to sanitized keys + closed vocabulary only |

### Live capability probe (sanitized response)
```
connectionVerified=true  overall=AVAILABLE  reason=null
connectionStatus=CONNECTED  credentialPresent=true  credentialDecryptable=true  identityConfirmed=true  excludedBoardHidden=true
  ORDER_READ           AVAILABLE       (주문 조회)
  INQUIRY_COLLECT      AVAILABLE       (문의 수집)
  REVIEW_COLLECT       AVAILABLE       (리뷰 수집)
  ISSUE_ANALYSIS       AVAILABLE       (운영 이슈 분석)
  INQUIRY_REPLY        NOT_ENABLED     READ_ONLY_CONNECTION  (문의 답변 API — 읽기 전용 연결에서는 미활성화)
  ONE_TO_ONE_EXCLUDED  NOT_ENABLED     (1:1 맞춤상담 게시판은 수집하지 않습니다)
```
`ORDER_READ` is sourced from ORDER_SUMMARY sync history; `REVIEW_COLLECT`/`INQUIRY_COLLECT` from live board discovery; `ISSUE_ANALYSIS` is **derived** (review AVAILABLE ∧ inquiry AVAILABLE), not an independently probed capability; `INQUIRY_REPLY`/`ONE_TO_ONE_EXCLUDED` are structural `NOT_ENABLED`. The response carries no mall id, token, board name, or personal data — the mall's identity is reported only as `identityConfirmed`.

## Timings (from server evidence)
- Account create (`/start`) → credential stored (OAuth consent + callback round-trip): **~7 s** (operator was staged).
- ORDER_SUMMARY first sync: **433 ms** (5 rows).
- Verification + first sync completed within seconds of the callback; no manual restart between callback and verify.

## Credential rotation vs business-data write (explicit distinction)
- **Rotation (allowed, recorded):** each `authorize` refreshes the single-use Cafe24 refresh token and persists the replacement (`last_rotated_at` advances). This is a credential-store update in *our* vault, not a write to Cafe24.
- **Business-data write (must be 0):** SellerOps never POSTed to Cafe24 (no comment/reply/community-write). The 5 `order_daily_summaries` rows are *our* normalized storage of data **read** from Cafe24 via the approved ORDER_SUMMARY sync — not a write to the marketplace.

## Blocker found & fixed
- **Stale local API port.** The browser login failed initially because `frontend/.env.local` (gitignored) pinned `VITE_API_BASE_URL=http://127.0.0.1:18090` from a prior run, so the SPA called a dead port. The backend, login, and CORS were all healthy via direct calls. Fix: pointed `.env.local` at the running backend (`http://localhost:8080`) and restarted Vite; the operator then completed the flow. No product code changed; the browser flow was re-run from login. (Original value noted for restore at teardown.)

## Out of scope / not proven here
- No write scope, no reply/comment API, no Guided Handoff exercised. INQUIRY/REVIEW content was **not** collected (mapping proven as AVAILABLE via board discovery only). Order amounts/dates are intentionally not reproduced in this doc.

## Independent review
0 HIGH / 0 MEDIUM on both this doc and the code diff vs `main`. Non-blocking LOW recorded: if a `status=connected` callback ever reached the tutorial with a null `accountId`, the verify step would strand (no spinner, no false success — fails safe; recovery via "채널 연결로 돌아가기"). In practice `/start` always returns the account id, so the path is not reachable in the proven flow; left as a follow-up.

## Teardown
Live backend + frontend stopped after capture; disposable DB `cafe24_tutorial_proof` retained in proof state for the record; real `sellerops` DB and `cafe24_phaseb` untouched; `.env.local` restored to its prior value.
