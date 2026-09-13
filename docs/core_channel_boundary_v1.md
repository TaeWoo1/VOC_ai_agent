# Core Channel Boundary v1

2026-09-13. Companion to `docs/review_media_presence_audit_v1.md` (the media half of the same
milestone). Migration **0** for this half · marketplace calls **0** · WRITE **0** · model calls **0**.

**The question.** Agent-native Core Boundary v1 removed the seller ACCOUNT from the review decision
lane and proved the loop on a review nobody acquired through a connection. It closed with one
residual, reported and not fixed: a review on a channel outside the triage contract's three — this
org's own GMARKET file uploads — opened in the workspace and then answered **404** to every judgment
and every act. This document is that residual, decided and closed.

---

## §1 — Three layers, and only two of them are the channel's business

| layer | what it is | scoped by |
|---|---|---|
| **Core** | what a PERSON concluded about a review: the seller's own tier, the response decision, the record that they acted, the trail of all three | `(reviewId, orgId)` — nothing else |
| **Attention** | what the SYSTEM says about a review: the AI pilot's mark, silver behaviour events, the event vocabulary built on them | the triage contract's channel table (§1), unchanged |
| **Execution** | what is SENT to a marketplace: draft, approval, submission mint, guided reply, the reply-claim acts | `SellerAccount` + channel capability, unchanged |

**The defect was that Core was being scoped by Attention's table.**
`contracts/review-triage-events/v1/CONTRACT.md` §1 is a table of **what a channel can produce** — an
AI mark, a behaviour event, a reply flow. `ChannelReviewFeedbackService.requireCapability` applied it
to every route it owned, including the two that are not about a channel at all. A person's judgment
is not something a channel produces.

---

## §2 — What moved, exactly

Four methods lost the channel gate — `correct`, `withdraw`, `correctionHistory`, and the
`ACTION_STARTED` / `ACTION_COMPLETED` / `ACTION_NOT_NEEDED` half of `act`. Nothing else changed.

- **`TriageActionKind.isSellerAct()`** is where the split is said once. The three `ACTION_*` are
  statements about what the seller did on their own side of the counter; `REPLY_DRAFTED` and
  `REPLY_SUBMITTED` are claims that a reply exists on a channel, and
  `ReviewTriageChannelCapability.permits` still refuses those where no reply flow does — contract
  §2.2's refusal, unchanged, because storing one with a flag is the fake the contract forbids by name.
- **`requireCapability` still guards `observe` and `events`**, and its docblock now says which
  question it answers. Silver a channel cannot emit is still a 404.
- **The AI pilot is untouched.** `AiTriagePilotService` still runs only for the three channels; its
  routes are still account-scoped; no org gained a capability.
- **The response decision needed no change** — `ReviewTriageService.decide` never had a channel gate.

## §3 — «Do not invent system triage on an unsupported channel»

Already structurally true, and now asserted. `TriageDisplayDecision.resolve` reports `AI` only when a
pilot row exists AND the surface is on AND the rule did not already say 확인 필요. The pilot never
runs outside the three channels, so there is no row, so an unsupported channel can only ever record
`RULES` — the rating rule's own tier, computed from a rating and a body that every channel has, and
the same tier the workspace actually displays.

**Measured live on a GMARKET upload:** the correction echoed `systemTier=NEEDS_ATTENTION`,
`systemSource=RULES`. Nothing was invented; what was recorded is what the screen showed.

## §4 — Live verification

A disposable org created through the product's own signup, **zero seller accounts**, one GMARKET
review and one Cafe24 review, both by CSV upload (`POST /api/uploads` takes a channel and no account):

| | |
|---|---|
| GMARKET workspace opens | ✅ `triage.tier=NEEDS_ATTENTION`, `sellerAccountId=null`, `replyWork=null`, `replyUnavailableReason=CHANNEL_HAS_NO_REPLY_FLOW` |
| judgment · decision · act | ✅ 200 / 200 / 200 — `systemSource=RULES` |
| `REPLY_SUBMITTED` on GMARKET | ✅ **400** 「이 채널에서는 기록할 수 없는 조치 종류입니다」 |
| decision log after a browser click-through | ✅ six transitions, oldest to newest, read back after reload |
| silver behaviour rows written | ✅ **0** — the Attention lane stayed shut |
| `reply_draft` / `reply_execution` rows | ✅ **0** |
| axe · horizontal scroll · off-host | ✅ 0 / none / 0 at 1440 · 1366 · 1152 |

The two sentences stay apart: the GMARKET workspace says 「이 채널에서는 reviewnary가 답변을
작성하지 않습니다」 (true of the marketplace) and the account-less Cafe24 one says 「이 채널에 연결된
판매 계정이 없어…」 (true of this seller's setup).

## §5 — Reported, not fixed

**A GMARKET-only org still sees the first-use screen.** `metrics.channels` carries the
seller-visible channel set — NAVER · Cafe24 · Coupang, the 2026-08-17 product-owner decision — so a
channel outside it has **no row at all**, and `homeFirstUseState` cannot see rows it is never shown.

Measured 2026-09-13 on an org whose only content is one uploaded GMARKET review:
`GET /api/operations/home` reports `needsAttentionUndecided: 1` while the rendered Home says
「판매 채널을 연결하면 시작할 수 있습니다」. The backend knows; the channel table does not carry the
channel. Widening the visible set is exactly the decision that made it three, so it is raised rather
than taken.

## PRODUCT_DECISION_NEEDED

1. **Should a channel outside the visible three appear in `metrics.channels` when the org holds rows
   on it?** Until it does, a seller whose only reviews are GMARKET uploads has a working Decision
   Workspace they cannot reach from the Home. The alternative — leaving it — is defensible: the
   channel genuinely cannot be connected, and the screen says so honestly to everyone else.
2. **`ACTION_NOT_NEEDED` now reachable on any channel.** The Decision Workspace does not offer it
   (the decision spine's `NO_ACTION` already says it, and one press in two spines is what §5-C of the
   triage contract forbids), but the record screen's pilot control still writes it. Unchanged here.
