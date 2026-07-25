# Review Operations MVP — Workstream Home

> **This is the status home for the review-operations wedge.** Update this document before stopping
> in every review-ops task. A router (`CLAUDE.md`, `docs/product_operating_model.md`) carries the
> *path* to this file; **state lives here**, not in the router.
>
> **Why this wedge.** Review operations is the narrowest slice that exercises the *entire* operating
> loop (`OBSERVE → ACQUIRE → NORMALIZE → UNDERSTAND → PRIORITIZE → ACT → ESCALATE → RESUME`) on one
> seller, one channel, end-to-end. It is the wedge, **not** the product — the same loop generalizes
> to every channel and data type (`docs/product_operating_model.md` §7).

- **Workstream:** Review Operations (acquisition → normalize → prioritize → guided response)
- **Wedge channel:** NAVER (Action Window reference precedent). Second channel not yet selected.
- **Status:** ACQUIRE live-verified once (NAVER, 2026-07-15, Run 4 — supervised, dev seller, local
  dev backend). **NORMALIZE + visibility proven end-to-end against a running local backend
  2026-07-23** over committed golden exports at the **real 25-column schema**
  (`contracts/review-export/naver/v1/`), with a parse gate that fails unreadable artifacts as
  `ARTIFACT_INVALID` and an empty export treated as an honest zero. **Reply state is now preserved**
  (2026-07-23): already-answered reviews leave the action queue and cannot be guided into a duplicate
  public reply. **Import history is now persistent** (2026-07-23): the seller can see what each
  import brought after a reload. **The queue is a worklist** (2026-07-23): worst-first, each row
  showing its stored category and filterable by it — visibility and ordering only, the membership
  rule is unchanged. **Committed reply work now has a persistent home with honest exits**
  (2026-07-24): 내 답변 작업 survives a reload/window/session, a false-calm coverage guard declares
  uncertainty instead of a bare empty, and a review can be set aside (작업에서 제외) and recovered
  (제외한 작업 · 복원) — account-scoped, append-only, with no completion claim. Guided ACT remains
  offline. ⚠ **No live evidence for any of it** — everything since Run 4 rests on synthetic
  fixtures. **Nothing promoted in §4.1.**
- **Last updated:** 2026-07-24
- **Owner:** SellerOps product/engineering

---

## 0. Honesty preface (read before editing status)

- This doc **tracks** progress; it does not **grant** capability status. Capability truth is
  `docs/multi-channel-connector-roadmap.md` §4.1; lessons are `docs/channel_capability_ledger.md`.
- Never check a box to a level higher than §4.1 supports. "Live-verified once" ≠ "operational."
- Action Window review paths sit behind a **market-policy-clarification gate** and a live-run gate
  (fresh, single-use, in-turn approval naming channel/account/date/operator). A plan is never
  authorization (`CLAUDE.md`).
- No auto export/download/submit. The seller performs the platform action; SellerOps detects,
  validates, processes (`docs/product_operating_model.md` §4, §8).

---

## 1. Checklist (the wedge, loop-ordered)

Legend: `[ ]` not started · `[~]` in progress · `[x]` done + evidence linked · `[!]` blocked (name blocker) · `[-]` out of MVP scope

### CONNECT — get the channel into the seller center
- [ ] Channel add flow reaches review acquisition (per §4 acquisition procedure)
- [ ] Acquisition method chosen + declared in §4.1 for the wedge channel (`EXPORT` for NAVER)
- [ ] Connection health surfaces as one row in the shared observability model
- [ ] Seller can set **notification cadence** for review acquisition

