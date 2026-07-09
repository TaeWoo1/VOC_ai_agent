# Decisions — Action Window Runtime (append-only)

Append-only log of **durable** decisions. Never rewrite history. When a decision
changes, add a new entry and mark the old one `SUPERSEDED` with a pointer.

Format: `D-NNN` · status (`ACTIVE` / `SUPERSEDED`) · decision · rationale.

---

- **D-001 · ACTIVE** — Action Window is the **default review-acquisition target
  architecture**. *Rationale:* accepted product direction
  (`../product-scope-v1.md` §1.5); replaces the retired hidden-click capture model.

- **D-002 · ACTIVE** — **The user clicks actual platform elements.** The Runtime
  observes and verifies. *Rationale:* policy-sensitive actions stay with the
  seller; keeps SellerOps on the honest side of platform terms.

- **D-003 · ACTIVE** — **No hidden chained platform clicks.** The Runtime never
  expands one user request into a multi-click platform sequence. *Rationale:*
  core product/safety invariant.

- **D-004 · ACTIVE** — **No automatic marketplace selection in default
  production.** *Rationale:* the user selects GMARKET/AUCTION etc.; observed live
  contradiction of the auto-select assumption.

- **D-005 · ACTIVE** — **No automatic export click in default production.**
  *Rationale:* export is a user-performed platform action; the Runtime detects
  the resulting download only.

- **D-006 · ACTIVE** — **Ambiguous / missing / changed targets fail closed**
  (zero clicks, blocker code). *Rationale:* never guess through UI drift.

- **D-007 · ACTIVE** — **Manual progress remains available.** *Rationale:* the
  agent removes work; it must never trap the user.

- **D-008 · ACTIVE** — **Synthetic-first.** Prove the loop on fixtures before any
  live channel. *Rationale:* de-risk; live requires separate approval.

- **D-009 · ACTIVE** — **FE and Runtime ownership are separate.** FE owns product
  layout/copy; Runtime owns geometry/detection/mounting/verification.
  *Rationale:* clean seam; prevents cross-worktree edits.

- **D-010 · ACTIVE** — **The shared contract is the only FE↔Runtime protocol
  truth.** *Rationale:* single source; Runtime exposes only sanitized View Models
  + blocker codes. (Contract not yet authored → R0 blocking dependency.)

- **D-011 · ACTIVE** — **Browser Projection is retained but not required for
  V1.** *Rationale:* reusable optional renderer (State B, not boot-wired); its
  remote input path is unused in production Action Window.

- **D-012 · ACTIVE** — **The parked ESM marketplace-attribution experiment is
  neither completed nor merged.** *Rationale:* its endpoint (auto export click)
  contradicts D-005; reusable concepts are re-authored, not finished in place.

- **D-013 · ACTIVE** — **Reusable concepts may be re-authored in the shared
  engine.** Pure reducers / observers / signatures move into the Action Window
  engine rather than being shipped inside the capture CLI. *Rationale:* preserve
  value without hardening the retired model.

- **D-014 · ACTIVE** — **Historical live evidence is retained but does not define
  production architecture.** *Rationale:* past capture findings inform, but do
  not authorize, production behavior.

- **D-015 · ACTIVE** — **This Runtime branch is based on unmerged PR #209
  (`cf0c845`)**, the only tree with both strategy docs and runtime foundations;
  `main` baseline of record is `5a43dcb`. *Rationale:* documentation must
  reference canonical docs and describe real code simultaneously. Re-verify if
  PR #209 changes before merge.

- **D-016 · ACTIVE** — **ESM+ review is recorded as the strongest current
  technical candidate for the first live pilot, not an irreversible choice.**
  *Rationale:* existing profile/signature/download/upload seams; final channel is
  a product-owner decision.

- **D-017 · ACTIVE** — **Action Window frames ride the EXISTING authenticated
  `/bridge/ws` socket as opaque carriers** (`{type:"aw", payload:string}` both
  directions, plus an agent→client `{type:"aw_session", transportVersion, runId,
  channelCode}` announcement) — NOT a separate socket/ticket (the Projection
  precedent) and NOT new typed Bridge union variants. Pairing + single-use
  ticket + origin allow-list are inherited as-is; run identity is assigned by
  the Runtime and announced, never invented by the FE; reply frames
  (`aw_command_result`/`aw_resync_result`) route to the sending socket only
  while events/views broadcast to every paired tab. FE reconnect = fresh ticket
  + `aw_resync` from sequence 0 (idempotent by eventId/sequence dedupe), pinned
  to the announced runId. *Rationale:* implements the ratified nested-transport
  governance (contract README §8) with zero Bridge v1 semantic change and zero
  contract-dir change; production hosts no session (dev-only synthetic flag).

- **D-018 · ACTIVE** — **Operation Run persistence (R3) is agent-LOCAL and
  file-backed** (`.operation-runs/` dot-dir, atomic schema-versioned records,
  prohibited-content gate on save AND load); **no backend Operation Run tables
  or endpoints are added**. Restore policy: a resumable run re-enters ONLY
  through the PAUSED barrier at a safe stage (steps 1–2 → re-drive the
  read-only automatic chain from `PREPARE_SESSION`; verified-but-unprocessed →
  re-run downstream idempotently) on an explicit `RESUME_RUN`; COMPLETED and
  CANCELLED runs are terminal-protected (restore is read-only, never restarts);
  FAILED runs are resumable and simply fail closed again if the cause persists.
  *Rationale:* local-agent runs must survive restarts offline; the R3 plan rules
  "new backend capability surface" out of scope; and the plan's "caller-less
  `CollectionRunService`" premise is stale (it is upload-wired and models only a
  flat `sync_jobs` row — no step/checkpoint/audit tables). **Mirroring Operation
  Runs into the backend is an open product-owner decision, deliberately not
  assumed here.** The record re-authors the `work/*` invariants (non-positional
  commandId ledger, verification-only completion, append-only ordered audit)
  rather than force-fitting the WorkItem aggregate.
