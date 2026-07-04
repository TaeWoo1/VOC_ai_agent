# Seller Inquiry Approval, Execution & Verification — vertical slice note

> **Status: offline core.** The tail of the inquiry vertical slice, pure/offline
> under `src/inquiry/`, continuing `inquiry-intake-slice-model.md` on the committed
> work domain (`commerce-work-domain-model.md`). It carries an approved inquiry
> from a seller sign-off through execution and independent verification — no live
> NAVER/ESM write, no connector, no HTTP, no persistence, no LLM, no auto-approval,
> and no auto-retry of an ambiguous write.

---

## 1. The flow

```
PROPOSED → Seller Approval → ActionIntent → ExecutionResult → VerificationResult
```

Two coordinators, two injected seams; all state lives in serializable slices.

| module                    | role                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `approval-coordinator.ts` | `InquiryApprovalCoordinator` — owning-Seller approval → ONE `POST_INQUIRY_REPLY` ActionIntent |
| `reply-executor.ts`       | `InquiryReplyExecutor` seam (NO impl) — performs the write, returns a sanitized `EXECUTED / NOT_EXECUTED / UNKNOWN` |
| `reply-verifier.ts`       | `InquiryReplyVerifier` seam (NO impl) — INDEPENDENTLY checks visibility → `VERIFIED / NOT_VERIFIED / INDETERMINATE` |
| `execution-coordinator.ts`| `InquiryExecutionCoordinator` — executes at most once, verifies, and settles the resolution |

## 2. Approval — bound to the exact approved reply

`InquiryApprovalCoordinator.approve` requires the **owning Seller** as actor
(another seller or a manufacturer → `APPROVAL_DENIED`, via the work-domain
`approve` ownership guard), approves the proposal, and creates **exactly one**
`POST_INQUIRY_REPLY` ActionIntent.

The approved reply is **canonicalized** (`reply-hash.ts`): Unicode NFC + line-ending
normalization (CRLF / lone CR → LF) and **nothing else** — every other whitespace,
line break, and leading/trailing space is preserved, so a meaningful difference
(an extra blank line, an added space) changes the hash while a pure CRLF-vs-LF
difference does not. The single canonical value drives everything: it is hashed
into `approvedReplyHash`, recorded on the ActionIntent as `paramsFingerprint` (with
`proposalId`), stored as the execution slice's private payload, and sent to the
executor. The raw reply text NEVER enters the work-domain aggregate or audit.

Binding rules:
- first approval (`approve`) is from the PROPOSED intake slice;
- a duplicate approval goes through **`reaffirm(boundSlice, attemptedReply)`**: it
  re-hashes the attempted reply and, on a match, returns the **original** bound
  slice unchanged — it NEVER rebuilds the slice from the new raw payload — so the
  bound private payload is preserved; any different canonical payload →
  `PAYLOAD_CONFLICT`. The work-domain command ledger also compares the parameter
  fingerprint, so a reused intent id with a different hash is a `CONFLICT` there too.

Command ids are deterministic (from the source key). The seller-approved reply
payload (private) and the `connectionId` (absent from the sanitized signal) are
bound into the returned execution slice. Approval is never automatic.

## 3. Execution + verification (execution success ≠ completion)

`InquiryExecutionCoordinator.resolve` calls the executor **at most once** per
ActionIntent (tracked by `executionAttempted`), then the independent verifier.
The resolution matrix:

| executor       | verifier                    | resolution                       | work-item phase |
| -------------- | --------------------------- | -------------------------------- | --------------- |
| —              | (not approved)              | `NOT_READY` (executor not called)| ACTION_PENDING  |
| `CONFLICT`     | (not run)                   | `EXECUTION_CONFLICT`             | ACTION_PENDING  |
| `NOT_EXECUTED` | (not run)                   | `EXECUTION_FAILED`               | FAILED          |
| `EXECUTED`     | `VERIFIED`                  | `COMPLETED`                      | COMPLETED       |
| `EXECUTED`     | `NOT_VERIFIED`              | `VERIFICATION_FAILED`            | FAILED          |
| `EXECUTED`     | `INDETERMINATE`             | `EXECUTED_UNRESOLVED`            | EXECUTED        |
| `UNKNOWN`/ambiguous | `VERIFIED`             | `COMPLETED`                      | COMPLETED       |
| `UNKNOWN`/ambiguous | `NOT_VERIFIED`/`INDETERMINATE` | `MANUAL_RECONCILIATION_REQUIRED` | ACTION_PENDING |

Key rules:
- **Verification means a hash MATCH.** The verifier receives the expected
  `approvedReplyHash` (never raw text); `VERIFIED` means the observed channel reply
  matches that hash — not merely that some reply exists.
- **`UNKNOWN` never repeats the write.** The coordinator verifies first; if the
  approved reply is visible it completes, otherwise it surfaces manual
  reconciliation. It never blindly re-executes.
- **Executor exactly-once.** The executor is keyed by `actionIdempotencyKey` +
  `approvedReplyHash`; reusing the key with a different hash → `CONFLICT`.