### OBSERVE / ACQUIRE — minimum-action acquisition
- [ ] At cadence, seller is prompted with the **single** required action (e.g. "click review export")
- [ ] No hidden/chained clicks; manual progress always available (fence check)
- [ ] Export/download result captured by SellerOps (Action Window: detect, don't perform)
- [x] **The seller can see what each import brought, after a reload** — persisted import history
      (counts · provenance · outcome) on the review-ops home, with the empty export, the
      all-duplicate re-import and a failure each said correctly
      (`docs/slices/import-outcome-history-v1.md`). ⚠ Covers file uploads and seller-center exports
      only; API-collected reviews are a different acquisition path and do not appear.
- [ ] Result validated (shape, channel, non-empty, sanitized) — **fail closed** on ambiguity
- [ ] Evidence linked: _[e.g. `docs/action-window-runtime/r4-evidence-pack.md` §8–17]_

### NORMALIZE
- [~] Ingested to canonical `review` model + dedup — **offline, over the committed golden export**
      (`ReviewAcquisitionSpineTest`). ⚠ Dedup keys on `external_id` (`리뷰글번호`), **not** on a
      fingerprint; `review-id-fingerprint/v1` parity is proven across the TS and Java ports on the
      same rows but is not what dedup keys on. The checklist line's "by fingerprint" wording
      overstates the implementation — reported, not silently re-scoped.
- [ ] Cross-channel-shaped (no NAVER-specific leakage into the core model)
- [x] Golden fixture(s) for the wedge channel's export form — `contracts/review-export/naver/v1/`
      (two committed workbooks at the **real 25-column schema** with the real `yyyy.MM.dd. HH:mm:ss`
      timestamp — one populated, one empty — plus `expected-rows.json`, loaded by the collector AND
      backend tests, with the FE asserting the same `expectedAttention` declaration)

### UNDERSTAND / PRIORITIZE
- [ ] Reviews classified (needs-response / risk / informational) — ⚠ **not this**, and now with a way
      to find out: `contracts/review-eval/naver/v1/` commits the labeling rubric and the go/no-go bars
      (precision ≥ 0.80 on a Wilson lower bound, recall ≥ 0.30, high-rating FP ≤ 0.05) *before* any
      candidate detector exists, measured by a gated local harness
      (`docs/slices/review-analysis-eval-reanalysis-foundation-v1.md`). The seed is empty until a
      labeling session runs. A rule-based
      category IS stored per review and is now visible and filterable in the queue
      (`docs/slices/review-classification-queue-v1.md`), but it does not decide who is in the queue,
      and for reviews the analyzer's sentiment/urgency are pure functions of `rating` — so nothing
      here yet classifies by need. Stays unchecked deliberately.
- [x] **The queue is ordered worst-first, and says what each review is about** — the "needs a look"
      lens orders `rating asc, receivedAt desc` (arrivals stay chronological), rows carry their stored
      category, and the drill-down filters by it over server-computed window counts. An unanalyzed row
      stays in the queue with no chip; 기타 (a verdict) and 분류 전 (a coverage gap) never collapse
      (`docs/slices/review-classification-queue-v1.md`).
- [ ] Urgency + operational-risk signals computed (recencyBucket only; no internal timing surfaced)
- [x] Surfaced in the seller center with alerts (`docs/sellerops_frontend_spec.md`) — proven against a
      **running backend** 2026-07-23: a synthetic Action Window run reached a disposable local backend
      over HTTP and the attention API returned the contract's declared signals; the FE renders the
      honest headline **"현재 확인이 필요한 리뷰 N건"** from that same declaration. ⚠ Local dev backend
      only — no marketplace contact, nothing promoted in §4.1.
- [x] **Already-answered reviews leave the queue** — `답글여부`/`답글등록일시` are preserved
      (`reviews.reply_state`), the low-rating count AND its drill-down exclude ANSWERED, arrivals stay
      whole, and UNKNOWN still asks for a look (`docs/slices/review-reply-state-v1.md`). ⚠ Correct
      *about the last import*: a reply posted since is invisible until the next one.

### ACT (bounded: prepare + guided only)
- [x] **The seller can reach their review work from the operations surface** — the worklist,
      triage, reply preparation and the guided reply run render on `/operations`, not behind
      연결·설정. Multi-account orgs choose explicitly; nothing is auto-picked
      (`docs/slices/operations-review-worklist-v1.md`).
- [ ] Response **prepared** for a review needing reply
- [ ] Seller **guided** to post it (human-performed, observe-only; SellerOps does not submit)
- [ ] Posting recorded honestly — `UNVERIFIED` where no official API can confirm
- [ ] No autonomous outbound write anywhere in the path (fence check)
- [x] **The handoff is honest about what it is** — production never simulates a guided run or mints a
      run identity for a run that did not happen; with no Bridge runtime the panel fails closed to a
      clearly-labelled manual handoff carrying the product name, review date and rating so the seller
      can find the row (`docs/slices/reply-handoff-honesty-v1.md`).
- [x] **A reply the seller reported posting leaves the queue** — excluded from the needs-a-look
      count and sunk below every actionable row, while staying listed and badged
      답변함으로 기록 · 확인 안 함, because the report is UNVERIFIED and a mistaken one must remain
      correctable (`docs/slices/reported-replies-leave-the-queue-v1.md`).
- [x] **A review the channel already answered cannot be guided into a second reply** — server-side 409
      + withheld capability, with the panel saying why (`docs/slices/review-reply-state-v1.md` §2)

### ESCALATE / RESUME
- [ ] Human checkpoint returns a **decision**, not the whole workflow
- [ ] Loop resumes at next cadence without losing dedup/state

### GENERALIZE (proves it's not a 1-channel tool)
- [ ] Second channel selected with **its own** best acquisition method
- [ ] Same canonical model + same observability model — core unchanged
- [ ] Thesis check recorded: did the Action Window pattern survive the new channel? (`docs/multi-channel-connector-roadmap.md` §5.2)

---

## 2. Progress tracking format (use this each update)

Append a dated entry; never rewrite prior entries — correct forward.

```
### <YYYY-MM-DD> — <short title> — <STATUS>
- **Loop stage(s):** <OBSERVE/ACQUIRE/…>
- **Did:** <what changed, 1–3 lines>
- **Evidence:** <file/PR/run-id, or "none — offline">
- **§4.1 impact:** <"none" | "updated NAVER REVIEW live-verify col" — status changes go to §4.1 FIRST>
- **Ledger impact:** <"none" | new dated lesson in docs/channel_capability_ledger.md §2>
- **Gate state:** <policy gate / live-run approval — open or closed, why>
- **Blockers:** <named, or "none">
- **Next:** <single next verifiable step; each live/production step needs its own approval>
```

### Log

### 2026-07-25 — Guided import CTA path — LIVE E2E SUCCESS (discovery → plan → 1 segment, 61 rows)
- **Loop stage(s):** ACQUIRE (guided export) → NORMALIZE → coverage — the whole entry point, end to end
- **Did:** A seller pressed **과거 리뷰 전체 연동하기** and a month of reviews landed in the database, with no
  scratch client anywhere in the loop. Discovery ticket `CONSUMED` (range 2023-07-01 ~ 2026-07-25,
  `OPERATOR_CONFIRMED` — the surface declares no bounds, so the operator established it), 37-segment plan
  created, segment ticket `CONSUMED` with `MACHINE_MATCHED`, segment 1 `COMPLETED`+`COVERED`, attempt
  `SUCCEEDED` **61 new / 0 duplicate / 0 failed**, 61 rows in the DB. Every marketplace click the operator's.
- **Evidence:** `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md` Addendum 2.
  Disposable `sellerops_riv_cta_*` on 18090, name-guarded, dropped; only `sellerops` survives; login profile
  preserved.
- **Newly proven:** the card's CTA starts a real run over the Bridge; discovery creates the plan on a real
  surface where nothing is declared; and a `SCOPE_MISMATCH` is **visible to the person who can repair it** —
  the gate blocked, the card said which repair, the operator corrected the dates, the recheck re-read `MATCH`.
  Two runs in one sitting on one socket, each on a fresh runtime-minted identity.
- **Findings (4 ours + 1 copy):** `SCOPE_BLOCKED` leaves the previous step's highlight on the marketplace page,
  so the screen shows no stop signal; a date barrier cannot be satisfied when the required value is already in
  the field (discovery leaves its own range behind); there is **no seller path to pair the agent**
  (`VITE_ENABLE_AGENT_BRIDGE`); one-origin CORS + a login form that reports a 403 as bad credentials; and
  `REQUEST_STEP_RECHECK` reads "확인 완료" even at a blocked scope. A wrong diagnosis of mine is recorded too.
- **Product decision (owner, this session):** the seller chooses once in SellerOps, **everything else completes
  inside the SmartStore page**, and they return when it is done. The frontend keeps copy ownership (contract §6)
  and sends composed prose down for the runtime to display. Next slice.
- **§4.1 impact:** note updated to say exactly what is live-proven and what is not. **No column promoted, 운영
  지원 unchanged** — one account, one segment, a disposable local backend.
- **Gate state:** ran under the fresh in-turn approval given this turn. ⚠ The **pairing approval control was
  not exercised**: `dev_tty_stderr` needs a TTY this harness does not have, so the run used
  `--dev-insecure-auto-approve`. Every other fence held — no auto-click, fail-closed everywhere, browser only in
  the approval-gated import CLI, launch ref never persisted.
- **Next:** the SmartStore-side guidance slice (the decision above), then findings 12–15.

### 2026-07-25 — Guided import: the seller's own path (FE → Bridge → agent) — IMPLEMENTED (offline, cross-stack)
- **Loop stage(s):** ACQUIRE (guided export) — the entry point, which until now had no product route
- **Did:** Closed the two gaps the live segment proof left open (same day, entry above). (a) **Range
  discovery is now a hosted run**: `ImportDiscoveryEngine` / `ImportDiscoverySession` +
  `ImportDiscoveryDriver`, a fixed five-step plan, and `ImportSegmentHost` branching on the SERVER's
  ticket kind — bounds declared by the date controls give `MACHINE_DISCOVERED`, and the live surface's
  bare text inputs give the operator-guided path recorded as `OPERATOR_CONFIRMED`, never relabelled.
  (b) **`GuidedImportCard`'s single CTA now sends a real `START_RUN`** over the import carrier, via
  `importSession` + `createGuidedImportRuntime` + `useGuidedImport`, and renders the step, the required
  window, and blockers — so a `SCOPE_MISMATCH` is finally visible to the person who has to repair it.
  The scratch bridge client the live run used is **not** in the product path.
- **Evidence:** `collector/test/crossstack/fe-import-runtime-real-bridge.test.ts` — the REAL frontend
  runtime against a REAL `BridgeServer` + `InitialImportEndpoint` + `ImportSegmentHost` + both real
  engines over a real socket: discovery to COMPLETED, a segment to COMPLETED, `SCOPE_MISMATCH`
  delivered and repaired by `REQUEST_STEP_RECHECK`, and a full sitting (discovery → segment → segment)
  on ONE socket. collector 5,119 / 125 skipped (was 5,072), frontend 942 (was 886), backend 1,586
  unchanged, contracts unchanged — the existing v2 contract already carried both intents.
- **Defect found and fixed:** the host never released a finished session's transport subscription, so in
  a real sitting every completed run stayed attached and kept publishing its own views alongside the
  live one. Invisible on segment one; wrong from segment two onward.
- **§4.1 impact:** recorded as a note — **segment execution live-proven, discovery and the CTA path
  offline only**. Not promoted to live-verified: no frontend has yet driven a marketplace run.
- **Ledger impact:** none — all of this is ours, not NAVER's.
- **Gate state:** no live marketplace contact. No gate consumed. Code fences unchanged: no auto-click,
  fail-closed everywhere, browser only in the approval-gated import CLI, launch ref never persisted.
- **Blockers:** none offline. The live CTA E2E (discovery → 1 segment, driven only from the card) needs
  a seated operator and a fresh in-turn approval.
- **Next:** run that live CTA E2E; then the merge + single integrated PR.

### 2026-07-25 — NAVER Initial Review Import — LIVE 1-segment proof SUCCESS
- **Loop stage(s):** ACQUIRE (guided export) → NORMALIZE → coverage
- **Did:** One monthly segment guided end to end on the real seller center and ingested: **8/8 COMPLETED**,
  ticket **CONSUMED**, segment **COMPLETED+COVERED**, attempt **SUCCEEDED** with **70 new / 0 duplicate**,
  `scope_evidence = MACHINE_MATCHED`. **Every marketplace click was the operator's** — the runtime located,
  highlighted, observed, then detected the download their clicks produced.
- **Evidence:** `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md`. Disposable
  `sellerops_riv_live_*` on 18090 (V27/V28 applied), name-guarded, dropped after.
- **What is newly proven:** the scope gate **blocked a wrong window live** (end date left at 07.01 →
  `MISMATCH`, export never located/highlighted/armed), and the recovery path worked (correct the date →
  `REQUEST_STEP_RECHECK` → `MATCH` → `confirm_range` SKIPPED → export). `MACHINE_MATCHED` is honest: the
  runtime read both dates itself, and the SKIPPED confirm step is the observable proof it was not an operator
  attestation.
- **§4.1 impact:** candidate for promoting NAVER REVIEW import from Action-Window-implemented to
  live-verified — **not applied here.** One segment on one account is thin, and §4.1 is the capability truth;
  a product-owner call belongs on that promotion.
- **Ledger impact:** none yet — the ten defects are recorded in the proof record above rather than as channel
  lessons, since all ten were ours, not NAVER's.
- **Gate state:** ran under the simplified per-campaign approval the product owner set this session (initial
  approval + short re-run approvals). Code-level fences unchanged: no auto-click, fail-closed everywhere,
  1-segment limit, approval-gated CLI, browser only in that mode.
- **Blockers:** none for a repeat run.
- **Next:** (a) DISCOVERY intent has never run live; (b) no frontend was in the loop — `START_RUN` came from a
  scratch bridge client, so `GuidedImportCard` is still offline-only, and a `SCOPE_MISMATCH` is currently
  invisible to the operator without it; (c) `UNREADABLE` → `OPERATOR_CONFIRMED` never fired; (d) a surface
  that genuinely needs an apply press is untested.

### 2026-07-24 — NAVER Review Export Tutorial — LIVE export+ingest SUCCESS (attempt 5)
- **Loop stage(s):** ACQUIRE (real export) → NORMALIZE → UNDERSTAND/PRIORITIZE (attention)
- **Did:** A second live NAVER export ingested end-to-end on the FIXED runtime — clean main `661bcca`
  (role-less continuation discovery, PR #350) + scroll-tracking highlight + `readExportScope`, with the
  export choreography reframed to the normal two-click flow (export → ONE consent/confirm → automatic
  download; up-to-3 continuation is a defensive ceiling). Headed operator verification of the two-click
  flow, role-less discovery, ambiguity fail-closed, and scroll-following highlight all green before the
  run. COMPLETED 3-of-3, `upload.done SUCCESS` **7 rows / 0 skipped / 0 failed**; direct-download
  variant (`checkpoints:0`). **C1 compatibility PROVEN on real data** (all mapped fields 7/7).
- **Evidence:** dispatch record §20; gate register RUN 7 ATTEMPT 5 CONSUMED. Sanitized census:
  reply_state ANSWERED 2 / PENDING 5 (all low-rating) — reply-state preserved; **2 answered low-rating
  reviews present**, so a range suitable for the separate Reply-State Live Validation package exists.
  ⚠ `reviews` carry no `seller_account_id` (org/channel-scoped) → account-scoped C2/C4 is that separate
  package. Clean guarded teardown, zero residual data, holder kept at `661bcca`.
- **§4.1 impact:** none promoted — a second disposable-backend live export is added evidence, not
  operational status; `운영 지원` stays file-upload-only.
- **Ledger impact:** none.
- **Gate state:** G3 #5 / G6 #5 (`export+ingest`) CONSUMED. No public write, reply flag never passed.
- **Blockers:** none. ⚠ The reframing commit is LOCAL/unpushed (zero-behavior) pending the single NAVER
  Review Export Tutorial PR.
- **Next:** the separate Reply-State Live Validation package (C2 queue exclusion + C4 answered-review
  reply-prep refusal), which needs its own fresh G3/G6 and an org/channel-scoped attention read.

### 2026-07-24 — Review-Reply Exit Arc — COMPLETE (offline)
- **Loop stage(s):** ACT ⇄ PRIORITIZE (the committed-work surface and its honest exits)
- **Did:** Closed the reply worklist as a coherent surface a seller can trust to hold their work and
  leave it honestly. Six merged slices: a **false-calm coverage guard** so an unattributable scope
  declares UNCERTAIN instead of rendering as "no work" (#343); **내 답변 작업**, a persistent,
  non-window-scoped home for committed reply work — a 대응 필요 decision or a saved draft — that
  survives a reload, a window change and a new session (#344); **작업에서 제외**, an append-only
  operator-owned dismissal that sets a review aside without touching draft, disposition or outcome
  (#345, V25); **exit clarity** — read-only triage on the worklist (no competing remove control), a
  pre-dismissal confirmation and a post-dismissal acknowledgement (#346); **제외한 작업 + 복원**, a
  lazy paginated recovery list with a shared monotonic reply-work event sequence arbitrating
  dismiss-vs-restore deterministically (same-timestamp included), restore appending history only —
  no draft/disposition/outcome mutation, no completion (#347, V26); and an **account-scoping fix** so
  a dismissal acknowledgement earned on one account never reads as an action on the next (#348).
- **Evidence:** PRs #343–#348 on `main` (2946629, 3a25cdc, 671a1ef, 6f806b7, ea6fc53, 02ac526); slice
  docs `attention-coverage-false-calm-v1`, `my-reply-work-worklist-v1`, `reply-work-dismissal-v1`,
  `reply-work-exit-clarity-v1`, `reply-work-recovery-v1` (the #348 audit fix carries no slice).
  Backend + frontend; V25/V26 verified on a disposable PostgreSQL 15 DB; FE 827/827, typechecks
  clean. No run-id — offline.
- **§4.1 impact:** none. Changes what a seller sees and how they exit their own work, not what a
  channel supports.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact. Live-run approval and the market-policy
  clarification gate both remain closed. The operator's approved environment/IP is **restored**
  (2026-07-24); a NAVER live proof is therefore **eligible only after a fresh in-turn G3/G6
  approval** (never standing) — the record grants none.
- **Blockers:** none new. ⚠ The **entire arc is offline/synthetic — no live evidence**; nothing
  promoted in §4.1. ⚠ A reported reply stays permanently **UNVERIFIED** — no read-back oracle, so the
  surface never says 완료. ⚠ The **carrier mode-switch decision stays open and separate**; a session
  is still born into one carrier and the agent hosts exactly one.
- **Next:** a product-owner fork, not an effort question. The offline ACT surface is now as honest as
  it can be without live evidence; the next step that changes capability truth is a **bounded,
  human-in-the-loop NAVER live proof** (real export → ingest → reply state → guided handoff,
  submitting no public reply). With the operator environment restored (2026-07-24) that proof is now
  eligible, but only under a fresh single-use in-turn **G3/G6** approval naming
  channel/account/date/operator — a plan or a restored environment is never authorization. The
  standing alternatives that need no live contact are **GENERALIZE** (select the second channel) and
  the **`rules-v2`** body-polarity detector (needs the gated labeling session first).

### 2026-07-23 — Reply Runtime Injection v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACT (the guided-reply terminal)
- **Did:** The proven runtime was constructed by nothing. Now: `expectedCarrier` on the shared
  transport (caller declares its world; default `export`, every existing caller byte-identical),
  `connectGuidedReplyRuntime` (DEV-only reply-carrier session wrapped adapter→runtime into one
  handle whose `close()` disposes then disconnects), an ACKNOWLEDGED `START_RUN` (accepted → runId;
  refused → immediate `ReplyStartRejectedError`; silence → `ReplyStartTimeoutError` at 5s — the
  failure lands at the click that caused it, in the panel's existing retry path), and
  `useReplyRuntime` — the disposal contract's missing caller: injected > bridge > simulated/null,
  releasing on unmount exactly what it created, including a session that resolves after unmount.
  `VocItemReplyPrep` swaps one `useMemo` for the hook; all 40 panel tests unchanged.
- **Evidence:** `docs/slices/reply-runtime-injection-v1.md`; frontend 805 (was 784), collector and
  backend untouched; typechecks clean. Four falsifications caught — fire-and-forget start fails 6
  tests including the loopback refused-START E2E.
- **§4.1 impact:** none.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact. Production behavior unchanged: a shipped build
  still resolves NO runtime and offers the honest manual handoff.
- **Blockers:** none. ⚠ **No carrier mode switching** — a session is born into one carrier and the
  agent still hosts exactly one; running both worlds live at once needs the agent-side rework
  recorded in the discriminator slice. No reply-side resync: a terminal missed during a reconnect
  gap surfaces as timeout → retry → immediate `INVALID_FOR_STATE` — honest, recorded.
- **Next:** end-to-end DEV proof against the real agent-hosted reply carrier (collector cross-stack,
  offline synthetic page), then reply-refusal visibility in diagnostics; the carrier-switch decision
  stays open and separate.

### 2026-07-23 — Reply Frame Adapter & Runtime Disposal v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACT (the guided-reply terminal)
- **Did:** The v2 reply runtime spoke envelopes; the wire speaks frames; nothing translated — the
  runtime had never been driven by anything shaped like the real wire, and an agent refusal
  (`aw_command_result{accepted:false}`) could only surface as the 12s timeout. Added
  `createReplyFrameTransport` (envelope↔frame, one subscription each way), immediate
  `ReplyReportRejectedError` on a refused report (correlated by commandId; `accepted:true` settles
  nothing), and `dispose()` per the recorded DISPOSAL CONTRACT: releases the construction listener,
  rejects in-flight reports, fails later start/report closed, idempotent — transport listener count
  pinned at ZERO after disposal, including mid-report.
- **Evidence:** `docs/slices/reply-frame-adapter-v1.md`; frontend 784 (was 765), collector and
  backend untouched; typechecks clean. A loopback E2E drives the real runtime through the real
  adapter over serialized frames — terminal and refusal both. Four falsifications caught; dropping
  the rejection settle reproduces the hang exactly.
- **§4.1 impact:** none.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. ⚠ Adapter + lifecycle only — **still injected into nothing**; no carrier
  switching; `start()` stays fire-and-forget (a refused START_RUN surfaces at the first report —
  recorded for the injection slice, which decides who awaits what).
- **Next:** the injection slice — construct the bridge runtime behind `resolveReplyRuntime()` when a
  reply-carrier session exists, with the React effect cleanup that actually calls `dispose()`, and
  decide `start()`'s acknowledgement semantics there.

### 2026-07-23 — Reply Report Safety v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACT (the guided-reply terminal)
- **Did:** `createBridgeReplyRuntime.report()` resolved ONLY on `RUN_OPERATOR_REPORTED` — no timeout,
  no rejection, no handling of a transport that throws — so a dropped socket or a rejected command
  left the promise pending forever, and `VocItemReplyPrep` pending with it at `busy = "reporting"`,
  every control inert, recoverable only by reloading. Now one settle path that always clears the
  timer and unsubscribes: four ways in, one way out. A panel test asserts the operator is released
  with an actionable failure and that NOTHING was recorded.
- **Evidence:** `docs/slices/reply-report-safety-v1.md`; frontend 759 (was 756), collector and
  backend untouched; typecheck clean. Two falsifications caught — removing the timeout makes three
  tests hang to their 5s limit, reproducing the original bug exactly.
- **§4.1 impact:** none.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. ⚠ Safety only — **no v2 frame adapter, no runtime injection, no carrier
  switching**. Nothing constructs this runtime in any build; the fix guarantees that when something
  finally does, it cannot wedge the panel.
- **Next:** the envelope↔frame adapter, which should surface `aw_command_result{accepted:false}` as a
  rejection (the v1 adapter already does) — turning today's timeout into an immediate, accurate
  failure. The runtime's construction-time listener also has no disposal path; that belongs with the
  injection slice, which decides its lifetime.
### 2026-07-23 — Carrier Refusal Diagnostics v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACT (the Bridge carrier beneath it)
- **Did:** `connectAwBridgeSession` returned bare `null` for six different situations — bridge off,
  unpaired, ticket rejected, unreachable, no announcement, version mismatch — and, after the carrier
  discriminator, for an agent hosting the REPLY carrier. That last one is a healthy agent, and it
  reached the operator as "offline". Replaced the null with a discriminated result carrying a closed
  set of sanitized reason enums (plus the announced carrier, only when knowable), surfaced in the
  DEV-only Bridge diagnostics panel.
- **Evidence:** `docs/slices/carrier-refusal-diagnostics-v1.md`; frontend 756 (was 751), collector
  unchanged count (2 cross-stack call sites updated), backend untouched; typechecks clean. Two
  falsifications caught. ⚠ The collector's CROSS-STACK tests caught the signature change where the
  frontend suite could not — they drive the real FE transport against a real Bridge, and are the
  end-to-end proof the export attachment path still works.
- **§4.1 impact:** none.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. ⚠ Diagnostics only — **no v2 transport, no reply-runtime injection, no mode
  switching**. Every fail-closed path still fails closed; the refusal set is identical, only labelled.
- **Next:** audit the envelope↔frame adapter and the `report()` timeout/rejection path. `report()`
  resolves only on `RUN_OPERATOR_REPORTED` with no timeout and no `aw_command_result` handling, so
  wiring it today would wedge the reply panel at `busy = "reporting"` with no way out.

### 2026-07-23 — Action Window Carrier Discriminator v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACT (the Bridge carrier beneath it)
- **Did:** Closed a mis-attach that nothing could have detected. The v1 export and v2 reply carriers
  are byte-for-byte identical on the wire — same socket, same framing, same `aw_session` — and
  `transportVersion` is **1 in BOTH** contracts while `channelCode` is `naver` on both, so the FE had
  nothing to discriminate on: attaching to a reply-hosting agent would have built a v1 client and fed
  it v2 envelopes ("connected but dormant" rather than an honest fallback). Added an explicit
  `carrier` field to `aw_session`, announced by both endpoints and typed to the literal each can emit,
  and made the FE attach only on `export` — refusing `reply`, unknown, and **absent**.
- **Evidence:** `docs/slices/aw-carrier-discriminator-v1.md`; frontend 751 (was 746), collector
  unchanged count (2 fixtures updated), backend untouched; typechecks clean. Three falsifications caught, and review found two defects: the carrier
  constants were ANNOTATED (`: AwCarrierKind`), which widened them so an announcement typed against
  one accepted the other — the very mistake the field prevents, inside its own definition — and the
  reconnect path was protected by construction but pinned by nothing. 11 existing tests failed the moment the guard landed — their fixtures announced without
  `carrier`, which is the refusal working.
- **§4.1 impact:** none.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. ⚠ Safety only — **no mode switch and no production reply runtime**. The
  one-carrier constraint is agent-side (`createAgentBridge` throws when both are configured), so a
  *second connection* stays unavailable without reworking the agent.
- **Next:** the mode-switch decision, which now has the discriminator every option needs.

### 2026-07-23 — Reply Handoff Honesty v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACT (the handoff at the end of it)
- **Did:** The audit's last stretch found production minting Action Window runs that never happened.
  `VocItemReplyPrep` defaulted to the SIMULATED runtime at module scope and `createBridgeReplyRuntime`
  is wired to nothing, so every shipped build minted a `run_<hex>` locally and stored it in
  `review_reply_outcome.aw_run_ref` — and the column's NOT NULL is what forced it. Removed the silent
  fallback (simulation is now DEV-only), made the run ref genuinely optional (V24 + `optionalAwRunRef`),
  failed closed to a clearly-labelled manual handoff, dropped the 가이드 overclaim, and added product
  name / date / rating so the seller can find the row nothing navigates them to.
- **Evidence:** `docs/slices/reply-handoff-honesty-v1.md`; backend 1502 (was 1500), frontend 746 (was
  741), collector untouched; typechecks clean. Three falsifications caught. V24 verified on a
  disposable PostgreSQL 15 DB (`aw_run_ref` now `is_nullable = YES`).
- **§4.1 impact:** none.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. ⚠ **The real Bridge runtime is still unwired** — this makes the absence honest,
  it does not fill it. ⚠ Still no link to NAVER: no review-list URL is pinned in the repo and D-035
  records the detail-page entry as not live-reachable, so a destination needs gated live evidence.
- **Next:** audit the real Bridge runtime wiring.

### 2026-07-23 — Reported Replies Leave the Queue v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACT → PRIORITIZE (the loop closing on itself)
- **Did:** The next break in the journey audit was the closing step: ACT happened and the queue did
  not notice. `reply_state` is written only by ingest from the channel's `답글여부`, so a reply
  SellerOps ITSELF guided — recorded with a fingerprint and an Action Window run ref — left the
  headline at 10건 with the same ten rows on top until the next export. Now a reported submission
  leaves the count, **stays listed**, sinks below every actionable row, and carries an honest
  badge. Version-scoped and existence-based, stated once and shared by the count, the ordering and
  the marker.
- **Evidence:** `docs/slices/reported-replies-leave-the-queue-v1.md`; backend 1500 (was 1490),
  frontend 741 (was 733), collector 4843/95 untouched; typechecks clean. Eight falsifications caught — plus two real defects found by review: the new
  rule was invisible in-session (nothing refetched after an outcome was recorded), and the new badge
  wore the channel's own 답변 완료 green until a test written to keep them distinguishable caught it. New JPQL also run against a disposable PostgreSQL 15 DB. The golden
  contract's `expectedAttention` is byte-unchanged, as it must be.
- **§4.1 impact:** none.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. ⚠ The count and the list now deliberately differ (reported rows are excluded
  from one and kept in the other); the drill-down's existing explanatory sentence covers it. ⚠
  Nothing here claims the channel answered — `verification` is permanently UNVERIFIED.
- **Next:** continue the journey audit — the remaining stretch is detail → draft → approval →
  Action Window.

### 2026-07-23 — Operations Review Worklist v1 — IMPLEMENTED (offline)
- **Loop stage(s):** the hand-off between PRIORITIZE and ACT
- **Did:** A journey audit (import history → worklist → detail/draft/approval → Action Window) found
  the largest seller-visible break was not a missing feature but a misplaced one: the worklist —
  headline, worst-first list, facet, triage, draft, approval and the guided reply run — rendered ONLY
  at `/settings/channels/:accountId`, and **nothing in 운영 linked there**. The page named 리뷰 운영
  showed run status and import counts and no reviews, while its own completion copy told the seller to
  go to "채널 화면". Moved it: Operations is the review action surface, Settings keeps connection and
  setup diagnostics. One mount, not two.
- **Evidence:** `docs/slices/operations-review-worklist-v1.md`; frontend 733 (was 710), backend 1490
  and collector 4843/95 **untouched**; typechecks clean. Five falsifications caught — one of them for
  real, when a `git checkout --` during falsification silently reverted the copy fix.
- **§4.1 impact:** none. This changes where a seller finds their work, not what a channel supports.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact. **Run 7 stays deferred** until the approved
  network/IP environment returns.
- **Blockers:** none. ⚠ Multi-account orgs must now CHOOSE — nothing is auto-picked, because
  `reviews` has no `seller_account_id` and the backend already refuses that attribution. ⚠ The
  false-calm limitation behind that refusal is unchanged and still invisible to the client.
- **Next:** continue the journey audit at the next break — worklist → detail → draft → approval →
  Action Window.

### 2026-07-23 — Review Analysis Evaluation & Reanalysis Foundation v1 — IMPLEMENTED (offline)
- **Loop stage(s):** UNDERSTAND / PRIORITIZE (the machinery, not the judgement)
- **Did:** Stopped short of the `rules-v2` this log named as next, **on evidence**:
  `aiagent/docs/phase2e_detector_design.md` (2026-04-27) already measured a flat-substring Korean
  polarity detector at **0/30 sample recall, 0/121 records**, diagnosing surface-form rigidity rather
  than vocabulary breadth — and `RuleBasedInboxItemAnalyzer` is exactly that architecture. Built the
  two things a detector needs instead: a **versioned re-analysis path** (every write path was
  skip-if-exists, so no future analyzer could reach the existing corpus) and a **fingerprint-keyed
  local evaluation harness** whose go/no-go bars are committed *before* any candidate exists.
- **Evidence:** `docs/slices/review-analysis-eval-reanalysis-foundation-v1.md`; backend 1490 (was
  1458), frontend 710 and collector 4843/95 **untouched**. Six falsifications caught; a seventh
  (removing `readOnly`) caught nothing and is recorded as an untested guard rather than claimed as
  proven. Two review passes found three real defects: `remaining` counted rows that can never be
  recomputed, so the documented "re-call until remaining == 0" loop would never terminate (and with a
  small limit those rows starved real work out of every batch); the high-rating false-positive gate
  passed **vacuously** on a seed containing no high-rated reviews; and the rollback guarantee was
  overstated for inquiries, whose `status` IS mutable after ingest. All fixed and falsified.
  Re-analysis suite also run against a disposable PostgreSQL 15 DB. No migration needed.
- **§4.1 impact:** none. Nothing about channel support changed.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact. **No re-analysis run against real data** — the
  endpoint defaults to `dryRun=true`.
- **Blockers:** none. ⚠ The high-rating complaint is still undetected, and now measurably so rather
  than assumedly so. ⚠ `labels.json` ships **empty**; the harness refuses a verdict below the
  adequacy floor (≥200 labeled, ≥40 NEEDS_LOOK), so nothing can be quoted from it yet.
- **Next:** a labeling session over real NAVER review bodies — separate, gated, read-only, with only
  derived labels leaving the machine — to produce the honest `rules-v1` baseline. Only after that is
  a detector candidate worth building, and it must be added ALONGSIDE the existing analyzer so
  rollback stays a configuration change.

### 2026-07-23 — Classification-Aware Review Queue v1 — IMPLEMENTED (offline)
- **Loop stage(s):** UNDERSTAND / PRIORITIZE
- **Did:** Made the queue a worklist instead of a date-ordered list. `item_analyses` had carried a
  category for every ingested review since V5 and only the Inbox read it; the queue ranked by arrival
  date, so a 3★ from this morning outranked a 1★ from yesterday. The "needs a look" lens now orders
  worst-first (arrival lenses stay chronological), each row shows what it is about, and the drill-down
  can be filtered by category — with server-computed window counts, since a server-paginated page of
  ten cannot describe the window. Added `ItemAnalysisCategories` as the one vocabulary the analyzer
  writes and the facet filters on, plus V23.
- **Evidence:** `docs/slices/review-classification-queue-v1.md`; backend 1458 (was 1433), frontend 710
  (was 691), collector 4843/95 unchanged; both typechecks clean. Eight falsifications, all caught. Two
  independent review passes found 5 real defects — an over-claiming drill-down heading, a WARN log
  echoing an unvetted category value, an undocumented break in the count reconciliation, an active
  filter that could outlive its own options, and a valid category silently dropped on a lens that
  cannot use it (now a 400) — all fixed (§6).
  V23 applied to a disposable PostgreSQL 15 database (history contiguous 1–23) and the new JPQL was
  executed against real PostgreSQL as well as H2, since the test profile disables Flyway.
- **§4.1 impact:** none. This changes what an operator sees and in what order, not what a channel
  supports.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact. Run 7 remains deferred.
- **Blockers:** none. ⚠ **The queue definition is UNCHANGED** — `[ ] Reviews classified` stays
  unchecked. A key finding scoped this slice: for reviews the analyzer's `sentiment` and `urgency` are
  pure functions of `rating` (`negative = rating<=2`), so only `category` is body-derived. A 5★
  "배송이 늦었어요" is therefore undetectable by `rules-v1` — requeueing on classification needs a
  polarity-aware analyzer, not a join.
- **Next:** the high-rating complaint — a `rules-v2` analyzer with body polarity, a re-analysis path
  (`analyzeForSources` is skip-if-exists; `backfillMissing` only fills missing rows), and a `[PO]`
  decision on the complaint vocabulary. Surfaced as its own signal, never folded into the headline.

### 2026-07-23 — Import Outcome & History v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACQUIRE (the operator's record of it)
- **Did:** Gave the seller a persistent answer to "did it work, and what came in?". The home's
  activity rail was in-memory only — it started empty and vanished on reload — while `sync_jobs` had
  persisted every ingest all along. Added `GET /api/imports/reviews` (org-scoped, predicate **in the
  query** so a busy org cannot push review imports out of the window, ordered by the instant the UI
  displays), a minimal DTO carrying no `errorMessage` and no `channelId`, an index (V22), and a
  fail-closed rail rendering the full state table — empty export, all-duplicate, partial, failed,
  unfinalized, unknown provenance.
- **Evidence:** `docs/slices/import-outcome-history-v1.md`; backend 1433 (was **1418** — +15: 10
  history + 5 controller), frontend 691 (was 668), collector unchanged; typechecks clean. An adversarial review found 11 issues —
  including an over-claiming heading, two stale copy pointers, a sort/label mismatch, a vacuous
  ordering test and a missing controller test — all fixed (§5). Both new rules falsified and caught.
- **§4.1 impact:** none. This changes what a seller sees, not what a channel supports.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. Two defects **recorded, not fixed**: API-collected reviews cannot appear in this
  history by construction, and the shared run-history read (`listRuns`) filters after fetching and
  cannot see uploads at all — so `ChannelDetail`'s run list silently excludes every import.
- **Next:** classification-aware queueing (the rules-based analyzer already writes sentiment/urgency/
  category into `item_analyses` and surfaces in the Inbox, but the review-ops queue ignores it) —
  a product decision about what "needs a look" means, not an effort question.

### 2026-07-22 — Review Acquisition Spine v1 — IMPLEMENTED (offline)
- **Loop stage(s):** ACQUIRE (artifact validation) → NORMALIZE → UNDERSTAND/PRIORITIZE (visibility)
- **Did:** Joined the two halves of review acquisition on ONE committed golden export
  (`contracts/review-export/naver/v1/`): the collector validates those exact bytes through the
  quarantine and the backend ingests the same file to operator attention signals. Gave the synthetic
  fixture page the real bytes + the browser driver an injected ingest seam. Added the honest
  review-ops number ("현재 확인이 필요한 리뷰 N건") from the existing attention endpoint and removed
  `CompletedResult`'s unbacked "정리·분석까지 끝냈어요" claim.
- **Evidence:** `docs/slices/review-acquisition-spine-v1.md`;
  `collector/test/action-window/review-acquisition-spine.test.ts` (16);
  `backend/.../ingest/ReviewAcquisitionSpineTest.java` (8);
  `frontend/src/components/AttentionSignalList.test.tsx` (3) + `lib/attention.test.ts`.
  **No live run** — offline only.
- **§4.1 impact:** none. Nothing live happened; `운영 지원` stays file-upload-only.
- **Ledger impact:** none.
- **Gate state:** no gate consumed. Market-policy gate and live-run approval both untouched and
  still closed; this slice needed neither.
- **Blockers:** none introduced. One finding **reported, not resolved**: quarantine `valid: true`
  does not imply ingestible (the sniff checks ZIP magic + the `[Content_Types].xml` entry name; the
  pre-spine fixture payload passed it and was not a workbook). Whether validation should gain a
  parse-level check is a `[PO]` call.
- **Next:** a single-process synthetic run (fixture → real local dev backend → attention) would
  close the last offline gap; it needs a running backend, not a gate.

### 2026-07-23 — Review Reply-State Preservation v1 — IMPLEMENTED (offline)
- **Loop stage(s):** NORMALIZE → UNDERSTAND/PRIORITIZE → ACT (bounded)
- **Did:** Preserved the export's `답글여부`/`답글등록일시` (Flyway V21 + `ReviewReplyState`), refreshed
  it on duplicate re-import (field-scoped, **monotonic** — an import may never un-answer), excluded
  channel-answered reviews from the low-rating count **and** its drill-down while arrivals stay whole,
  and blocked the guided reply run for an answered review server-side (409 + withheld capability +
  a panel notice). Assessed `관련리뷰상세내용` and kept dropping it, on evidence.
- **Evidence:** `docs/slices/review-reply-state-v1.md`; backend 1418 (was 1370), frontend 668 (was
  666), collector 4843/95 unchanged; typechecks clean. An adversarial review pass found 8 real
  defects — including a frontend that did not typecheck and a within-file duplicate that could
  discard an ANSWERED statement — all fixed and pinned (§5). Both new rules falsified and caught.
- **§4.1 impact:** none. This changes what an operator sees, not what a channel supports.
- **Ledger impact:** none.
- **Gate state:** no gate consumed, no live contact.
- **Blockers:** none. ⚠ The queue is correct **about the last import** by construction: a reply posted
  since is invisible until the next export.
- **Next:** a bounded human-in-the-loop NAVER live proof — real export → ingest → reply state → queue
  exclusion → duplicate-reply refusal, **submitting no public reply**. Needs its own fresh single-use
  approval. Also owed: a `[PO]` decision record for the monotonic rule.

### 2026-07-23 — Spine gaps closed against real-export evidence — IMPLEMENTED (offline)
- **Loop stage(s):** ACQUIRE (artifact validation) → NORMALIZE → UNDERSTAND/PRIORITIZE (visibility)
- **Did:** Regenerated the golden fixtures at the **real 25-column schema** with the real
  `yyyy.MM.dd. HH:mm:ss` timestamp (a `DateParse` branch the old date-only fixture never exercised),
  plus an empty-export artifact. Added a **parse gate at the validate seam** — a payload that passes
  the D-021 sniff but is not a workbook now fails as `ARTIFACT_INVALID` (true, actionable copy)
  instead of reaching ingest as `INGEST_FAILED` ("저장 중 문제…", false). Made an empty **export** an
  honest zero without breaking the manual-upload contract (provenance-based rule). **Ran the E2E for
  real**: synthetic Action Window → disposable local backend → attention API, 4/4.
- **Evidence:** `docs/slices/review-acquisition-spine-v1.md` §5–§6; collector 4843/95 (was 4822/91),
  backend 1370 (was 1366), frontend 666 (was 663) — every delta attributed in §6. Both new locks
  falsified and caught, hermetically **and** end to end.
- **§4.1 impact:** none. A disposable local backend is not marketplace live verification;
  `운영 지원` stays file-upload-only.
- **Ledger impact:** none.
- **Gate state:** no gate consumed; no live marketplace contact. The E2E ran under this turn's
  in-turn approval, on a synthetic page against a throwaway database that was dropped afterwards.
- **Blockers:** **`답글여부` is dropped by the canonical model.** On a real export 26 of 79 low-rating
  reviews (33%) were already answered, so the "needs a look" queue is inflated and the guided-reply
  path can produce a **duplicate public reply**. `IngestedReviewVocItemSource:383`'s comment ("an
  export carries no reply state") is false for NAVER. **The spine is not declared fully closed until
  this is dispositioned.** Investigated and dismissed: `관련리뷰상세내용` duplicates the linked
  review's own body (1,157/1,157 resolvable cases) — no data loss.
- **Next:** *Review reply-state ingest v1* — aliases → `CanonicalReview` field → `reviews.reply_state`
  + `replied_at` (Flyway V21) → populate the existing `replyStatus` DTO field, plus a `[PO]` decision:
  are answered reviews **excluded** from "needs a look" or **badged**? Separately, a `[PO]` wording
  approval is owed for the `decisions.md` entry covering the live-path validate tightening.

---

## 3. Gate register (review-ops specific)

| Gate | What it blocks | Current state |
|---|---|---|
| Market-policy clarification | Any seller-facing / production review acquisition via Action Window | _[open — see §4.1 note]_ |
| Live-run approval | Any live marketplace run | Requires fresh, single-use, in-turn approval (channel/account/date/operator) |
| Reply-submission gate (v1.6) | Guided review-reply going live | Offline; gate-locked (`contracts/action-window/v2/`) |

---

## 4. Related documents

- Operating model + user journey: `docs/product_operating_model.md`
- Capability truth: `docs/multi-channel-connector-roadmap.md` §4.1
- Channel lessons ledger: `docs/channel_capability_ledger.md`
- Action Window contract: `docs/slices/action-window-v1.md`
- Action Window runtime status: `docs/action-window-runtime/HANDOFF.md`
- Review acquisition spine slice: `docs/slices/review-acquisition-spine-v1.md`
- Shared golden export contract: `contracts/review-export/naver/v1/SPEC.md`
- Review response slices: `docs/slices/review-response-preparation-v1.md`, `docs/slices/review-response-completion-v1.md`
- Frontend source of truth: `docs/sellerops_frontend_spec.md`
