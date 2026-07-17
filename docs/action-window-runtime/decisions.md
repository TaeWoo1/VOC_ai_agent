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

- **D-026 · ACTIVE** — **G3 is a per-run gate, exactly like G6. Its environment conditions AND its §9-3
  live-work pause lift are both affirmed fresh in the dispatching turn, scoped to that one run, and
  consumed with it. G3 has no standing ✅** (product-owner decision, 2026-07-16; resolves the question
  the #273 gate-summary slice deliberately left open — *is G3 formally per-run, like G6?* **Answer: yes,
  and it already was — only the definition and the glyph had not followed**).
  *What is decided:* G3 is the compound D-024 already names — **stable environment** (network/IP/location,
  dedicated Chrome profile, paired Bridge, Operation Run persistence) **+ the §9 item 3 NAVER live-work
  pause lift**. Every part is affirmed **fresh in the dispatching turn**, **scope-bound** to the single run
  it authorizes (read-only / export / export+ingest / real-click are distinct scopes and never substitute
  for one another), and **consumed** with that run. Goal pressure, prior affirmations, and this register
  never carry over. G3's register status is therefore **`☐ per-run`** — the same category label the §8-1
  pack already uses for G6.
  *Rationale — this ratifies practice, it does not change it:* the repo already operates G3 this way
  everywhere it **acts**. The **signed** export P6 sheet is the sharpest evidence:
  [`r4-export-dispatch-record.md`](r4-export-dispatch-record.md) block A (`:21-31`) — *"Already established
  (static — carried in, not re-affirmed here)"* — lists G1/G2/G4/G5/P7/P10 and **omits G3**, and `:75`/`:77`
  tick `G1–G5 all ✅` and `G3 re-affirmed for export` as **two separate boxes**: G3 is sourced from a
  run-scoped block, never from the register. Seven executed dispatch records each carry their own fresh,
  scope-labeled G3 block; [`r4-run5-barrier-observation-dispatch-record.md`](r4-run5-barrier-observation-dispatch-record.md)
  `:56` records `G3 ☐ DOES NOT CARRY`; `r4-probe-…:36` / `r4-rowshape-…:41` / `r4-run3-…:51` / `r4-run4-…:90`
  call earlier **G3 lifts consumed**; and the register's own export re-affirmation block
  ([`r4-gate-record.md`](r4-gate-record.md) `:254-257`) is already all-☐, environment boxes included. The
  gate summary already stated the rule in prose (`:315-317`, PR #273).
  ⚠ *Why the "environment is standing state, only the lift is per-run" reading was REJECTED (recorded so it
  is not re-derived):* the dispatch records refute it. `r4-run5-…:68-74` leaves **all four boxes ☐,
  environment included**; `r4-run2-…:32-36` ticks all three `☑` in one turn on one date. The operator
  performs the **same act** on both halves. The `still holds`/`intact` vs `fresh, single-run lift` verb
  split is real (`r4-gate-record.md:254-257`) but it marks **epistemic kind** — a fact you re-verify vs a
  decision you renew — **not lifetime**. Both have one lifetime: one run. Splitting them would have
  preserved the exact standing ✅ this decision exists to remove.
  *Gate effect:* G3's status becomes **`☐ per-run`** ([`r4-gate-record.md`](r4-gate-record.md) §G3,
  [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-1), and [`r4-preparation.md`](r4-preparation.md) §3's G3
  definition now names the §9-3 lift and the per-run lifetime (§3 defined G3 as environment only — the one
  normative text out of step with D-024, the register, and 8/8 dispatch records). P6's *"already"* list
  (`r4-gate-record.md:263`) drops G3 to match signed block A; G3 stays with `:265`'s existing run-scoped
  box, so **P6's requirements are unchanged in substance**.
  ⚠ *No gate failed and no capability changed.* The 2026-07-12 environment confirmation was real; it and
  every later lift are **retained verbatim as dated CONSUMED instances** — the shape G6 has carried since
  `r4-gate-record.md:103`/`:126-144`. **`☐ per-run` is a category label, not a failure marker.**
  *Boundary:* **this entry authorizes NO live action.** It removes no requirement and grants no lift — it
  makes the register unable to *look* like it grants one. Any live contact still needs a fresh,
  scope-matched G3 **and** a fresh single-use G6 in the dispatching turn under the full §4 boundary.
  Register: [`r4-gate-record.md`](r4-gate-record.md).

- **D-027 · ACTIVE** — **The runtime has a no-ingest mode (`--no-ingest`), and a declined handoff lands
  CANCELLED with the downstream step SKIPPED — no new terminal, no new blocker code, no schema bump. The
  discovery `--classify-only`/`--no-upload` flags are REFUSED here, not reused** (Milestone A1, 2026-07-16).
  *What prompted it — a real footgun:* `isClassifyOnly` / `CLASSIFY_ONLY_FLAGS` were exported, parsed, and
  unit-tested, and `run-action-window-live-naver.ts` **never imported them**. argv reached only the approval
  check, so `--no-upload --i-understand-this-opens-live-naver` performed a **full live run including a real
  `/api/uploads` write**, with no diagnostic that the flag was ignored. A green unit test on a predicate
  proved nothing about its caller. The structural lock is now a source guard on the CLI, and the refusal
  test **loops `CLASSIFY_ONLY_FLAGS`** so a future third alias is covered automatically.
  *Why the flag is refused rather than reused (product-owner decision):* the alias pair is **indivisible** —
  `isClassifyOnly` cannot honour `--no-upload`'s plain-English meaning without simultaneously giving
  `--classify-only` a **click-and-capture** meaning. `collector/CLAUDE.md` §3 records that both discovery
  classify-only paths are **no-click**, source-guard-proved, and that the *only* triggering path is the
  deliberate full-capture leg. Reusing the flag would swap a DB-write footgun for a **real-click footgun**,
  under the one flag whose entire reputation is *"nothing happens"* — moving the bug, not removing it. So
  `--no-ingest` is a new, honestly-named, Action-Window-scoped flag; the discovery flags are refused with a
  **model-correcting** message (exit 5) that names `--no-ingest` **and** warns it is not no-click.
  `collector/CLAUDE.md` §3/§4.2 are untouched.
  ⚠ *`--no-ingest` is NOT a safety feature and must never be documented as one.* It is **strictly more
  mutating than not acting**: it opens live NAVER, a human performs a real export action, and a real file
  lands in quarantine (validated, then dropped). The lever that is non-mutating **by construction** is
  still **don't act** — no download, no artifact, benign `DOWNLOAD_TIMEOUT` (live Runs 2–3). `--no-ingest`
  earns its place for exactly one purpose: exercising **detect + quarantine-validate against a real
  artifact without a DB write** — the leg Run 4 (§8-17) could only prove by fusing all three in one shot at
  the cost of **55 irreversible rows**.
  *Why CANCELLED is honest, not least-bad:* the contract has **no** representation for "validated but not
  ingested" (`grep -rni ingest contracts/` → zero hits). `COMPLETED` is reachable only through a real
  `onIngested({ok:true})` and would be the fabricated completion the runtime structurally forbids
  (`collector/CLAUDE.md` §4.5). `FAILED` needs one of the eight reserved `BLOCKER_CODES` — **all eight would
  be lies**; nothing failed, so **no blocker is set**. `CANCELLED` *is* the operator's pre-declared stop
  (`CANCEL_RUN` is already accepted in `INGEST_HANDOFF`), it projects step 3 as **`SKIPPED`** — which is what
  actually happened — and `resumeStateFor` classifies it **TERMINAL**, so a declined run can never be
  resumed into the ingest it just declined.
  ⚠ *Rejected designs (recorded so they are not re-derived):*
  **(a) `PAUSED` — a loaded gun.** `operation-run.ts:113` classifies `activeStepIndex >= 3` as
  `RESUME_DOWNSTREAM`, so a parked no-ingest run would be resumed by `openOrResumeRunSession` **and ingest**.
  **(b) A no-op `AwIngestUploadFn` returning `{ok:true, processed:0}`** → engine `COMPLETE`. Banned by an
  in-code invariant (`naver-live-driver.ts:74-76`, *"a synthetic completion is never fabricated"*) and §4.5.
  **(c) `RunConfig.classifyOnly`** — flows into `PersistedEngineState`; unpersisted it would die on restore,
  which is **the A1 footgun resurrected through the persistence path**, so it forces persistence and
  plausibly `OPERATION_RUN_SCHEMA_VERSION` 2→3.
  **(d) Driver-level refusal** — `driver.ingest` *would* be called and `{ok:false}` → `UNSUPPORTED_STATE` →
  FAILED. A lie.
  **(e) The operator client sending `CANCEL_RUN` on the published view — BROKEN, not merely inelegant.**
  The loopback delivers synchronously and `session.drive()` computes the next effect **before**
  `publishState()` and never re-reads the stage, so the cancel would land, the stage would become CANCELLED,
  **and `driver.ingest()` would upload anyway**; `onIngested` would then throw into `fatalCleanup` while a
  re-entrant `handle()` corrupted `autoBusy`. **Any view-driven interception is unsound** — the check must
  sit inside `drive()`, before the `await`. That is where it is.
  *Shape:* the executor decides, the engine records. `session.ts` `case "INGEST"` checks the run-scoped
  policy before the `await` and calls the new `engine.declineIngest()` (four lines, reusing the existing
  private `cancel()`). The policy is deliberately **not persisted** — it belongs to the invocation, not the
  run, so a restored run never half-remembers it. Defence in depth: under `--no-ingest` the real uploader is
  **never constructed** (the dev creds never enter a closure); the guard in its place **throws**, because
  reaching it means the first barrier is broken and that must be loud rather than a quiet upload.
  *Claim corrected:* the mid-run `CONFIRM_PROMPT` asserted *"there is no no-ingest mode"* and
  [`HANDOFF.md`](HANDOFF.md) asserted it *"still holds for every future run"*. Both are now false and both
  are fixed. The prompt is now `confirmPrompt(declineIngest)` — what the human is told about the fate of
  their data is **derived from what this run will do**, the same rule the timings already followed after
  D-025. The default path's wording is unchanged in substance: a validated download **is** ingested, really
  and irreversibly.
  *Boundary:* **this entry authorizes NO live action and consumes no gate.** A1 is offline (code + tests +
  docs). Shipping a capability is not authorizing a scope: no `--no-ingest` G6 template is pre-written, and
  any live use still needs a fresh, scope-matched G3 **and** a fresh single-use G6 in the dispatching turn.

- **D-028 · ACTIVE** — **`LOGIN_REQUIRED` / `SESSION_EXPIRED` PARK instead of failing closed: the run stays
  alive at `WAITING_FOR_HUMAN` with `recoverable: true`, and `REQUEST_STEP_RECHECK` re-probes the surface for
  real. No contract change, no FE change, no schema bump, no 4-step plan** (Milestone A2-B, 2026-07-16).
  *What prompted it:* a login/reconnect interstitial killed the run. `fail()` hardcodes `recoverable: false`
  and lands `FAILED`, whose `allowedCommands` is `[]` — so **the two most obviously human-fixable causes were
  reported to the seller as unrecoverable, with no affordance**. `recoverable: true` was produced **nowhere in
  production code**: the field was plumbed end-to-end (persist → validate → view → wire) carrying exactly one
  value, while `resumeStateFor` separately and correctly classified those same runs `RESUME_FROM_FAILURE`. The
  two disagreed and only the second was true. Meanwhile the **FE affordance was already built and waiting** —
  `HumanCheckpointCard` renders `BlockerNotice` with `recoverable` and gates its 확인 완료 button purely on
  `allowedCommands.includes("REQUEST_STEP_RECHECK")`, and `copy.ts` has shipped Korean copy for both codes all
  along. The gap was **entirely runtime-side**.
  *Shape:* a new non-terminal stage `AWAIT_SESSION_RECOVERY`; `onSurfaceReady` switches **exhaustively** over
  `SurfaceBlockerCode` (already exactly `LOGIN_REQUIRED | SESSION_EXPIRED | UNSUPPORTED_STATE`) so the two
  seller-fixable codes park and `UNSUPPORTED_STATE` stays terminal **by construction — a 4th code would be a
  compile error, not a test failure.** `park()` sets no `RUN_FAILED` (nothing failed) and **no
  `HUMAN_ACTION_REQUIRED`** (that event is how `humanCheckpoint.reached` is derived, and the checkpoint means
  step 2 — emitting it at a step-1 park would record a barrier the run never reached, the same audit-lie class
  Run 5 spent a G6 fixing). It also **resets `activeStepIndex` to 1**: `resumeStateFor` tests `FAILED` before
  `activeStepIndex >= 3`, so a run that failed downstream resumes through `PREPARE_SESSION` still carrying
  index 3 and would otherwise project *"step 3 of 3"* while parked on a step-1 session probe.
  *A2-B invents no semantics — it applies the contract's own rule.* The contract README already states
  `REQUEST_STEP_RECHECK` means only *"the user reports that they performed the requested action; Runtime must
  observe and verify again"* — there is intentionally no `CONFIRM_STEP_COMPLETED`. So **a human assertion never
  clears the blocker**; only a fresh `onSurfaceReady({ok:true})` clears-and-advances. (⚠ Precise invariant:
  `pauseForRestore` also clears the blocker, but it clears-and-**reparks** — the resumed run re-probes and
  parks again if the cause persists. A restart is not a human assertion.)
  ⚠ **KNOWN LIMITATION — a successful login can still kill the run, and this is recorded, not overlooked.**
  The driver **never navigates** (`prepareSurface` reads the page "as the seller left it"), and the CLI
  navigates exactly once, before the run. So a recheck probes whatever page login landed on; if that is not the
  export surface, readiness HALTs → `UNSUPPORTED_STATE` → terminal. **Where NAVER lands a seller after login is
  UNOBSERVED**, and per `collector/CLAUDE.md` §4 item 6 it stays unobserved until a run reports it.
  *PO decision:* "the seller is back on the review-export surface" is a **guidance-only §4 human precondition** —
  the same category [D-025](decisions.md) ratified for period/scope: **the Runtime observes, never gates.** No
  navigation capability is added and the dormant `OPEN_TARGET_SURFACE` stage stays dormant. The bad case is
  fail-closed and **no worse than today's behavior**, at zero clicks. An offline test **locks this as known**
  rather than leaving it to be discovered. *Falsifier — free, rides any future run:* an operator who logs in and
  reports whether the export surface is still readiness-`READY` afterwards. `true` → the loop closes unaided;
  `false` → a navigate seam becomes a real PO question, **on evidence**.
  ⚠ *Why the 4-step plan (option (a)) was REJECTED — its premise was FALSE, and I had offered the fork wrongly:*
  **the contract fixtures are schema-valid examples, not engine goldens.** The only test over
  `contracts/**/fixtures/` is a `validateRunView` schema check plus a filename-existence check; **no test asserts
  the engine can produce any fixture**. Fixture `04-waiting-for-user` is the already-shipped, **live-proven**
  human barrier and it **already** diverges from the engine on channelCode, stepId, stepNumber (3 vs 2),
  totalSteps (4 vs 3), copyKey **and** allowedCommands (3 vs 6) — five live runs went through it. So adopting a
  4-step plan would **not** make fixture 10 projectable (its stepId is `esm.prepare_session`, channelCode
  `esm_plus`); it buys agreement on **one integer** while ~22 collector sites hardcode `totalSteps: 3`, forces
  `OPERATION_RUN_SCHEMA_VERSION` 2→3 plus a real migration, and D-025(c) had **already rejected a 3→4 change on
  its own merits** for a different feature. **A2-B is not the cheap option; it is the correct one.**
  *Fixture divergence: REPORTED, not resolved (PO, 2026-07-16).* The three "sources of truth" — contract
  fixtures (4-step/ESM), engine (3-step/`aw.*`), FE fixtures (`TOTAL = 4`) — are **three-way inconsistent and
  nothing detects it**. `contracts/**` is off-limits from this branch; whether to re-author the fixtures to the
  engine's channel-neutral vocabulary or declare them aspirational is a **deferred PO decision**.
  *Accepted costs, recorded so they are not rediscovered as defects:* (1) the persisted record self-contradicts
  — `executionMode: ACTION_WINDOW` (from the view) alongside `tasks[0].mode: AUTOMATIC_OPERATION` (from the step
  plan) with `status: AWAITING_USER`, unvalidated by `parseOperationRun`; that is the honest cost of parking on
  an automatic step. (2) Unbounded rechecks grow the event log and re-validate the whole record per write; the
  store is dev-only, so this is accepted, not fixed. (3) The FE renders a **degraded** card — `copy.ts`'s `COPY`
  map has no key the Runtime actually emits, so the headline falls back to "안내를 준비하고 있어요" over hardcoded
  export-barrier prose; only the nested `BlockerNotice` says "log in". **Not caused by A2-B, not fixable from
  this branch.**
  *Also corrected:* `cancel()` never cleared the blocker — harmless only while a blocker implied `FAILED` (which
  accepts no commands). A park accepts `CANCEL_RUN` **and** holds a `recoverable: true` blocker, so without the
  clear a CANCELLED view would claim to be recoverable while offering no command that could recover it. The
  audit record survives in the event log.
  *Boundary:* **this entry authorizes NO live action and consumes no gate.** A2-B is offline (code + tests +
  docs); its recovery loop is proven **only** over the loopback in `session-integration.test.ts`. The **CLI
  cannot exercise it** — `main()`'s `finally` closes the browser the moment `driveOneRun` returns, so the seller
  gets no time to log in; driving the recovery from the CLI is **A3**. Any live use still needs a fresh,
  scope-matched G3 **and** a fresh single-use G6 in the dispatching turn.
  > ⏩ **Superseded in part 2026-07-17 by [D-029](#) (A3).** "The CLI cannot exercise it" is **no longer true** —
  > the CLI now drives the recovery through an injected operator gate. Everything else in this entry stands,
  > including that the recovery remains **offline-proven only** and that live use needs a fresh G3 + G6.
  > ⚠ Accepted cost (2) above — *unbounded rechecks* — is bounded by A3 **on the CLI path only**; the FE/Bridge
  > path is still unbounded. D-029 did not fix it there.

- **D-029 · ACTIVE** — **the CLI drives the recovery park: prompt → the seller logs in → they signal → the
  Runtime re-probes for real. Bounded by a SHARED 10-minute budget, not per-attempt timeouts. No contract, FE,
  backend, schema, stage or navigation change** (Milestone A3, 2026-07-17).
  *What prompted it:* [D-028](decisions.md) shipped recoverable parks and then recorded, in three places, that
  **the CLI could not exercise them** — `main()`'s `finally` closes the browser the instant `driveOneRun`
  returns, so a live park gave the seller zero seconds to log in. The engine offered recovery, the FE affordance
  was already built and waiting, and the one entrypoint that drives real NAVER tore the browser down first. A3
  closes exactly that gap and adds no Runtime capability — it is a pure consumer of A2-B's seam.
  *A3 is also the DELIVERY VEHICLE for a decision that was ratified but never implemented.* D-028 ruled "the
  seller is back on the review-export surface" a **guidance-only §4 human precondition** (the D-025 category:
  observed, never gated). `confirmPrompt` carries the equivalent for the initial wait; **a recovery had no
  prompt at all.** A guidance-only precondition with nowhere to print the guidance is guidance nobody reads.
  `recoveryPrompt` is the first and only place it is delivered on the CLI path — and it states the consequence
  plainly: the Runtime does not navigate, so a wrong page ends the run at terminal `UNSUPPORTED_STATE`.
  *Shape:* the loop lives in `driveOneRun` (the only exported, testable seam — tests cannot call `main()`); the
  console/fs/page I/O lives in `main()` behind an injected `RecoveryGate`. `awaitRecovery` is **optional**, so a
  caller with no operator to reach behaves exactly as before A3 — which is both honest semantics and the
  default-path proof (every pre-A3 test passes unmodified, including the gated browser park test).
  ⚠ **PO decision 1 (2026-07-17) — the bound is TIME, not attempts.** A first pass proposed 3 attempts × a
  10-minute timeout each. Rejected on two findings: (a) **a cap was never the real bound** — with the stale
  sentinel fixed, every iteration costs either a deliberate human file-create or a full timeout, and a timeout
  breaks the loop, so an uncapped loop cannot spin; (b) **3 attempts buy almost nothing for D-028's dominant
  case** — a seller who logs in but lands off the export surface yields `LOGGED_IN` → readiness HALT →
  `UNSUPPORTED_STATE` → **FAILED at attempt 1**; attempts 2-3 only help someone who signalled ready before
  finishing login. A shared `RECOVERY_BUDGET_MS = 10 * 60_000` is monotonic regardless of attempt count and
  degrades into an honest operator sentence — *"you have N minutes"*; *"you have 3 tries"* is not one, because a
  try costs nothing at the seat. `MAX_RECOVERY_ATTEMPTS = 3` survives **only as a spin backstop** with its own
  distinct outcome, so that if it ever fires we learn the trap reopened rather than blaming the seller.
  ⚠ **GOVERNANCE — a future G6 now authorizes a materially LONGER live window.** Worst-case time a live NAVER
  browser is held open: **~21 min before A3 → ~32 min after** (the rejected per-attempt design would have been
  ~52 min). D-028's boundary requires a fresh scope-matched G3 **and** a fresh single-use G6 per live run; it
  says nothing about duration, and duration is what changed. **This belongs in the next dispatch record — it
  must not be discovered at the seat.**
  *PO decision 2:* the recovery prompt is **self-contained** — it re-states THIS RUN'S ingest consequence,
  derived from `declineIngest` (reusing `PROMPT_INGEST`/`PROMPT_NO_INGEST`), because a park can insert a
  ten-minute login detour between `confirmPrompt`'s irreversibility warning and the moment the seller acts on
  the highlight. It obeys `confirmPrompt`'s doctrine: timings interpolated from the constants, never restated.
  ⚠ **The stale sentinel — a violation of a precondition that was ALREADY WRITTEN DOWN.** `main()` clears the
  sentinel at startup and in its `finally`, **never in between**, so the "ready" file the seller created before
  the run is still on disk when a park happens. A bare second `waitForSentinel` returns `true` on its first
  `existsSync`: the recheck fires milliseconds after the park against the same logged-out page, re-parks, and
  drains the loop — logging an exhaustion **indistinguishable from a seller who walked away**. The seller never
  gets a chance and nothing errors. This is not a new insight: `probe-same-session.ts` documents the rule
  verbatim — *"The caller clears any stale sentinel BEFORE calling this"* — and **this CLI's copy dropped that
  sentence** (the 13 `waitForSentinel` bodies are identical; the docstrings are not). `awaitFreshSentinel` makes
  the written contract structural, and its trap test fails in under a millisecond without it.
  ⚠ **`outcomeOf` must be TOTAL and assert "recovered" POSITIVELY — the correction that matters most.** The
  obvious shape (`isParked ? … : FAILED ? … : "recovered"`) reports **"recovered" for a run that just died**:
  when `prepareSurface` throws, `session.ts`'s `.catch(() => fatalCleanup())` tears the driver down and never
  publishes, so the last view is `reprobeSession`'s `PREPARING` + blocker. Nothing else produces that shape,
  which is what makes `driver-error` detectable with no driver change. **That log line would have been the same
  audit-lie class D-028 rejected `HUMAN_ACTION_REQUIRED` for — and ours, not inherited.** The dishonest *view*
  is pre-existing (a first-probe throw does it today); the dishonest *log* would have been new.
  ⚠ **D-028's falsifier is NOT free, contrary to a claim made while planning this slice.** `lastDiagnostic` is
  assigned **after** an unguarded `page.content()`, so a thrown probe leaves the PREVIOUS probe's value in
  place. Today at most one probe runs per CLI process, so staleness is unobservable; A3 makes up to four, and
  A3's premise is a seller who just logged in and navigated — exactly when a page read throws. The single
  post-run `aw.live.readiness` line could therefore report the **pre-login** readiness as post-login evidence:
  the falsifier **or a stale lie, indistinguishably.** Fixed at the CLI boundary — `onRecoveryProbe` logs the
  diagnostic **per attempt** (preserving the progression the single line destroys) and is withheld on
  `driver-error`, because stale ⟺ threw ⟺ that outcome. *Guarding `page.content()` in the driver is the deeper
  fix and is out of A3's file scope — reported, not done.*
  *`blockerCode` rides every recovery line* because it is what makes `"failed"` legible: `UNSUPPORTED_STATE`
  means *logged in, surface not ready* (**falsifier = FALSE**), while `TARGET_NOT_FOUND` means *logged in,
  surface READY, control unlocatable* — a completely different finding. `safeMeta` filters log **keys**, never
  values, so the enum survives. (It also silently drops any key containing `session` — `sessionOutcome` would
  have vanished with no error.)
  *Also:* `awaitRecovery` takes `RecoverableSurfaceBlockerCode`, not the 8-code `BlockerCode`, keeping the same
  compile-time property `onSurfaceReady`'s exhaustive switch bought — a future third recoverable code cannot be
  silently absorbed at this boundary. `LiveRunOperatorClient` now records `lastRejection`: a rejected recheck
  drives nothing, so an unguarded loop would re-prompt the operator for the whole budget. Rejection is
  unreachable today, but only via a proof spanning three modules — a **loop** must not rest on that.
  ⚠ *The §8-19 footgun, a THIRD time — and the source guard against it was itself vacuous.* `--no-upload` was
  exported, tested, and never imported by its caller. `awaitRecovery` has the identical shape: optional, with an
  untestable `main()`. The guard written to lock the caller wiring initially asserted `/awaitRecovery:/`, which
  **`recoverLoop`'s own type signature satisfies** — renaming `main()`'s wiring left it green and the live CLI
  dead. Caught only by deliberately falsifying it. The guard now matches the call site, and a vacuous guard
  against a footgun **is** the footgun.
  *Boundary:* **this entry authorizes NO live action and consumes no gate.** A3 is offline (code + tests +
  docs). The recovery loop has **never run against NAVER** — it is proven only against fake drivers over an
  in-process loopback. Any live use needs a fresh, scope-matched G3 **and** a fresh single-use G6 in the
  dispatching turn, now carrying the longer window recorded above.

- **D-030 · ACTIVE** — **the Run 6 prerequisites: a fifth G3 scope `session recovery`; a `max live window:`
  G6 field for recovery-capable runs; G4 for Run 6 ratified from §8-22, NOT inherited from the static ✅;
  and two residual risks kept named rather than closed** (product owner, 2026-07-17, docs only).
  *What prompted it:* [D-029](decisions.md) recorded that a G6 now authorizes a materially longer live window
  and that this **"belongs in the next dispatch record — it must not be discovered at the seat."** D-030
  discharges that, plus the two gaps the Run 6 draft named and deliberately refused to grant itself.
  **(a) `session recovery` is a fifth G3 scope.** Run 6 is none of the four [D-026](decisions.md) scopes: it is
  read-only *in effect* (zero clicks ⇒ download/validate/ingest **unreachable**, not declined) yet it drives
  the full engine and holds a live browser ~32 min, so it is **not** the §8-4 read-only probe either. D-026 is
  **extended, not superseded** — G3 stays per-run and scopes stay non-substitutable; only the enum grows.
  **(b) `max live window:` — a new G6 field.** D-028's boundary requires a fresh scope-matched G3 **and** a
  fresh single-use G6 per run but is **silent on duration**, and duration is exactly what A3 changed: ~21 min
  → **~32 min** (`CONFIRM` 10 + `RECOVERY_BUDGET` 10, shared across attempts, + `OBSERVE` 10 + `DOWNLOAD` 1 =
  31 min of budgeted waits, plus launch overhead). Required where a scope adds a wait earlier runs lacked. The
  operator affirms the seat time **explicitly** instead of inheriting it from the shape of Runs 1–5.
  **(c) G4 is ratified per-run from the proof, never inherited.** G4's static ✅ cites §8-2/§8-3 and **predates
  A3 and A4**; §8-2's table is a dated snapshot that does not enumerate §6's 11th rung. A4 (§8-22) makes the
  recovery loop green over a **real browser on a synthetic DOM** (`RUN_INTEGRATION` PASSED 2026-07-17, 5/5), so
  live is no longer that path's first browser execution — **that** is the basis, and it is the Run 5 precedent's
  shape (cite the proof; do not rest on rows that predate the code). **Scoped to Run 6; generalizes to nothing.**
  ⚠ **(d) Two seams are executed by NOTHING offline and stay named, not closed.** This is *not* Run 5's
  "offline-green" shape — it is a narrower, accepted residue, and the two are **not equal**: (1)
  **`page.content()` mid-navigation** (`naver-live-driver.ts`) is **unguarded**, and §8-22 cannot reach it
  because its gate *awaits* the navigation, so the re-probe reads a settled page — **Run 6's premise IS the
  destroyed-context window**; a throw tears the driver down and **spends the G6**, signature
  `aw.live.recovery { outcome: "driver-error" }` with **no** `aw.live.readiness` for that attempt. A3 makes it
  **legible, not impossible**; guarding the read stays a known, PO-declined fix. (2) **`settleSpa` on `main()`'s
  recovery branch** is bypassed by §8-22's injected gate, but is **best-effort by construction** — the driver's
  own readiness settle stands behind it, so it costs latency, not the run. **Expect the first; tolerate the
  second.** Naming them is the point: an accepted risk that stops being written down becomes an assumption.
  *Boundary:* **this entry authorizes NO live action and consumes no gate.** It is docs only. **A ratified
  scope is not an affirmed gate and a template is not an approval** — no `session recovery` G3 instance exists,
  no Run-6 G6 is filled, P6 is unsigned, and Run 6 is **NOT AUTHORIZED**. Prerequisites being in place is
  precisely when they are easiest to mistake for permission. Register:
  [`r4-gate-record.md`](r4-gate-record.md) §G3/§G4/§G6 — the one canonical home.

- **D-031 · ACTIVE** — **G3's `Bridge paired` is scope-dependent, not a vacuous checkbox: for
  `session recovery` it is recorded N/A with its reason** (product owner, 2026-07-17, docs only).
  *What prompted it:* the Run 6 draft **silently dropped** the box; the canonical G3 template requires it.
  Both moves were wrong — **affirming it vacuously asserts a fact not in evidence, and dropping it hides the
  question.** N/A **with a reason** is the third answer, and it is a *recorded* answer, not a waived box.
  **(a) Why it is inapplicable to this scope.** Run 6 is a **CLI run over a loopback**, and the live driver is
  **not Bridge-wired** — two independent sources say so: §6's Bridge rung
  ([`r4-preparation.md`](r4-preparation.md)) verbatim *"the live driver is not yet Bridge-wired,"* and
  [`r4-evidence-pack.md`](r4-evidence-pack.md) §8, *"the entrypoint uses a loopback channel."* There is
  nothing for the box to assert.
  **(b) What the control boundary actually is for this scope** — the box is scoped out because control lives
  elsewhere, **not** because control is absent: the **CLI** + a **seated operator** + the **dedicated Chrome
  connection profile** + **Operation Run persistence** + the **zero-click scope** (no click ⇒ no download ⇒
  detect/validate/ingest **unreachable**). Bridge pairing is not part of that boundary; the CLI is.
  **(c) It does not generalize.** The box **stands unchanged for every other scope**, and a Bridge-driven run
  affirms it for real. Scoped to `session recovery` only.
  **(d) It does not rewrite history.** Earlier dispatch records affirmed `☑ Bridge paired` on CLI-entrypoint
  runs; by this reasoning those ☑s were vacuous. They are **consumed, spent records and stay exactly as
  written** — a spent record is evidence of what was affirmed at the time, and back-dating it would destroy
  the only trace of the mistake. **Reported, not resolved; a future Bridge-scope review may revisit the
  template, not the history.**
  *Boundary:* **this entry authorizes NO live action and consumes no gate.** It resolves the box's
  **applicability**, never the run's **authorization** — the `session recovery` G3 instance is still ☐, no
  Run-6 G6 is filled, P6 is unsigned, and Run 6 is **NOT AUTHORIZED**. Register:
  [`r4-gate-record.md`](r4-gate-record.md) §G3 — the one canonical home.
