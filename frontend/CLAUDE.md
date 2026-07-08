# frontend/CLAUDE.md

Scope: **`frontend/**` only.** This governs the SellerOps **Action Window Frontend** workstream (UI/UX + Frontend).

## Ownership

May modify: `frontend/**` (source + colocated `*.test.ts`), `frontend/CLAUDE.md`,
`docs/workstreams/action-window-frontend/**`.

Must **not** modify: `collector/**`, `backend/**`, `docs/esm/**`, Chrome/CDP/runtime
code, marketplace adapters, the shared contract (`contracts/action-window/v1/**`), or
canonical product/runtime docs (`docs/product-scope-v1.md`,
`docs/sellerops_frontend_spec.md`, `docs/slices/action-window-v1.md`,
`docs/sellerops_current_state.md`, `docs/multi-channel-connector-roadmap.md`,
`docs/channel-capability-registration-matrix.md`,
`docs/sellerops_local_agent_runtime_adr.md`, `docs/action-window-runtime/**`).

## Contract discipline

- The shared Action Window contract (`contracts/action-window/v1/`) is **consumed, never
  redefined**. Import protocol types/enums/validators/View Model from it (via
  `src/lib/actionWindow/contract.ts`); do not declare a local copy.
- Runtime owns semantic state; **FE owns all final copy** — map `copyKey` /
  `channelCode` / `BlockerCode` to localized copy in `src/lib/actionWindow/copy.ts`.
- Render command controls **only** from `ActionWindowRunView.allowedCommands`.
- `REQUEST_STEP_RECHECK` reports user intent; it must **never** complete a step on the
  client. Runtime alone verifies and completes (via the `STEP_COMPLETED` event).
- Any contract change is a **separate contract-change PR**, not an FE edit.

## Privacy

Never surface selectors, raw URLs, CDP IDs, secrets, cookies, raw account IDs, or local
paths in UI, fixtures, logs, or tests. Consume only sanitized enums / codes / copy keys /
primitive params.

## Commit discipline

No small incremental commits; commit only a meaningful, verified FE slice after explicit
approval; no push or PR without explicit instruction.

## Mandatory reading for a new session

1. `docs/workstreams/action-window-frontend/README.md`
2. `docs/workstreams/action-window-frontend/implementation-plan.md`
3. `docs/workstreams/action-window-frontend/progress.md`
4. the shared contract `contracts/action-window/v1/` (README + `index.ts`)
