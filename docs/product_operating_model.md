# SellerOps — Product Operating Model

> **Purpose.** This document exists to stop context drift. It is the short, stable answer to
> "what is SellerOps, who is it for, and how does it actually operate across channels" — written
> so that a fresh session, a new contributor, or a future you does **not** re-collapse SellerOps
> into "a 3-channel scraper / export tool."
>
> **Authority.** This is an **orientation document**. It owns none of the truth it summarizes; it
> **points**. Product identity/strategy/state authority is `docs/sellerops_canonical_reference.md`.
> Scope is `docs/product-scope-v1.md`. Capability truth is
> `docs/multi-channel-connector-roadmap.md` §4.1. On any conflict, those win (see `CLAUDE.md`
> conflict priority). If this document ever disagrees with them, this document is stale — fix it,
> don't cite it.

---

## 1. What SellerOps is (one paragraph, memorize this)

**SellerOps is a multi-channel commerce operations AI agent for SME sellers / manufacturers.**
It carries operational work *between* human decisions — normalizing reviews, inquiries, orders,
and operational risk across **every channel the seller actually sells on** — and hands a human a
*decision*, never the whole workflow.

It is **not**:

- a scraper / scraper dump,
- an automatic downloader or click-bot,
- a browser-automation macro,
- a 3-channel (NAVER / Coupang / ESM+) tool — those are the **first** channels, never the boundary,
- a VOC / cardnews / market-intelligence project (that is a separate, long-fenced Manufacturer Track),
- an ERP / settlement (정산) product,
- a dashboard the seller "checks."

The unified seller center is the **surface**. The operating loop is the **engine**
(`docs/sellerops_canonical_reference.md` §1).

## 2. Who it is for

SME 제조사 / 브랜드 **seller operations** — the owner plus the person who actually runs online
sales day-to-day. Not "40–50대 CEO industrial sellers" (retired framing), not agencies, not
enterprise. Canonical audience + scope exclusions: `docs/product-scope-v1.md` §1.2, §1.

## 3. The channel truth (this is the anti-drift core)

**SellerOps targets all channels a seller uses, over time.** Named today, in no priority order
(**strategy — not the product surface**; see the box below):

`NAVER` · `Coupang` · `ESM+ (Gmarket / Auction)` · `Cafe24` · `오늘의집` · `SSG` · `11번가` ·
`자사몰` · **review apps** · **and future marketplaces as sellers adopt them.**

Canonical channel codes (`ConnectorResult`, roadmap §3):
`NAVER | CAFE24 | GMARKET | SSG | COUPANG | ELEVENST | OHOU` — plus new adapters as channels are added.

Three rules that keep this from collapsing:

1. **The channel set is open, not fixed.** "3 channels" is a snapshot of *where work has happened*,
   never a definition of the product. New channel = new adapter + new mapping; the core model is
   unchanged (roadmap §2).
2. **Support is declared per `(channel × DataType × operation)`, never per channel.** One channel can
   be `ORDER=API-automatic`, `REVIEW=Action Window`, `INQUIRY=integration-pending` simultaneously
   (`docs/product-scope-v1.md` §1.4).
3. **"Named" ≠ "supported."** A channel appearing here is a *destination*, not a claim of live
   capability. What is actually available / verified / operational is **only** what
   `docs/multi-channel-connector-roadmap.md` §4.1 says, mirrored as lessons in
   `docs/channel_capability_ledger.md`. Never promote status here.

> **Product surface (2026-08-17, product-owner decision — `docs/product_assembly_ia_v1.md` §2).**
> Channel expansion is **paused**. The seller-visible channel set is exactly **NAVER / Coupang / Cafe24**;
> a channel on screen is a channel that is actually usable. Everything else named above stays a
> strategic destination and appears on **no** user surface until a connector/capability proof adds it
> to the existing UX (no new per-channel screens). The product is **workflow-centric** (홈 / 리뷰 / 문의 /
> 주문 / 채널 연결), not channel-centric — a channel is a filter or a capability inside a screen.

