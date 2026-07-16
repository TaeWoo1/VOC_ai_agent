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

- **D-016 · SUPERSEDED (by D-021)** — **ESM+ review is recorded as the strongest current
  technical candidate for the first live pilot, not an irreversible choice.**
  *Rationale:* existing profile/signature/download/upload seams; final channel is
  a product-owner decision. *(That decision has now been made: D-021 ratifies
  NAVER SmartStore review export; ESM+ remains a later candidate.)*

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

- **D-019 · ACTIVE** — **Platform-policy clarification and provider registration run in
  PARALLEL with R4 pilot preparation** (product-owner ruling, 2026-07-09). They are
  **required before** claiming formal integration, unattended automation, provider
  privileges, scheduled browser operation, or any SellerOps-generated platform click.
  They are **not an indefinite blocker** for a supervised, seller-consented, user-direct
  Action Window pilot in which the seller uses their own account, views the real
  platform, and directly clicks platform controls; SellerOps only prepares, highlights,
  observes, detects completion, and continues downstream; no credentials are typed by
  SellerOps; no CAPTCHA/2FA is bypassed; fail-closed and the audit trail are enforced.
  *Rationale:* explicit product-owner decision in the R4-preparation task; consistent
  with ADR §4 invariants and slice §17's policy gate, which gate REAL-market automation
  claims, not seller-performed actions on the seller's own session. See
  `r4-preparation.md` §4–§5.

