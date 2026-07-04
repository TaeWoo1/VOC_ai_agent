# Local Agent → Cloud Inquiry Ingestion Bridge — slice note

> **Status: offline core.** Pure/offline TypeScript under `src/ingestion/`, on top
> of the committed inquiry vertical (`inquiry-intake-slice-model.md`). It defines
> the TRANSPORT BOUNDARY between a Local Agent producer and the Cloud consumer —
> **no live ESM browser collection** (no selectors, downloads, or login).

---

## 1. The bridge

```
Browser/API channel capture → versioned ingestion envelope → InquiryObservation
  → existing InquiryIntakeCoordinator → PROPOSED WorkItem
```

| module               | role                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `envelope.ts`        | the channel-neutral, versioned `InquiryIngestionEnvelope` + deterministic `deriveEventId` + strict `validateEnvelope`; raw fields in `sellerPrivatePayload` |
| `adapter-registry.ts`| the channel-neutral `name+version → allowed channel` registry + `checkAdapter` |
| `esm-producer.ts`    | the ESM producer seam: `EsmInquiryCapture` → envelope (emits one registered descriptor) |
| `consumer.ts`        | the Cloud `InquiryIngestionConsumer`: authenticated context + fail-closed validation → observation → intake coordinator; batch |

## 2. Ownership boundary

- **Local Agent owns browser/API capture.** A producer captures a record and
  emits a versioned envelope. ESM is first; NAVER / Cafe24 producers emit the
  SAME envelope later without touching the inquiry workflow.
- **Cloud owns ingestion, WorkItems, proposals, approvals, and execution policy.**
  The consumer validates + maps + drives the existing intake coordinator (which
  owns dedup, `SOURCE_CONFLICT`, and the proposal draft). Approval/execution live
  in the already-committed slices.
- **This slice defines the transport boundary only.** The consumer depends on the
  common `InquiryIngestionEnvelope`, never on any producer's capture type — so the
  boundary is extensible by adding a producer, not by editing the workflow.

## 3. Envelope, identity & privacy

Versioned (`schemaVersion`). **`eventId` is the deterministic TRANSPORT identity** —
a canonical, length-delimited (netstring) SHA-256 of `(schemaVersion, sellerId,
channel, connectionId, channelInquiryId)`. Seller-scoped, so identical
connection/inquiry ids under different sellers get different event ids. All
timestamps are caller-supplied. Carries no customer identity beyond what
`InquiryObservation` allows.

`eventId` is **NOT** the WorkItem deduplication authority — the intake coordinator's
channel source identity `(channel, connectionId, channelInquiryId)` remains the dedup
authority. The consumer **recomputes** the expected event id and rejects a mismatch
(`EVENT_ID_MISMATCH`); the caller-supplied id is never trusted as identity.

**`sellerPrivatePayload`.** The raw operational fields (`inquiryText`, `orderRef`)
live here. The compartment is **logically seller-private** — it is **not encryption
by itself**; authenticated transport and encryption are deferred to the live Cloud
transport slice. It NEVER appears in a sanitized ingestion result. Every result
(success or failure) carries only enums / ids / booleans (`eventId`, `workItemId`,
`phase`, `proposed`, `idempotent`, or a reject reason).

## 4. Fail-closed validation & batch semantics

The consumer takes a trusted, caller-supplied `IngestionContext`
(`authenticatedSellerId`, `authorizedConnectionIds`) — the pure application seam a
future authenticated Cloud endpoint supplies (no HTTP/JWT/session). Per item, in
order, **before any workflow call**:

1. schema version → `UNSUPPORTED_SCHEMA_VERSION`;
2. strict envelope shape (`validateEnvelope`) — blank seller/connection/inquiry/
   product/adapter/inquiry-text, malformed category, non-finite/negative timestamps,
   deadline-before-observation → `INVALID_ENVELOPE`;
3. adapter registry (`checkAdapter`) → `UNKNOWN_ADAPTER` /
   `UNSUPPORTED_ADAPTER_VERSION` / `ADAPTER_CHANNEL_MISMATCH` (the registry, not the
   adapter's own claim, is authoritative — a self-consistent false claim is caught);
4. recomputed event id → `EVENT_ID_MISMATCH`;
5. authenticated context → `SELLER_CONTEXT_MISMATCH` / `CONNECTION_NOT_AUTHORIZED`.

Then map + hand to the intake coordinator (dedup, `SOURCE_CONFLICT`, isolation
unchanged). The ESM producer rejects a missing/blank required source identity
(`MISSING_*`) and never fabricates. **Batch**: the same context is applied
independently to every item, in stable input order; one failure never blocks the
others; a batch replay is idempotent; no hidden retries.

## 5. Deferred

**Live ESM capture remains deferred** until supervised UI/schema discovery confirms
the source fields. `EsmInquiryCapture` is a provisional pre-discovery seam — NOT a
claim about the official ESM page or export schema, and it contains no selectors,
browser calls, downloads, or login. Also deferred: the real producer transport
(HTTP/queue), **authenticated transport + payload encryption**, persistence, and any
NAVER/Cafe24 producer (they will emit the same envelope + a registry entry).
