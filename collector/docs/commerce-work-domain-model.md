# Commerce Work Domain — architecture note

> **Status: offline core.** Pure/offline TypeScript under `src/work/` (type-only
> imports of `CommerceChannel` / `RecencyBucket`; no DB, HTTP, LLM, connector
> call, UI, or scheduler; no wall-clock read). This is the minimal FDE work spine
> the two product tracks converge on — see
> `docs/two-track-product-architecture.md` for the Seller Operations Agent /
> Manufacturer Intelligence Agent framing this fills in.

---

## 1. The lifecycle

One auditable path, driven by pure transitions in `work-item.ts`:

```
Signal → WorkItem → Proposal → Approval → ActionIntent → ExecutionResult → VerificationResult
```

Phases (`WorkItemPhase`): `OPEN → PROPOSED → APPROVED | REJECTED → ACTION_PENDING
→ EXECUTED → COMPLETED | FAILED`. `REJECTED` and `FAILED` are terminal
non-success; **`COMPLETED` is the only terminal success** — reached only when a
`VerificationResult` passes. Execution success alone lands in `EXECUTED`, never
`COMPLETED`.

Each transition is a pure function `(aggregate, command) → TransitionOutcome`
that never mutates its input and appends exactly one immutable `AuditEvent`
(stamped with the originating `commandId`) on a real state change.

**Idempotency is command-id based, not positional.** Every state-changing command
carries an explicit `commandId`; the aggregate keeps an applied-command ledger
(`appliedCommands`). Re-applying the same command returns the unchanged aggregate
(`idempotent: true`, no new audit event) — this survives a JSON round-trip, since
detection reads the ledger, never the audit length or event index. Reusing a
`commandId` for a **different** transition is refused (`CONFLICT`); a command in
the wrong phase is refused (`WRONG_PHASE`). Commands also carry `atMs`
(caller-supplied epoch-ms) — the domain generates no ids and reads no clock.

## 2. Objects

| type                 | role                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `CommerceSignal`     | sanitized observation from a seller's channel data; owns `sellerId`, splits `shareable` (grantable) from `sellerPrivate` (raw operational data + hashes, stripped at the manufacturer boundary) |
| `WorkItem`           | the owned unit of work a signal rolls up into; carries `owner`, `phase` |
| `AgentProposal`      | a suggested action — **advisory only, never executes**; carries `requiresApproval` |
| `ApprovalPolicy`     | data deciding whether a proposal needs a human sign-off (`approval-policy.ts`) |
| `ApprovalDecision`   | the recorded approval — `AUTO` (internal only) or `HUMAN`               |
| `ActionIntent`       | what WOULD run — created **only after** `APPROVED`; performs no side effect |
| `ExecutionResult`    | recorded outcome of executing the intent (the side effect is out of this domain) |
| `VerificationResult` | recorded outcome of verifying the execution — the only path to `COMPLETED` |
| `AuditEvent`         | one immutable record per transition (`commandId` / ids / enums / actor / `atMs`) |

`ActionKind` is grouped by side-effect class (`action-authority.ts`): **INTERNAL**
(`CLASSIFY_SIGNAL`, `CREATE_INTERNAL_TASK`), **SELLER_ACTION_REQUEST**
(`REQUEST_SELLER_ACTION`), and **SELLER_CHANNEL_WRITE** (inquiry/review reply,
order/shipment change, cancellation/refund/claim, external write).

## 3. Two axes: data visibility vs. action authority

Visibility and authority are **separate** — a read grant never confers the right
to act.

**Visibility — the `DataGrant` (`data-grant.ts`), reads only:**
- Seller owns raw channel data; the owning seller sees a `CommerceSignal` in full
  (including `sellerPrivate`).
- A manufacturer sees a seller's data only through an active scoped grant.
  `evaluateGrant(grant, request, referenceTimeMs)` checks, in order: presence,
  party match, revocation, validity window `[notBeforeMs, notAfterMs)`, then each
  scope axis (channel, product, signal kind), then the seller-private field gate.
- Seller-private fields (raw operational data — source text, order/customer refs —
  plus hashes) are withheld unless `includeSellerPrivateFields` is set —
  `projectSignalForViewer` / `projectWorkItemForViewer` (`access.ts`) strip the
  whole compartment (or redact the whole view)
  otherwise.

**Authority — `authorizeAction` (`action-authority.ts`), acts only:**
- INTERNAL actions: the work-item owner (seller or manufacturer) may drive them.
- `REQUEST_SELLER_ACTION`: only a manufacturer, on its own work item — a request,
  **not** a seller-channel side effect.
- SELLER_CHANNEL_WRITE: requires a **seller-owned** work item and the owning seller
  as actor. **A manufacturer can never directly create an executable seller-channel
  `ActionIntent`** (`AUTHORITY_DENIED`); it must `REQUEST_SELLER_ACTION`. Delegated
  manufacturer execution is deliberately not implemented.

**Grant re-evaluation.** A manufacturer-owned transition (`proposeAction`,
`createActionIntent`) re-checks its scoped grant against the caller's
`referenceTimeMs`. A grant revoked or expired *after* the work item was opened
denies further transitions (`ACCESS_REVOKED`) — an existing work item never keeps
riding a previously valid grant — and projection goes dark. The initial open-time
denial is `GRANT_DENIED`.

## 4. Approval policy (conservative)

Approval requirement is derived from the action's side-effect class, not a
hand-maintained list. **Only INTERNAL actions may auto-approve.** Every
seller-channel write (inquiry/review reply, order/shipment change,
cancellation/refund/claim, external write) and every `REQUEST_SELLER_ACTION`
requires explicit human approval; for a seller-channel write, authority forces the
owner to be the seller, so that approver **is** the seller.

## 5. Invariants (each locked by a test)

- Proposals never execute — proposing records a suggestion only.
- A manufacturer may request but not execute a seller action (`AUTHORITY_DENIED`).
- An action requiring approval cannot reach an `ActionIntent` before approval
  (`APPROVAL_REQUIRED`); an inquiry reply cannot auto-approve; internal
  classification can.
- A grant revoked/expired after work-item creation → `ACCESS_REVOKED` on further
  transitions and redacted projection.
- Execution success is not completion — `EXECUTED` needs a passing
  `VerificationResult` to become `COMPLETED`; a failed verification → `FAILED`
  (`VERIFICATION_FAILED`).
- Idempotent by `commandId` (replay is a no-op even after serialization; a reused
  id for a different transition is `CONFLICT`) and auditable (one event per change,
  stamped with its command id).
- One failed work item cannot affect another — each aggregate is independent.

## 6. Not in scope (deferred)

Persistence/store, event bus, id generation, the connector→signal adapter (turning
a real `SyncIntent` result into `CommerceSignal`s), scheduling, notification, the
DataGrant management UX/store, **delegated manufacturer execution of seller
actions**, and any live action execution. All are separate, not-yet-existing
slices; this note covers only the pure domain core.
