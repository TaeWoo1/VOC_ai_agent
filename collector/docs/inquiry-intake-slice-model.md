# Seller Inquiry Intake & Proposal — vertical slice note

> **Status: offline core.** The first FDE vertical slice, pure/offline under
> `src/inquiry/`, built on the committed work domain (`commerce-work-domain-model.md`)
> and its two-track framing (`two-track-product-architecture.md`). It carries one
> customer inquiry from a channel-neutral observation to a seller proposal awaiting
> approval — no live collection, no channel write, no connector, no persistence,
> no HTTP, no LLM, no manufacturer action, no auto-approval.

---

## 1. The slice

```
InquiryObservation → CommerceSignal → WorkItem (OPEN) → AgentProposal (PROPOSED)
                                                          └── STOP: Seller approval pending
```

`InquiryIntakeCoordinator.ingest(observation, atMs)` runs it and stops at
`PROPOSED`. A `POST_INQUIRY_REPLY` is a seller-channel write, so the conservative
approval policy leaves it awaiting **explicit Seller approval** — the coordinator
never approves, never creates an `ActionIntent`, never executes.

## 2. Modules

| module                | role                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `observation.ts`      | `InquiryObservation` — the channel-neutral input (raw text + order ref + coarse category); a caller hands it in, no collection here |
| `intake.ts`           | deterministic ids + the privacy split: `toInquirySignal` (seller-owned, raw operational data in `sellerPrivate`), `sellerContextFromSignal` (rebuild the provider context from the signal's seller projection), `openInquiryWorkItem` (one seller work item) |
| `proposal-provider.ts`| `InquiryProposalProvider` seam (NO implementation — no LLM, no network); returns a coarse `InquiryProposalDraft` from the seller context |
| `coordinator.ts`      | the application coordinator + a **serializable** dedup index; drives observation → proposal, enforces idempotency / isolation / conflict / retry |

## 3. Privacy split (what goes where)

- **Shareable projection** (`signal.shareable`): coarse product/VOC metadata only —
  `productRef`, `topicCategory`, `severityBucket`. Recency for `cs_inquiry` is
  deferred, so `recencyBucket` is `unknown` (the raw `observedAt` never becomes a
  bucket here).
- **Seller-private on the signal** (`signal.sellerPrivate`): the raw operational
  values are **preserved** — `sourceText` (raw inquiry text), `orderRef` (raw),
  `channelSourceRef` (the channel inquiry id needed for later execution),
  `responseDeadlineAt` — with `orderRefHash` kept **additionally** for matching
  (never as the sole value). These are visible only to the owning seller (or a
  manufacturer with an explicit seller-private field grant); the projection layer
  (`access.ts`) strips the whole compartment to `null` for anyone else, so a
  manufacturer without that grant never sees the raw text or order id.
- **Seller-visible context** (`SellerInquiryContext`): reconstructed by
  `sellerContextFromSignal` from the signal's **SELLER projection** — not the
  observation — so the provider input is derivable from the `CommerceSignal` alone,
  even after the observation is gone. It carries no manufacturer fields, no hashes,
  no internal ids.

Flow: `InquiryObservation → CommerceSignal → Seller projection → SellerInquiryContext → InquiryProposalProvider`.

## 4. Deterministic ids, idempotency & isolation

Every id — signal, work item, open/propose command — is a pure SHA-256 function of
the channel **source identity** `(channel, connectionId, channelInquiryId)`. This
makes the coordinator's guarantees fall out cleanly:

- **Idempotent** — re-ingesting the same observation returns the existing slice with
  no re-open and no re-draft (the provider is not called again).
- **Isolated** — the same channel inquiry id on a different connection is a
  different source key ⇒ a separate work item.
- **Conflict-guarded** — a source identity reused with *different content* (a
  differing observation fingerprint) is a `SOURCE_CONFLICT`.
- **Retryable** — a provider failure leaves the work item `OPEN`
  (`PROPOSAL_UNAVAILABLE`); a later ingestion reuses the SAME work item, calls the
  provider again, and settles at `PROPOSED` — never reopening or duplicating it.

The dedup index is **serializable and rehydratable**: `snapshot()` captures it as
plain JSON and `InquiryIntakeCoordinator.fromSnapshot(state, provider)` restores it,
so idempotency (and conflict detection) survive a serialization round-trip rather
than depending on a live in-memory `Map`. It is session/transport state, not durable
persistence (no DB/disk).

## 5. Not in scope (deferred)

NAVER/ESM live collection and the observation-producing adapter, seller approval /
action-intent / execution (the rest of the lifecycle), channel writes, connector
calls, persistence, HTTP, a real LLM-backed provider, manufacturer actions, and any
automatic approval. This slice stops at a seller proposal awaiting approval.
