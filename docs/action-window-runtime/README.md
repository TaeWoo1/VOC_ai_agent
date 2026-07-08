# Action Window Runtime — Development Baseline

Runtime-side execution documentation for the SellerOps **Action Window**. This
directory lets a future session continue **from documents alone**: read this
README, follow the required reading order, then report state before editing.

> **New-session kickoff (copy verbatim):**
>
> `Read docs/action-window-runtime/README.md and follow its required reading order. Before editing, report the current slice, verified state, blocker, and next single action.`

---

## 1. Runtime mission

Implement the **Local Agent Runtime** half of the Action Window: open the real
Chrome window on the correct seller-center surface, locate and spotlight the one
real platform control, **wait for the user to click it**, observe and verify the
resulting transition, then hand the verified artifact to downstream ingestion —
failing closed on anything ambiguous. The Runtime **observes and verifies**; the
user performs every policy-sensitive platform action.

The autonomy metric is **operational work removed end-to-end**, never click
count.

## 2. Directory / file ownership

This directory (and the `feat/action-window-runtime` branch) **owns**:

- Local Agent Runtime
- Action Window shared **state engine**
- real Chrome / profile / window handling
- page overlay (geometry, spotlight, step chrome)
- user-action observation
- transition verification
- fail-closed behavior
- download / artifact detection
- Bridge runtime events and commands
- later Operation Run persistence
- channel adapters

It **does not own** (the separate FE worktree owns these):

- React pages or components
- UI/UX layout, design tokens
- user-facing copy
- frontend mock screens
- canonical product-strategy edits

Boundary rule: **FE owns product layout and copy; Runtime owns geometry,
detection, mounting, and verification.**

## 3. Required reading order

1. This `README.md`
2. `current-state.md` — where we actually are right now
3. `goal.md` — mission, operating loop, Runtime V1 definition of done, non-goals
4. `architecture.md` — component responsibilities + synthetic V1 state flow
5. `contract-boundary.md` — FE ↔ Runtime protocol boundary and prohibited payloads
6. `implementation-plan.md` — slices R0–R4
7. `checklist.md` — durable progress ledger
8. `decisions.md` — append-only durable decisions

## 4. Canonical product-document references

These are **referenced, never copied or redefined** here. Canonical intent lives
in the product docs; this directory only records Runtime execution. On conflict,
the canonical documents win (see §5).

- Product scope: [`../product-scope-v1.md`](../product-scope-v1.md) (operations-agent loop §1.2; modes §1.4; ACTION_WINDOW default §1.5; OperationRun domain §1.7)
- Frontend spec: [`../sellerops_frontend_spec.md`](../sellerops_frontend_spec.md) (§18 Action Window screen — FE정본)
- Connector roadmap: [`../multi-channel-connector-roadmap.md`](../multi-channel-connector-roadmap.md) (§4.1 capability truth table; §5 Action Window review mode)
- Local-agent runtime ADR: [`../sellerops_local_agent_runtime_adr.md`](../sellerops_local_agent_runtime_adr.md)
- Action Window V1 slice: [`../slices/action-window-v1.md`](../slices/action-window-v1.md)
- Capability registration matrix: [`../channel-capability-registration-matrix.md`](../channel-capability-registration-matrix.md)
- Living handoff state: [`../sellerops_current_state.md`](../sellerops_current_state.md)

## 5. Documentation precedence

When sources conflict, this order wins:

1. explicit product-owner decision in the current task
2. `../product-scope-v1.md`
3. `../sellerops_frontend_spec.md`
4. `../sellerops_local_agent_runtime_adr.md`
5. capability truth table `../multi-channel-connector-roadmap.md` §4.1
6. the shared FE↔Runtime contract (once it exists — see `contract-boundary.md`)
7. these Runtime execution docs
8. current implementation evidence

Implementation evidence may reveal a doc is stale, but it **must not silently
redefine product intent — report the conflict** instead.

## 6. Prohibited work (from this branch)

- Do **not** edit canonical product-direction documents from this Runtime branch.
- Do **not** touch the FE worktree or frontend product screens.
- Do **not** touch or clean the parked `sellerops-esm-live`
  marketplace-attribution worktree.
- Do **not** launch Chrome against a live marketplace or run any live commerce
  action.
- Do **not** implement automatic marketplace selection or automatic export
  clicking as default production behavior.
- Do **not** wire Browser Projection as a V1 dependency.

## 7. Update discipline

- Update `current-state.md` **when starting or changing the active slice**.
- Update `checklist.md` **only at meaningful implementation / verification
  milestones** — not per tiny code edit.
- Update `decisions.md` **only for an actual durable decision**; it is
  append-only. Mark superseded decisions `SUPERSEDED`; never rewrite history.
- Every `VERIFIED` or `MERGED` status requires linked evidence (commit/PR +
  test/fixture).
- Do not update documentation for every tiny code edit.

## 8. Where to look next

- Current verified state and blocker → [`current-state.md`](current-state.md)
- The next single action → see the **"next single action"** field in
  [`current-state.md`](current-state.md).
