# Cafe24 Board-6 Reply API Capability Spike v1 — contract audit & spike design

**Date:** 2026-07-31 · **Branch:** `spike/cafe24-board6-reply-api-v1` (from `main` @ `b56bf1e`)
**Status:** preparation only — audit + isolated spike code + synthetic tests + review + local commit.
**No** live Cafe24 call, **no** OAuth re-consent, **no** Developer-Console scope change, **no** test-inquiry
creation, **no** comment POST/GET, **no** article PUT/DELETE, **no** push/PR in this unit.

The spike answers three questions against ONE controlled board-6 test inquiry, later, under a fresh
single-use approval: **(1)** does the official comments API create a comment, **(2)** does the
article's `reply_status` flip to `C`, **(3)** can a re-run safely avoid a duplicate comment.

---

## 1. Official contract audit

### 1.1 What is confirmed (from developers.cafe24.com, Admin API)
| Operation | Method + path | Scope |
|---|---|---|
| Create a comment | `POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments` | **`mall.write_community`** |
| List comments | `GET /api/v2/admin/boards/{board_no}/articles/{article_no}/comments` | `mall.read_community` |
| Delete a comment | `DELETE /api/v2/admin/boards/{board_no}/articles/{article_no}/comments/{comment_no}` | `mall.write_community` |
| Retrieve a post | `GET /api/v2/admin/boards/{board_no}/articles/{article_no}` | `mall.read_community` |
| Update a post | `PUT /api/v2/admin/boards/{board_no}/articles/{article_no}` | `mall.write_community` |

The version is pinned with `X-Cafe24-Api-Version: 2025-12-01` on every `/api/v2/admin/*` call (the
existing connector already enforces this fail-closed on a blank version).

### 1.2 Comment create request envelope (working contract)
Cafe24's Admin write endpoints wrap the payload in `{"shop_no": 1, "request": { … }}`. The comment
`request` object carries the operator-stated required fields:

```json
{ "shop_no": 1, "request": { "content": "<본문>", "writer": "<표시명>", "password": "<비밀번호>" } }
```

- **`content`, `writer`, `password`** are the required create fields (operator-provided + Cafe24's
  non-member comment convention: an admin-authored board comment supplies a `writer` display name and
  a `password`).
- **Confidence:** the *endpoint/method/scope* are confirmed from the docs; the exact envelope wrapper
  and the full optional-field list could **not be machine-extracted** (the developer docs are a
  JS-rendered SPA — the property tables did not render to text). The envelope above is the Cafe24 admin
  write convention and matches the operator's stated field set; the spike must **confirm the exact
  wrapper live** against version `2025-12-01` on the first attempt and HALT on any field mismatch
  (a mismatch is a verdict-C signal, never a silently-retried guess).

### 1.3 `reply_status` observation & the article-PUT question
- The article resource carries `reply_status`. Cafe24's official tokens (already normalized in our
  `CommunityReplyStatus`): **`N`** 답변전 → PENDING, **`P`** 처리중 → IN_PROGRESS, **`C`** 처리완료 →
  ANSWERED. Only `N` is live-observed to date; `P`/`C` are doc-asserted.
- **Whether creating an admin comment auto-transitions `reply_status` → `C` is UNVERIFIED** — this is
  precisely the spike's live question (verdict A vs B). It is board-configuration dependent and not
  guaranteed by the API contract.
- The article-**update** `PUT` *can* set `reply_status` directly (doc-asserted). **The spike never
  calls it.** If the comment lands but the status does not become `C` (verdict **B**), the spike HALTs
  and only *reports* that a separate official status-update step would be required — it does not PUT.
- **reply_status observation method:** GET the single article (`/articles/{article_no}`), read its
  `reply_status`, and classify it to the closed token set `N/P/C/OTHER` before and after the post.

### 1.4 Article re-fetch / safe list
Single-article retrieve (`GET /articles/{article_no}`) is used to observe status; the transport parses
`{"article":{…}}` and falls back to `{"articles":[…]}[0]`. Comment existence is read via the comments
GET, not an article list scan — so no board-wide article listing is performed.

---

## 2. Spike-only OAuth boundary (repository facts)

- **Production onboarding scope is read-only and cannot request write.**
  `application.yml` default `mall.read_community,mall.read_order`; `Cafe24OnboardingService` **throws at
  construction if the scope string contains `"write"`** (`Cafe24OnboardingService.java:96-99`). The
  tutorial's read-only scope and UX are therefore untouched by this spike.