## 4. How SellerOps acquires data — the honest posture

> **Agentic value is not measured by whether acquisition is click-free.** It is measured by the
> total end-to-end operational work removed *around* human checkpoints
> (`docs/sellerops_canonical_reference.md` §1.2). A seller clicking "export" on the marketplace is
> the **correct, policy-safe** shape — not a failure of the agent.

Within each platform's rules, SellerOps **minimizes the user's action to the minimum the platform
allows** — and no less. The decision procedure per `(channel × DataType)`:

1. **Official API / webhook exists →** guide the seller through issuing/authorizing the key, then
   connect it. Ongoing acquisition is then background/scheduled. (User-facing mode:
   `AUTOMATIC_OPERATION`.)
2. **No API, or platform policy requires a human act →** use the **Action Window**: SellerOps
   prepares the real marketplace page with a tutorial overlay, the seller performs the *single*
   required action themselves (e.g. click the review export/download button), and SellerOps then
   validates and processes the result downstream. (User-facing mode: `ACTION_WINDOW`.)
3. **Official export file the seller already has →** seller selects it; SellerOps validates +
   ingests. (User-facing mode: `FILE_IMPORT`.)
4. **Not yet verified →** declare `INTEGRATION_PENDING` and say so honestly. Never show a seller
   "supported" for anything short of the *operational-support* status stage.

**Two orthogonal axes — do not confuse them:**

| Axis | Values | Where declared |
|---|---|---|
| **Acquisition method** (*how data arrives*) | `API` > `EXPORT` > `MANUAL` | roadmap §4.1 |
| **User-facing autonomy mode** (*what the seller sees*) | `AUTOMATIC_OPERATION` · `ACTION_WINDOW` · `FILE_IMPORT` · `INTEGRATION_PENDING` | `product-scope-v1.md` §1.4 |
| **Connection setup mode** (*how connecting is automated*) | `AUTOMATED` · `GUIDED` · `ASSISTED` · `MANUAL` | roadmap §11.1 |

Example: NAVER `ORDER_SUMMARY` is `method=API`, user-facing `AUTOMATIC_OPERATION`, connection mode
`GUIDED` (ASSISTED in pilots). These are independent dimensions.

## 5. The operating loop (the engine)

```
OBSERVE → ACQUIRE → NORMALIZE → UNDERSTAND → PRIORITIZE → ACT → ESCALATE → RESUME
```

Canonical definition: `docs/product-scope-v1.md` §1.6. A **human checkpoint hands back a decision,
never the whole workflow.** In v1, `ACT` is bounded to **preparation and guided execution only** —
no autonomous outbound write, no auto-submit.

## 6. The integrated seller center (the surface)

The seller sees **one operations center** spanning every connected channel, not a per-channel
scraper output. It surfaces, unified and cross-channel:

- **Sales** (order/settlement-summary level — *not* 정산),
- **Inquiries** (문의),
- **Reviews** (리뷰),
- **Alerts** (what needs a human now),
- **Operational risks** (SLA breaches, unanswered inquiries, review sentiment spikes, connection
  health).

The five data types are fixed: **주문 · 문의 · 리뷰 · 상품 · 운영 리포트**. Settlement is out of
scope (`docs/product-scope-v1.md` §1). Frontend source of truth: `docs/sellerops_frontend_spec.md`.

## 7. User journey (wedge → full operating model)

The **initial wedge is review operations** — the narrowest slice that proves the whole loop on one
seller, one channel, end-to-end. From there the same loop generalizes outward.

**Stage A — Onboard & connect (per channel, honest about method).**
1. Seller adds a channel from the seller center.
2. SellerOps chooses the acquisition method by the §4 procedure and drives the matching setup mode:
   - API available → **guided key issuance** → connect → background sync.
   - No API / policy-gated → **Action Window** tutorial: SellerOps prepares the page, seller
     performs the one required action, SellerOps validates the result.
   - Otherwise → guided **file import**, or honest `INTEGRATION_PENDING`.