- **Execution success alone never completes** — a passing `VerificationResult` is
  required, else `FAILED`.

## 4. Private state vs. sanitized status

The raw approved reply text lives ONLY in `slice.privateState.approvedReplyPayload`
and is passed to the executor inside its `sellerPrivate` field. `toSanitizedSnapshot`
projects the slice to hashes/enums/ids only — no inquiry or reply text — for
logging/status. The work-domain aggregate and audit carry only the hash. Normal
outcomes never return the private payload as their status surface.

## 5. Permit-gated persist-before-dispatch protocol

Serialized `dispatchStarted` alone cannot distinguish "persisted before the write"
from "persisted, written, then crashed before recording the outcome" — so execution
must NOT be authorized by serialized state alone. Authorization is an **ephemeral,
non-serializable `DispatchPermit`**:

**Dispatch binding.** `dispatchBindingHash` (`dispatch-binding.ts`) derives one hash
over the immutable approved-action envelope — action intent id, action kind,
connection id, channel, channel inquiry reference, and the **`approvedReplyHash`**
(never the raw reply) — using canonical length-delimited (netstring) encoding.
`ActionIntent.paramsFingerprint` is this **complete binding**, not just the reply
hash; `approvedReplyHash` is kept separately on the slice for executor + verifier
matching.

1. **`prepareDispatch(slice)`** → returns `{ slice (dispatchStarted: true), permit,
   idempotent }`. It first **validates the full slice** (fail closed) then registers
   the permit in a per-runtime registry keyed by **`actionIdempotencyKey` only**,
   pinning the immutable `(approvedReplyHash, dispatchBindingHash)` with a lifecycle
   `ACTIVE → CONSUMED`:
   - inconsistent slice → `INVALID_DISPATCH_STATE` / `BINDING_CONFLICT`;
   - fresh, not-prepared slice → mint ONE `ACTIVE` permit (`idempotent: false`);
   - same action id + same binding while `ACTIVE` → the **exact same** permit
     (`idempotent: true`);
   - same action id + a **different reply hash / target binding** → `BINDING_CONFLICT`
     (never a second permit, even for a fully self-consistent forged envelope);
   - permit already `CONSUMED` → `PERMIT_UNAVAILABLE`;
   - rehydrated prepared slice with no `ACTIVE` permit → `AMBIGUOUS_PREPARED`;
   - unapproved/terminal → `NOT_READY`.
2. the caller **persists the SLICE** (not the permit — `toJSON` is `undefined`).
3. **`executePrepared(preparedSlice, permit, atMs)`** validates, in order and **fail
   closed (never consuming the permit or calling the executor on any failure)**:
   (1) prepared state; (2) the immutable dispatch binding — full slice self-consistency
   (`validateDispatchSlice`: ActionIntent exists, id = action key, kind =
   `POST_INQUIRY_REPLY`, signal channel = target channel, signal channel source ref =
   target inquiry ref, canonical private reply hashes to `approvedReplyHash`, and the
   ActionIntent fingerprint = recomputed binding) plus the registry's pinned binding;
   (3) the single `ACTIVE` permit identity. Only then is the permit atomically marked
   `CONSUMED` and the executor called. Any failure → sanitized `INVALID_DISPATCH_STATE`
   / `BINDING_CONFLICT` / `INVALID_PERMIT` / `NOT_PREPARED`, no executor, permit intact.

Because the fingerprint IS the whole envelope and validation precedes consumption, a
tampered connection id / inquiry reference / reply payload / fingerprint is rejected
before any write, and a second permit can never execute a stale or forged slice.

Because the permit is ephemeral and per-runtime, a JSON-rehydrated prepared slice
(after a crash → fresh runtime) has NO valid permit and can never execute. Recovery:

- **`recoverPrepared(slice, atMs)`** (or the convenience **`resolve`**) → for a
  rehydrated dispatched-but-outcome-less slice, **verify FIRST, never execute**;
  `VERIFIED` → COMPLETED, else `MANUAL_RECONCILIATION_REQUIRED`.
- **`resolve` never auto-executes a fresh slice** (that would bypass the caller's
  persist boundary): a fresh not-dispatched slice returns `NOT_PREPARED`, forcing the
  explicit `prepareDispatch` → persist → `executePrepared` path.

The production executor must still enforce `actionIdempotencyKey` + `approvedReplyHash`
as the final backstop. Sanitized snapshots expose the dispatch state
(`dispatchStarted`, `executionAttempted`) but never the private payload.

## 6. Serializable state

Every slice (`InquiryExecutionSlice`) is a plain object — aggregate + private state
+ dispatch/attempt flags + last statuses + resolution — so the whole
approval→execution state survives serialization and rehydration without a duplicate
write. The coordinators hold no hidden state; the slice IS the state.

## 7. Not in scope (deferred)

Live NAVER/ESM writes, connector/browser calls, HTTP, durable persistence, a real
LLM/drafting or executor/verifier implementation, automatic reply approval, and any
automatic retry of an ambiguous (`UNKNOWN`) write. The field-scoped-grant refinement
noted in the intake slice also still stands.