- **The spike consents on a separate path.** The comment POST needs `mall.write_community`, which the
  production refresh token structurally never has (`Cafe24Authorizer.authorize` refreshes the stored
  read-only grant). The spike requests **read + write** at its *own* consent, against a **disposable
  spike credential** in a disposable DB — the production credential is never opened or overwritten.
- **Granted-scope verification.** The production token DTOs drop the `scope`/`scopes` field
  (`@JsonIgnoreProperties`). The spike adds `SpikeTokenClient`, which parses that field and exposes
  **only booleans** (`SpikeGrantedScope.writeCommunityGranted(...)`), never the raw scope string. If
  `mall.write_community` was not granted, the spike **fails closed** (verdict C, zero network write).
- **No production configuration change.** The spike is wired in its own flag-gated configuration and
  reuses the vetted `Cafe24HttpClient` GET boundary; it does not widen the production HTTP interface or
  touch onboarding scope config.

---

## 3. Operator-gated spike package (what was built)

Isolated package `com.sellerops.connector.cafe24.spike` (backend), plus the operator runbook
`tools/cafe24-reply-spike/README.md`. It is **not** the production reply pipeline and is not reachable
on a normal boot.

**Decision engine — `SpikeReplyEngine`** (fully unit-tested). Ordered, fail-closed gates:
1. **Idempotency** (`commandId`): identical replay returns the prior result unchanged; same id +
   different payload → `REFUSED_COMMAND_CONFLICT`.
2. **Dry-run** short-circuit → zero external calls.
3. **Write scope** granted? else `REFUSED_WRITE_SCOPE_NOT_GRANTED` (verdict **C**).
4. **Board == 6** else `REFUSED_WRONG_BOARD` (board 9 can never be a target).
5. **Operator-owned test article** confirmed else `REFUSED_NOT_TEST_ARTICLE`.
6. **Content** resolved — fixed harmless phrase, or an operator override rejected fail-closed on
   e-mail / long-digit-run (phone/order) / empty.
7. **Single-use approval** present + matching + unconsumed, **checked before any network call**.
8. **Pre-status raw `N`** (read) else `REFUSED_PRECONDITION_STATUS_NOT_N`.
9. **No prior spike comment** (read; own fixed writer marker) else `REFUSED_DUPLICATE_EXISTING_COMMENT`.
10. **Exactly one comment POST**; then re-list (must be exactly +1 spike comment, else HALT with no
    retry/PUT) and re-observe `reply_status`.

**Transport — `SpikeReplyTransport` / `JdkSpikeReplyTransport`.** A *separate* seam (the production
`Cafe24HttpClient` has only form-POST + GET). Three operations only: observe one article, list its
comments, create one comment. **No update/delete method exists** — the spike cannot PUT `reply_status`
or delete a comment. Reads reuse the production `Cafe24HttpClient` (pinned version header); the single
JSON POST carries the same version header.

**Live wiring — triple-gated.** `Cafe24ReplySpikeConfiguration` exists only when
`sellerops.connector.cafe24.spike.reply.enabled=true` (on top of the connector flag). Default behavior
of `Cafe24ReplySpikeRunner` is inert-safe: log the dry-run plan and (if a spike account is configured)
a **read-only** readiness probe (granted-scope boolean + current `reply_status` token + comment count).
The comment POST fires ONLY when the operator additionally sets `...execute-write=true` **and** supplies
a matching single-use `...approval` value — and every engine gate still applies.

---

## 4. Judgment contract (§4)
| Live observation | Verdict |
|---|---|
| comment created **and** `reply_status = C` | **A — `API_REPLY_PRIMARY_CANDIDATE`** (comments API is a candidate primary reply path) |
| comment created **but** status stays `N`/`P`/blank | **B — `COMMENT_OK_STATUS_UNCHANGED_HALT`** (do NOT auto-PUT; report separate status-update possibility only) |
| comment create rejected / field mismatch / write scope not granted | **C — `GUIDED_HANDOFF_REMAINS`** (keep Guided Handoff as the primary route) |

Operational refusals (wrong board, not-test, missing approval, duplicate, pre-status not N),
dry-runs, and transport HALTs carry verdict **NONE** — they draw no capability conclusion.