- **D-020 · ACTIVE** — **The first real channel is NOT automatically ESM+.** Final
  selection follows, in weight order: (1) the first pilot company's actual channel
  usage, (2) an official seller-center export path, (3) a clear user-direct action,
  (4) compatibility with the current ingestion pipeline, (5) the shortest repeatable
  end-to-end path (product-owner ruling, 2026-07-09; refines — does not supersede —
  D-016, which already recorded ESM+ as "strongest candidate, not an irreversible
  choice"). Current-evidence scoring lives in `r4-preparation.md` §2: NAVER review
  export leads on criteria 2–5; ESM+ review export is the strong second; criterion 1
  is an unresolved product-owner input and is decisive. *Rationale:* the pilot must
  remove real operational work for a real seller, not exercise the technically most
  convenient adapter.

- **D-021 · ACTIVE** — **G1 channel ratification: the first R4 supervised pilot
  channel is NAVER SmartStore review export** (product-owner ruling, 2026-07-09;
  resolves `r4-preparation.md` §9 item 2 and the channel half of item 1; supersedes
  D-016's ESM+-strongest-candidate recording — **ESM+ and Coupang remain later
  candidates**, not rejected). *Why NAVER:* the strongest existing review-export
  evidence in this repository — a live-confirmed, visible+enabled seller-center
  export control (capture→save 2026-06-22) and one full same-session E2E chain
  (2026-06-20); plus an existing validate/upload diagnostic precedent
  (`review-download-save.ts` quarantine save + OOXML magic sniff;
  `review-upload-diagnostic.ts` → `/api/uploads`). *Boundary:* **fixture-only
  adapter code may start after this G1 entry**; live NAVER contact remains blocked
  by the §3 gate (G2–G6), the NAVER live-work pause (stable-environment
  precondition, §9 item 3), and explicit per-run product-owner approval in the
  dispatching turn — G1 authorizes no live action. *Quarantine-save validation
  posture (ratified):* the adapter's real `validateArtifact` MAY perform a
  controlled TEMPORARY quarantine save strictly for validation — extension check +
  OOXML/ZIP magic sniff, then DELETE (extends the 14d observed-and-discarded
  detection posture for the adapter slice only); **no filename, path, URL, or file
  content ever crosses the wire, the persisted store, or logs** — only sanitized
  enums/booleans/buckets and opaque 16-hex `artifactRef`s. *Rationale:* the D-020
  criteria applied — NAVER leads §2 criteria 2–5 on repository evidence, and the
  decisive criterion-1 input was resolved by the product owner in making this
  ratification; the pilot seller's identity is still to be named for G2 consent.

- **D-022 · ACTIVE** — **The R4 downstream ingest handoff rides the EXISTING upload/ingestion
  path; the driver never touches the network** (implemented fixture-only, 2026-07-10; extends the
  D-021 downstream posture). After quarantine validation, the verified artifact is handed to the
  already-shipped `POST /api/uploads` → `IngestionService` → `ReviewRowMapper` → dedup →
  item-analysis path (dedup key = `리뷰글번호` = `external_id`, scoped by org+channel). **No backend
  capability is added.** *Boundaries (ratified):* (1) the upload capability is **injected** into the
  driver as an `AwIngestUploadFn` callback — the `NaverFixtureProbeDriver` never imports `../upload`
  and stays network-free (source guard unchanged); the real `login → resolveChannelId →
  uploadReviewBytes` hookup lives in a separate channel-neutral `ingest-handoff.ts`. (2) Only the
  sanitized `{ ok, processed }` crosses back to the engine — the rich backend `IngestResult` (status
  text, `syncJobId`, `errorMessage`, `sampleErrors`, exact counts) is reduced in `ingest-handoff.ts`
  and never reaches the driver, the wire, or the persisted Operation Run; `onIngested` reads only
  `ok`, and `processed` is persisted nowhere. (3) The multipart filename on the wire is an opaque
  `aw-<artifactRef>.xlsx` derived only from the engine's 16-hex ref — the platform's suggested
  filename is never uploaded. (4) A non-`ok` outcome fails the run closed with the **generic reserved
  `UNSUPPORTED_STATE`** — a dedicated `INGEST_FAILED` code touches `contracts/**` + `schema.json` +
  the drift test + FE copy mapping and stays a **deferred governed contract change** (PO decision
  2026-07-10: keep generic for this slice). *Deferred:* browser-driver real ingest over a real
  Playwright `Download`; a full fixture-xlsx → real-POI end-to-end (blocked by the no-new-dependency
  rule — the fixture emits fake OOXML-shaped bytes, and a real backend-parseable workbook needs an
  xlsx-writer). *Rationale:* D-020 criterion 4 (compatibility with the current ingestion pipeline)
  and the §4.2 honesty boundary — a real ingest is a real DB state change, reported honestly, but the
  sanitization/injection boundary keeps every raw identifier off the wire and the persisted store.
  Live NAVER remains blocked by the §3 gate (G2–G6), the live-work pause, and per-run PO approval.

- **D-023 · ACTIVE** — **The NAVER *fixture* channel is wired into the local-agent Action Window boot
  behind a dev-only flag; production still hosts no session** (implemented fixture-only, 2026-07-11;
  extends D-017 hosting + D-021/D-022 downstream). The D-017 Bridge nested transport was already
  boot-wired end-to-end (`local-agent.ts` → `agent-bridge.ts` → endpoint → engine → session → R3
  persistence) but only ever injected `SyntheticProbeDriver`. This entry adds a **driver-selection**
  seam, not a new transport: `resolveActionWindowChannel(args, env)` returns `synthetic |
  naver-fixture | null` (both flags **dev-only**, never under `NODE_ENV=production`), and
  `buildActionWindowConfig` injects `createDriver: () => new NaverFixtureProbeDriver("normal", …)` for
  the NAVER channel via the SAME already-injected `AgentActionWindowConfig.createDriver` — `agent-bridge.ts`
  is unchanged. *Boundaries (ratified):* (1) the NAVER-fixture boot is **still fixture-only** — no
  browser, no live NAVER, no marketplace; it runs the real detect + quarantine-validate chain OFFLINE
  over the fixture's byte-carrying artifact (gitignored `.aw-quarantine/`, new `defaultQuarantineDirFor`)
  and its **ingest stays SYNTHETIC** (`{ok:true,processed:1}`) so the loop completes with zero network.
  (2) The real `/api/uploads` ingest is **opt-in** behind a SEPARATE `--dev-action-window-ingest-local`
  flag (dev-only) that injects `buildBackendIngestUpload` against a **LOCAL dev backend** using the
  SellerOps dev creds from `loadConfig(env)` — never a live marketplace, never the default. (3) The run
  identity stays Runtime-assigned (opaque `run_<hex>`); R3 persistence is always on; a cold agent
  restart resumes the persisted NAVER run (parked at PAUSED) and completes through downstream — proven
  over the REAL Bridge WS via `createAgentBridge` (the actual boot composition). (4) The **headed
  operator proof** (a real human review-export click in a visible Chromium over a NAVER-*shaped*
  synthetic fixture page → detect → quarantine → completion) is **delivered as a gated harness**
  (`naver-browser.test.ts`, `RUN_INTEGRATION=1 AW_HEADED=1`) but is **operator-present only** — run in a
  separate seated turn, never during implementation or CI. *Deferred:* a real NAVER-driver ingest over a
  real Playwright `Download`; full fixture-xlsx → real-POI E2E (no xlsx-writer dep); a dedicated
  `INGEST_FAILED` contract code; FE copy mapping for `actionWindow.step.downstream` /
  `actionWindow.run.naver`. *Rationale:* the D-020 shortest-repeatable-E2E criterion and slice §14-11
  (synthetic-first) — the remaining runtime code gap before a supervised pilot was connecting the
  ratified adapter to a drivable session, and that seam is now closed fixture-only. Live NAVER remains
  blocked by the §3 gate (G2–G6), the live-work pause, and per-run PO approval; production hosts no
  Action Window session (the flags are dev-only).

- **D-024 · ACTIVE** — **G2 pilot-seller ratification: the first R4 supervised pilot runs on the
  operator's OWN development NAVER seller account, recorded only as the sanitized label
  `NAVER_DEV_SELLER_SELF_01`** (product-owner decision, 2026-07-12; resolves the still-open
  seller-identity half of `r4-preparation.md` §9 item 1, complementing D-021's channel half). *Why:*
  a user-owned test/dev account is the §4-compliant pilot subject — the operator is both the
  product-owner and the operating seller, so consent is self-consent and no third-party data is ever
  touched. *Privacy (ratified):* the seller is referenced ONLY as `NAVER_DEV_SELLER_SELF_01`
  throughout the repo — no raw account ID, email, username, raw URL, credential, cookie, token, or
  profile path is ever recorded (same sanitization contract the adapter enforces on the wire and the
  persisted store). *Gate effect:* records **G2 (seller consent) ✅** — self-consent acknowledging the
  §4 boundary verbatim, with the first authorized live run scoped to the **read-only
  session-precondition probe only** (no locate/click/export/download); and **G5 (policy track) ✅
  logged** — per §5, a seller-owned export on the seller's own session requires no platform grant
  (Solution Market stays a long-term option, not a prerequisite; no platform marked "approved"). This
  flips `r4-preparation.md` §1 **P7** and **P8** to ✅. *Boundary:* **this entry authorizes NO live
  action.** **G3 (stable environment + the NAVER live-work pause lift) and G6 (explicit per-run
  approval in the dispatching turn) remain the only live gates** — both operator/PO-owned, neither
  Runtime code; §3's internal-gate sign-off (P6) and the per-run approval (P12) stay open until they
  clear. Register: [`r4-gate-record.md`](r4-gate-record.md). *Rationale:* slice §4/§14 (supervised,
  seller-consented, user-direct pilot on a user-owned account) and the §3 gate order — the recordable
  gates (G2/G5) are now closed against a named-but-sanitized seller; the environment and per-run
  gates stay with the operator.

- **D-025 · ACTIVE** — **Period/scope is a GUIDANCE-ONLY §4 human precondition. The export-target
  readiness gate answers *exportability* and never *scope*; the Runtime observes and logs the
  period/scope state but never gates on it** (product-owner decision, 2026-07-16; resolves the OPEN
  question Run 5 raised — is the unreachable `EXPORT_DATE_RANGE_REQUIRED` rung a defect or
  correct-by-design? **Answer: correct-by-design, for a reason that is NOT the one Run 5 suggests**).
  *What is decided:* selecting the review period/scope stays the seller's own §4 obligation
  ([`r4-gate-record.md`](r4-gate-record.md) §4, "selects period/scope"), carried by the operator-facing
  CLI prompt. The Runtime **observes** it (`action-window/naver-surface.ts` — the Run 5 seam reads the
  range signals independently of the readiness ladder) and **logs** it (`aw.live.readiness`, fixed
  enums/booleans only). It does **not** gate, does **not** block, and does **not** model it as a step.
  *Rationale — the CATEGORY argument, deliberately NOT Run 5:* the gate's chartered question is "does
  the current result contain exportable review targets" (`naver/export-target-readiness.ts` module
  docblock). A labeled positive count over a populated grid is direct evidence that the filter state —
  default or seller-chosen — **already resolved to exportable rows**. *"Is there something to export"*
  and *"is the scope what the seller meant"* are different propositions: the first is a platform
  mechanism, the second is product intent. Putting product intent into a mechanism gate is a category
  error. **This argument needs no live run and is unaffected by anything Run 5 did or did not show.**
  ⚠ *What Run 5 does NOT establish (recorded so this decision is never re-derived from it):* Run 5
  (§8-18) is **silent** on whether NAVER requires a period. `action-window/observer.ts` installs a plain
  DOM `click` listener, so `observed: true` means **a human acted on the highlighted control** — never
  that the platform accepted the request. `action-window/naver-live-driver.ts` passes verify's
  `completionSignalPresent` as a hardcoded `true` (documented deliberately: there is no proven
  post-action DOM completion marker for live NAVER, so **the download is the only artifact evidence**),
  and Run 5 had no download. `dialogMatchesRecordedConsentMarkers` was `NOT_OBSERVED`. So Run 5's
  `DOWNLOAD_TIMEOUT` is **equally consistent with consent-declined, range-refused, and click-no-op**.
  It establishes only that *our own gate* does not require a range — knowable by inspection, needing no
  run. **Do not cite Run 5 as evidence that the platform tolerates an unselected period.**
  *(b) READINESS BLOCKER — rejected:* making the gate require a selected range would put a **negative**
  condition ahead of **positive** row/count evidence — structurally the same mistake as the pre-§8-14
  marker-first order, which "HALTed a genuinely-exportable surface", and against **strictly weaker**
  evidence (the empty-state marker at least matched real text on the real page; `selectedRangePresent`
  has never been observed `true` on any surface, live or fixture). Hidden second half of the blast
  radius: `naver/export-surface-settle.ts` treats `EXPORT_DATE_RANGE_REQUIRED` as a **trusted terminal
  halt**, so an early-firing date condition would return `halt` on the first pre-hydration read and
  **silently disable the §8-11 settle window**, re-opening the Run-1 false-positive-empty. Revert cost
  is **a G6** (the §8-8 → §8-15 arc cost five live runs), not a line of code.
  *(c) SEPARATE OBSERVED STEP — rejected:* its premise expired on 2026-07-16 — the Run 5 seam already
  observes period/scope, so (c) buys what is already shipped. Its only completion oracle would be (b)'s
  detector. `action-window/stages.ts`'s `STEP_PLAN` is channel-neutral, and `totalSteps` is on the wire
  **and persisted**, so a 3→4 change would ride protocol v1 silently past the exact-match compatibility
  check and force a migration of already-persisted runs.
  ⚠ *Why the detector cannot be promoted on today's evidence:* `naver/export-click-signals.ts`'s
  filled-range regex matches the `value` **attribute** in serialized HTML, but every live read is
  `page.content()` and a user- or JS-set input value updates the IDL **property**, leaving the
  attribute untouched. On an SPA date picker the detector may be **structurally incapable of ever
  returning `true`** — which would make (b) a **100% halt rate**, discoverable only by spending a G6.
  Per `collector/CLAUDE.md` §4 item 6 the markers stay **placeholders**; this decision promotes nothing.
  *Falsifier (this decision is designed to be reversible):* a future click run whose operator **does**
  select a period, reporting `selectedRangePresent`. `true` → the detector is validated and (b) may be
  revisited **on evidence**. `false` → the attribute/property blindness is confirmed, and (b) and (c)
  are both off the table until a **different** detector exists. **It costs nothing — it rides any
  future click run.** *Boundary:* **this entry authorizes NO live action.** The `naver-surface.ts`
  "logged, as fixed enums only" relaxation stays **log-only** — never extended to transport or
  persistence; `BLOCKER_CODES` stays the **fixed 8** (no period/scope blocker code — that would be a
  governed contract change). The date rung and `EXPORT_DATE_RANGE_REQUIRED` are **retained, not
  deleted**: they are fail-closed HALTs that cost nothing dormant, they preserve the §8-14 lineage, and
  an offline test now locks their unreachability so a future rung reorder trips a test rather than
  silently waking a gate on an unproven detector.
