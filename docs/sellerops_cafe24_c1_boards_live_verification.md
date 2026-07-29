# Cafe24 Phase C1 — board-discovery live verification (refresh + rotation + /boards)

Records the one-time supervised live run that proved the Cafe24 read-path
**credential refresh + single-use rotation write-back** and a **read-only board
discovery**, via the committed, double-gated `Cafe24BoardDiagnosticRunner`. The
connector ships flag-off; this run used a dev backend + disposable dev DB with
`sellerops.connector.cafe24.enabled=true`, the diagnostic flag on, the scheduler
**off**, and read-only scopes (`mall.read_order,mall.read_community`). Evidence is
sanitized: board metadata, booleans, and coarse categories only — no `mall_id`,
tokens, credential payload, client id/secret, order/article/product data.

## Environment

- Disposable Postgres (`cafe24_phaseb`), a separate credential namespace, scheduler off.
- One registered SellerOps Cafe24 app (server config), reused; per-mall host + tokens
  from the vault. Pilot mall: 전선몰딩 (public store name only; the raw mall_id is never recorded).
- Diagnostic is double-gated (`cafe24.enabled` **and** `cafe24.diagnostic.boards.enabled`)
  and inert unless an account-id is set — it cannot run on a normal bootRun.

## Credential re-establishment (prerequisite)

An initial C1 attempt returned `REFRESH_ROTATION=FAIL` on a stale credential. The
credential was re-established by re-running the OAuth authorization-code flow on the
same backend (same vault master key + app client id/secret), then C1 was re-run.

- After OAuth reconnect: account **CONNECTED**; credential row **overwritten in place**
  (`created_at` preserved, `updated_at` advanced) — **exactly one** row, **no duplicate**;
  encrypted payload present.

## Outcome — PASS

Exactly one refresh grant + one `GET /api/v2/admin/boards` (metadata only).

| check | result |
|---|---|
| `REFRESH_ROTATION` | **PASS** — refresh grant succeeded via the shared `Cafe24Authorizer` seam |
| rotation write-back | **persisted** — single-use rotation wrote the replacement back; rotation timestamp advanced; `updated_at` advanced |
| credential row count | **1** (no duplicate; existing row rotated in place) |
| `/boards` calls | **1** (read-only, metadata only) |
| order / article / product API | **not called** |

### Board discovery + mapping (sanitized)

| board_no | board name | classification | collection |
|---|---|---|---|
| 4 | 구매후기 | REVIEW_BEARING | included (REVIEW) |
| 6 | 문의사항 | INQUIRY_BEARING | included (INQUIRY) |
| 9 | 1:1 맞춤상담 | INQUIRY_BEARING | **excluded** — `BOARD_9_ONE_TO_ONE_PII` |
| 1, 2, 3, 5, 7, 8, 101, 1001, 1002, 3001 | 공지/뉴스·이벤트/이용안내 FAQ/자유게시판/자료실/이벤트/상품자유게시판/한줄메모/자유게시판2·3 | OTHER | not collected |

- **hardcoded review board = 4** → **match** (구매후기).
- **hardcoded inquiry board = 6** → **match** (문의사항).
- **`BOARD_MAPPING_MATCH`** — 전선몰딩's real board layout matches the connector's hardcoded
  runtime mapping (`Cafe24BoardArticleMapper`: REVIEW→4, INQUIRY→6), and board 9 (1:1, PII)
  is correctly excluded.

## What this establishes

- Live-proven end-to-end for this mall: credential refresh + single-use rotation write-back
  (the load-bearing invariant), and read-only board discovery.
- REVIEW (board 4) / INQUIRY (board 6) are **not** fail-closed for 전선몰딩 — the discovered
  mapping equals the hardcoded runtime mapping, so a later REVIEW/INQUIRY collection phase may
  proceed for this mall (still subject to its own approval and PII handling; board 9 stays excluded).
- The runtime board mapping was **compared, never mutated**; the diagnostic changes no product
  behavior.

## Boundary / honesty

- One-time supervised diagnostic run on a disposable env; the runner is committed and
  reproducible (double-gated), but no committed test hits live Cafe24 — CI evidence stays synthetic.
- Not covered here: ORDER_SUMMARY collection (Phase C2 —
  `docs/sellerops_cafe24_c2_order_summary_live_verification.md`; the `ORDER_PAGE_LIMIT` vs
  documented-max question is resolved there, `ORDER_PAGE_LIMIT=100`), and REVIEW/INQUIRY article
  collection.