---

## 5. Safety boundary (§5) — how each rule is enforced
- Real customer inquiry **never** used → board-6 only + operator-confirmed test article + pre-status `N`.
- Test content carries no PII/order/contact → fixed harmless phrase, or operator override fail-closed
  on e-mail / long-digit-run / empty.
- First live write = **exactly one** comment POST → single POST, then verify count delta is exactly 1.
- **No DELETE / PUT / reply-retry** → transport has no such method; a surprise HALTs with no follow-up.
- No order/product/review API → transport only touches board-6 article + its comments.
- No SellerOps production DB → disposable DB + disposable spike account/credential.
- Existing read-only credential unchanged → spike opens only the spike credential.
- Output is counts / booleans / closed-vocabulary status tokens (`N/P/C/OTHER`) + the verdict —
  never a token, mall id, comment body, writer value, or password (password is `SecureRandom`,
  memory-only, zeroed after use).

---

## 6. Offline verification (synthetic)
Backend gate **1890/0/0** (6 skipped); **50** new spike tests:
- `SpikeReplyEngineTest` (22): board ≠ 6 / board 9 rejected; non-test rejected; no-write-scope → C;
  pre-status ≠ N refused; missing/mismatched approval refused (0 calls); dry-run execute + `plan()`
  make 0 external calls; duplicate spike comment refused; **commandId replay = no second POST**; same
  id + different payload rejected; **single-use approval not reusable**; create + `C` → A; create +
  `N`/`P`/blank → B; create rejected → C; transport error on observe/create → HALT (create attempted
  once, never retried); unexpected comment count → HALT (no PUT); **result leaks no secret/content**.
- `SpikeGrantedScopeTest` (7), `SpikeContentGuardTest` (7), `JdkSpikeReplyTransportTest` (10, incl.
  envelope shape + defensive parse + admin-endpoint URIs), `SpikeTokenClientTest` (4, granted-scope
  parse + non-200 fail-closed without body leak).

---

## 7. Report answers (for the operator)

- **답변 API 기본 경로 가능성:** structurally supported — `POST …/comments` with `mall.write_community`
  is the official write. Whether it *also* flips `reply_status` to `C` (verdict A vs B) is the one open
  live question; **not yet proven**.
- **comment request envelope:** `{"shop_no":1,"request":{"content","writer","password"}}` (working
  contract; exact wrapper to confirm live under `2025-12-01`, HALT on mismatch).
- **granted-scope 검증 방법:** `SpikeTokenClient` parses the token response `scope`/`scopes`;
  `SpikeGrantedScope` returns booleans only; fail-closed if write not granted.
- **reply_status 관찰 방법:** GET single article before and after; classify to `N/P/C/OTHER`.
- **article PUT 필요 여부:** unknown until the live run — verdict **A** = PUT not needed; verdict **B**
  = a separate official status-update would be required, and the spike will HALT rather than PUT.
- **spike 안전 경계:** §5 above (isolated package, triple-gated, disposable everything, single POST,
  no PUT/DELETE, sanitized output).
- **tests / gate / review:** 1890/0/0; 50 spike tests; independent security review recorded in the
  completion commit.
- **operator Developer-Console / OAuth work (a future gated step):**
  1. Add `mall.write_community` **only to a spike/disposable app registration** (never the production
     onboarding app), keeping the redirect URI byte-identical.
  2. Complete a **spike OAuth consent** granting `mall.read_community` + `mall.write_community` against
     the disposable spike account, storing the spike credential in the disposable DB.
  3. Create one operator-owned board-6 test inquiry (no PII) with `reply_status = N`.
- **실제 comment POST 직전 fresh single-use 승인 조건:** channel = Cafe24, account = the disposable
  spike account, store, date = the run day, operator seated; explicit approval that the run may perform
  exactly **one** comment POST to the named board-6 test article (read-only probes + that single write),
  supplied as the `...spike.reply.approval` value with `...execute-write=true`. A plan or prior approval
  is not authorization.

---

## Out of scope (unchanged)
No production onboarding scope change; tutorial read-only scope/UX untouched. No article PUT/DELETE, no
auto-reply, no order/product/review write. Guided Handoff branch
`feat/cafe24-inquiry-guided-reply-v1-backend@d85664d` preserved, not extended. The live comment POST is
a separate, later, gated step.
