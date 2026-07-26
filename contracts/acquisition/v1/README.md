# Acquisition contract (v1) — DRAFT

The channel-neutral vocabulary for **"how do we acquire this `(channel × capability)`, and may the Agent
start?"** — the step that runs *after* per-channel [session readiness](../../session-readiness/v1) says whether
a channel's session is usable.

This is an **internal state contract**, not an Action Window wire contract. Nothing here crosses the
FE ↔ Runtime socket; it is versioned separately from `ACTION_WINDOW_TRANSPORT_VERSION`. It is pure — no I/O,
no logging, no browser, no clock — and type-checks under `contracts/tsconfig.json` (no DOM, no Node).

> **Status: DRAFT.** This is the thin classify-and-decide seam recorded under the approved `product-scope-v1.md`
> §1.7 carve-out (the pure resolver/decide seam is exempted from the §1.7 implementation lock; the
> `OperationRun` domain, live dispatch, and backend persistence remain locked). It is **not yet wired to the
> live agent loop** — see "Deliberate boundary" below.

## The two questions it answers

| # | question | answered by |
|---|---|---|
| 1 | How is `(channel × capability)` acquired? | `resolveAcquisition(channel, capability, rows)` → `AcquisitionPlan` |
| 2 | May the Agent start, or ask the seller for one thing? | `decideAcquisition(readiness, plan)` → `SupervisorDecision` |

## Mode axis — reuses `ExecutionMode` (no new enum)

The "how" is the seller-facing `ExecutionMode` the Action Window command port already carries
(`../../action-window/v2` — `AUTOMATIC_OPERATION | ACTION_WINDOW | FILE_IMPORT | INTEGRATION_PENDING`). The four
user-facing branches map onto it — **a webhook is not a fifth mode**:

| branch | mode | delivery | checkpoint (`checkpointShapeForMode`) |
|---|---|---|---|
| API (pull) | `AUTOMATIC_OPERATION` | `PULL` | `APPROVAL` (approval *is* the checkpoint) |
| Webhook (push) | `AUTOMATIC_OPERATION` | `PUSH` | `APPROVAL` — same branch as API, different delivery |
| Action Window | `ACTION_WINDOW` | — | `MARKETPLACE_ACTION` (one real action on the marketplace) |
| File | `FILE_IMPORT` | — | `FILE_SELECTION` (seller picks the official export file) |
| (unresolved) | `INTEGRATION_PENDING` | — | `NONE` — never dispatchable |

## Decisions (`SupervisorDecision`)

| kind | when | carries |
|---|---|---|
| `DISPATCH` | session `READY` **and** an integrated mode | the plan |
| `ASK_SELLER` | session not `READY` | the readiness contract's exactly-one `action` + the plan |
| `HOLD_UNOBSERVED` | session `UNOBSERVED_EXTERNAL` | the plan — infer nothing, ask nothing |
| `HOLD_UNSUPPORTED` | plan mode is `INTEGRATION_PENDING` | the plan — no mode to dispatch, independent of readiness |

`ASK_SELLER.action` comes straight from `singleActionForReadiness` (the readiness contract), so the
acquisition "one thing" can never drift from the readiness "one thing" or the human checkpoint.

## Boundaries

- **Sanitized only.** A plan/decision is enums plus a channel-code enum. There is nowhere in it for a token,
  cookie, seller/account id, URL, page text, or a marketplace ref.
- **Fail closed, never infer.** A `(channel, capability)` with no resolution row resolves to
  `INTEGRATION_PENDING` and can never be dispatched — "not integrated", never "probably API". Unverified
  capabilities in the roadmap §4.1 table are simply absent from the matrix, so they fail closed by omission.
- **The matrix is not here.** The `(channel × capability) → mode` rows are marketplace-capability truth
  (roadmap §4.1) and live in the collector (`collector/src/action-window/acquisition-supervisor.ts`), passed
  in as `AcquisitionResolutionRow[]`. This contract owns only the neutral vocabulary and the two pure folds.
- **SellerOps performs none of the actions.** As with readiness, `ASK_SELLER.action` is copy intent for the
  seller. SellerOps never logs in, solves a challenge, picks an account, clicks the marketplace, or auto-runs.

## Deliberate boundary — not yet driven by the live agent loop

This slice ships the pure `resolveAcquisition` / `decideAcquisition` seam and the collector coordinator that
reads readiness and selects the existing NAVER adapter. It does **not** wire the supervisor into the live boot
(`buildInitialImportConfig` / `local-agent` call nothing here), does not run any live acquisition, and adds no
backend persistence. Live dispatch touches a real marketplace session, so it is a separately-approved
follow-up — the modes and decisions are the vocabulary that wiring will use, not a claim it is connected.
