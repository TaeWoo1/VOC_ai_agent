# Cafe24 Review Seller Comment Execution v1

**Date:** 2026-08-28 · **Package:** Agentic Operating Workspace v2 (channel-capability completion) · **Status:**
`IMPLEMENTED` · `LOCAL_PROVEN` (request shape, verification decision, fences, service idempotency in tests) ·
**`LIVE_UNPROVEN`** — no comment has been posted to a mall; there is no safe review target in the Demo Org and no
approval was requested. Marketplace WRITE 0.

## 1. What a Cafe24 review is, in this repository

Board 4 (구매후기) articles arrive through the same OAuth connection as inquiries and are promoted to `reviews` with
`external_id = cafe24:b4:a{article_no}` (`Cafe24ReviewPromoter.externalId`). The source article keeps
`board_no`/`article_no`/`seller_account_id` in `cafe24_community_articles` (natural key `channel, seller_account,
board, article`), so a stored review resolves to exactly one mall through the API-mode uniqueness of
`seller_accounts (org, channel)`. That pair is the executable identity (`ExecutableIdentityResolver.forReview`):
a review whose article row is missing, or whose account is a file-upload account, is `NONE`.

## 2. The contract, re-audited before any code (§4 of the approved plan)

`docs/vendor/cafe24-admin-api/post-boards-articles-comments.md` (retrieved 2026-08-24):

- `POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments`, scope **`mall.write_community`** — the
  scope the inquiry answer path already contracts (`Cafe24ScopeContract.WRITE_COMMUNITY`) and the seller grants by
  a separate re-consent. **No new scope.**
- Required: `board_no`, `article_no`, `content`, `writer` (≤100), **`password` — "Required · Length min 1 / max 20 ·
  Comment password"**. Optional: `shop_no`, `member_id`, `rating`, `secret`, `parent_comment_no`, `input_channel`.
- The reference's own gap list: "Where a seller-side integration is expected to obtain `writer` and `password`.
  Both are required and neither exists anywhere in SellerOps's stored Cafe24 connection."
- `client_ip` is **not** a comment request parameter (it is on the article POST); it only appears among the
  properties the comments GET returns.

### 2.1 `password` — outcome **A**, with the boundary of what the reference proves

The field is labelled **"Comment password"** on the comment resource itself, sits beside `writer`, and is bounded
per comment (1–20). Nothing in the vendored contract ties it to an account credential, to OAuth, or to a mall
setting; the sibling article POST makes the same field *optional* (`Cafe24ReplyRequestShape` declines to send
it). That is the shape of an **author-chosen, per-object secret** — the value a poster would present to edit or
delete their own comment on the board UI. So the adapter mints a fresh 20-character value for the one POST, uses
it once and discards it (`Cafe24CommentPassword` — no field, no hash "for later", no log; `ReviewExecutionFenceTest`
pins that). reviewnary never edits or deletes a comment, so no later legitimate reuse exists and nothing is
persisted under vault semantics either.

What the reference does **not** prove, and why the live status stays `LIVE_UNPROVEN` rather than being argued
away: that Cafe24 accepts an arbitrary value for a **manager-authored** comment (`member_id == mall_id`), and
whether the value is validated at all for that author. Both are observable only by one live POST under an armed
approval. If a mall refuses (4xx with a password reason), the client reports `REJECTED` with the platform's
message and the execution row ends `FAILED` — nothing is retried and no second value is tried.

### 2.2 Identity of the author

`writer` and `member_id` are both the mall id — the documented condition under which Cafe24 renders the store
name, measured 43/44 on this shop by the 2026-08-25 actor probe (`docs/inquiry_answer_execution_v1.md`). `secret`
is sent as `F` (a review is public by construction: board-4 secret posts are excluded before storage);
`rating` is not sent (a rating on a seller's reply would be a fabricated score); `shop_no` comes from the same
deployment property the inquiry path uses and a `0` refuses rather than defaults.

## 3. The adapter and its verification

- `Cafe24ReviewCommentClient` — one `postJson` per execution, `assertContractShape` on the bytes before they
  leave (envelope `shop_no` + `request{content, writer, member_id, password, secret}`), the same live interlock as
  the article client (a non-loopback host requires `sellerops.review.publish.cafe24.live-approval-id`), transport
  ambiguity ⇒ `UNKNOWN` (never a resend).
- `Cafe24ReviewCommentAdapter` — parses `cafe24:b{board}:a{article}`, resolves the mall through the seller
  account, requires the `mall.write_community` grant (`Cafe24AnswerExecutionGrant`), posts the approved body
  verbatim.
- **Verification** reads the comments of that article (`Cafe24BoardCommentsClient`, extended with a **content
  hash only** — `Cafe24BoardCommentRow.contentHash`; the text, writer and member id still never leave the client)
  and decides: shop-authored comment with `hash == normalizedHash(approvedBody)` ⇒ **`VERIFIED`**; shop comment
  present but a different hash ⇒ **`STATUS_UNRESOLVED`**; none ⇒ **`DELIVERY_UNKNOWN`**; read failed ⇒
  `UNVERIFIABLE`. Whether a comment changes the article's `reply_status` is unproven on board 4 (it did not on
  board 6) and is not part of the verdict.
- Persistence: V84 `review_reply_execution` (org, review, account, approved version + fingerprint, `command_id`
  unique per org, status, provider ref, verification, observed_at). The older `review_reply_outcome` and its
  `UNVERIFIED`-only CHECK are untouched — that table records what an operator *reported*; this one records what
  the channel *showed*.

## 4. Endpoint and gates

`POST /api/seller-accounts/{accountId}/attention/items/{actionRef}/reply/execute {commandId, expectedFingerprint}` —
requires an `APPROVED` reply head whose fingerprint matches, `executableIdentity = MARKETPLACE`, channel CAFE24,
`sellerops.review.publish.execution-enabled=true` (default **false**), the Cafe24 connector enabled, and the
write grant; replays on the same `commandId`; returns `ReviewExecutionView{status, category, verification}`.
`GET …/reply/execution` reads it. `ReviewChannelCapabilityView.executionKind` tells the runtime `API_EXECUTION`
only when those switches are on, otherwise `NOT_SUPPORTED` with reason `EXECUTION_DISABLED`.

## 5. The on-demand refresh seam (plan §2, audited)

`CollectControlService.manualSync(orgId, accountId, "REVIEW")` is a synchronous MANUAL run on the seller's own
connected account — the same call the 수집 설정 row's 「지금 수집」 makes. It is the AUTOMATIC-channel refresh the
conversation runs (`agent-runtime/src/conversation/Refresher.ts`: one attempt, no retry, failure reported and
the stale rows shown as stale). With the connector disabled it fails closed; nothing pretends freshness.

## 6. Status words

| item | status |
|---|---|
| request shape · live interlock · no-retry · ephemeral password | IMPLEMENTED · LOCAL_PROVEN |
| verification decision (hash / unresolved / unknown) | IMPLEMENTED · LOCAL_PROVEN |
| execute / execution / observe endpoints, idempotency, gates | IMPLEMENTED · LOCAL_PROVEN (`ReviewReplyExecutionServiceTest`, 2026-08-28: approval · identity · account/channel · disabled · ANSWERED · same-command replay · **new command id against an already-POSTED review ⇒ `ALREADY_EXECUTED`, transport touched once** · DELIVERY_UNKNOWN · read-back; `uq_review_reply_execution_api_sent` is the race boundary) |
| one real comment on a mall, read back | **LIVE_UNPROVEN** |
| arbitrary password accepted for a mall-authored comment | **LIVE_UNPROVEN** (the only open contract question) |