3. The channel joins the unified center; its connection health is one row in the same model as
   every other channel (roadmap §2).

**Stage B — Review operations (the wedge, running).**
4. Seller sets a **notification cadence** for review acquisition (how often SellerOps prompts).
5. At cadence, SellerOps asks for the **minimum required action** — e.g. "click the review export
   button on the open page" — nothing chained, nothing hidden, manual progress always available.
6. SellerOps **validates and processes** the returned export/download: dedup, normalize to the
   canonical `review` model, fingerprint.
7. SellerOps **understands + prioritizes**: which reviews need a response, which are risks, what's
   urgent — surfaced in the seller center with alerts.
8. For response, SellerOps **prepares** the reply and guides the seller to post it (guided,
   human-performed, observe-only in v1 — SellerOps does not submit). Posting verification is
   recorded honestly as `UNVERIFIED` where no official API can confirm it.

**Stage C — Multi-channel operations (generalize).**
9. Add a second, then third channel — each with *its own* best acquisition method — all converging
   on **one canonical model** and **one observability model**. The thesis under test:
   *does the Action Window pattern survive a channel it was not designed against?* (strategy:
   `docs/sellerops_canonical_reference.md` §2, roadmap §5.2).

**Stage D — SME commerce operations AX (the long arc).**
10. The stable loop becomes the substrate for operational transformation — an agent that carries
    operational work between decisions across the seller's whole channel footprint. Implementation
    of the `OperationRun` domain is **recorded direction, forbidden until execution modes and
    checkpoints are stable** (canonical reference §2, Stage 3).

## 8. Standing fences (never negotiated away by "convenience")

From `CLAUDE.md` safety fences and `docs/product-scope-v1.md`:

- **No CAPTCHA / 2FA / auth bypass.**
- **No hidden or chained platform clicks** — manual progress always remains available.
- **No automatic export / download / submit as product behavior** — only via an explicit,
  approved **human checkpoint**.
- **Official APIs first; Action Window** for user-confirmed platform actions. SellerOps detects,
  validates, and processes — the seller performs the platform action.
- **Fail closed** on ambiguous, missing, or changed platform targets.
- **Sanitized output only** — never credentials, tokens, cookies, seller IDs, JWTs, raw page
  content, screenshots, exported files, or personal data. Internal timing never surfaces; only
  `recencyBucket` may.
- **Honest capability signalling** — "structurally possible" is never shown to a seller as
  "supported." Only the *operational-support* stage is "supported."

## 9. Where to look next (router)

| I need… | Read |
|---|---|
| Product identity / strategy / honest state | `docs/sellerops_canonical_reference.md` |
| Scope contract (what's in / out, autonomy modes, the loop) | `docs/product-scope-v1.md` |
| Capability truth (channel × DataType × method × status) | `docs/multi-channel-connector-roadmap.md` §4.1 |
| Channel lessons (available / blocked / verified / pending / policy-limited) | `docs/channel_capability_ledger.md` |
| Business / registration / credential view | `docs/channel-capability-registration-matrix.md` |
| Connection & setup modes | `docs/multi-channel-connector-roadmap.md` §11 |
| Action Window contract | `docs/slices/action-window-v1.md` |
| Action Window runtime status | `docs/action-window-runtime/HANDOFF.md` |
| Product IA · screen responsibility · visible channels | `docs/product_assembly_ia_v1.md` |
| Frontend principles (states, language, a11y, guided connection, AW screens) | `docs/sellerops_frontend_spec.md` |
| Review AI triage demo / pilot state | `docs/workstreams/review_ai_triage_demo.md` |
| Review operations wedge (this MVP) | `docs/workstreams/review_operations_mvp.md` |
