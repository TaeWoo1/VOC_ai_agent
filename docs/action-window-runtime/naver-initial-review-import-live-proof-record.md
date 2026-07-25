# NAVER Initial Review Import — live proof record (2026-07-25)

One monthly segment, guided end to end on the real NAVER seller center, ingested into a disposable backend.
This is the first live evidence for the corrected (single-CTA, guided, auto-ingest) flow.

## Result

| | |
|---|---|
| Run | **8/8 `COMPLETED`** — `run_import*`, artifactRef `f3546cf725a8d97a` |
| Launch ticket | **`CONSUMED`**, `scope_evidence = MACHINE_MATCHED` |
| Segment | **`COMPLETED` + `COVERED`** |
| Attempt | **`SUCCEEDED`** · rows_new **70** · rows_duplicate **0** · `MACHINE_MATCHED` |
| Rows in DB | **70** |
| Window | 2026-06-01 .. 2026-06-30 (one segment, per the bounded-proof limit) |
| Backend | disposable `sellerops_riv_live_*` on 18090, V27/V28 applied, name-guarded, dropped after |

**Every marketplace click was the operator's.** The runtime located, highlighted, observed, then detected the
download the operator's own clicks produced — it never clicked, typed, exported or consented. The step
sequence the operator performed: start date → end date → export → NAVER's `확인` consent.

## What this proves that nothing else did

- **The scope gate blocks a wrong window, live.** With the end date left at 07.01 the read-back returned
  `MISMATCH` (`datesParsed: 2, spanDiffers: true`) and the run parked at `SCOPE_BLOCKED`. The export control
  was **never located, never highlighted, never armed** — the gate's whole purpose, confirmed on a real
  surface rather than a fixture.
- **The recovery path works.** Operator corrected the end date → `REQUEST_STEP_RECHECK` → `MATCH` →
  `confirm_range` reported `SKIPPED` → export highlighted. Recoverable, not a failed run, and `totalSteps`
  stayed 8 throughout.
- **`MACHINE_MATCHED` is honest here.** The runtime read both dates itself and confirmed agreement, so the
  evidence is a machine check. `confirm_range` being `SKIPPED` is the observable proof it was not an operator
  attestation. Had the range been unreadable, the operator would have confirmed and the evidence recorded
  would have been `OPERATOR_CONFIRMED` — never relabelled.
- **The date read-back reaches real values.** `datesParsed: 2` on every verdict, through the same
  `readExportScope` path proven on Run 7.
- **Sanitization held.** No launch ref, date value, filename, path or URL in any log or wire frame. The
  ingested count (70) never crossed the Action Window wire — it came from the backend's own attempt record,
  which is where an exact count belongs.

## Defects found and fixed during the run (live cost: zero seller clicks wasted before each was caught)

| # | Defect | Root cause |
|---|---|---|
| 1 | Import mode required an ESM connections file | the gate sat inside the connector live boot, which launches one Chrome per connection |
| 2 | Agent opened a blank window and announced ready | `NAVER_REVIEW_URL` neither required nor opened |
| 3 | `dateInputCount: 0` on visible fields | `readonly` treated as unusable; a calendar-backed field is readonly by design |
| 4 | `frameResolved` reported `true` for the top document | compared against null, but resolution assigns the main frame as its fallback |
| 5 | `aria-disabled="false"` read as disabled | `\bdisabled\b` word search instead of a real attribute test |
| 6 | In-page tagging disagreed with the pure decision | actionability re-implemented in-page; #3 fixed in one copy only |
| 7 | Exclusion diagnostic logged as `"[object]"` | nested object; the log sanitizer collapses non-scalars |
| 8 | Date "action" detected as a click | a click opens the picker; it does not mean a date was set |
| 9 | 15-second observation window | inherited the export CLI's default; a seated seller is slower |
| 10 | Expired window stranded the run | the watcher returned while the status still said `WAITING_FOR_HUMAN` |

**#3, #5 and #6 were one root cause**: actionability was implemented in three places and the copies masked
each other. It now exists once, in `naver/import-locate.ts`, and the in-page step does selection only.

**#4 and #7 were diagnostics that lied or said nothing** — worse than absent, because they were added to make
these very failures legible. Both are now asserted by tests.

## Design decisions this run settled

- **Frame resolution is shared, not re-derived.** The import driver holds no `Page` at all; its only context
  is `NaverLiveProbeDriver.surfaceContext()`. Removing the handle makes #6's class of mistake unavailable
  rather than merely discouraged. (This surface turned out NOT to be frame-hosted — one unrelated child frame
  — but sharing the resolution is right regardless.)
- **A date barrier observes the VALUE, not a click.** It is the honest signal and the same thing the gate
  later verifies, so the two converge instead of disagreeing. The value is compared in-page; only a boolean
  crosses back.
- **A human barrier has no deadline that kills the run.** An expired window re-arms, bounded by the barrier
  still being open, with a floor delay so a fast-returning driver cannot spin.
- **The consent control is located late, and that is a fact.** NAVER raises it in response to the export
  click, so it cannot be found earlier; the live-proven continuation machinery in `detectDownload` owns it.
  It matched `확인` without needing the `liveDebug` label path.
- **The browser starts at boot in the approval-gated import mode only** (product-owner decision). A browser
  is not a run: `ImportSegmentHost` still requires a valid `START_RUN` whose launch ref the SERVER resolves.

## Not proven by this run

- Only ONE segment, and only the SEGMENT intent. `INITIAL_REVIEW_IMPORT_DISCOVERY` has never run live.
- `requiresApply` was `false` on this surface (43 apply-worded candidates → fail-closed). Whether a surface
  that genuinely needs an apply press works is untested; the gate would catch a stale window if it did not.
- The `UNREADABLE` → `OPERATOR_CONFIRMED` branch never fired — the range was readable both times.
- No frontend was involved: `START_RUN` and `REQUEST_STEP_RECHECK` were delivered by a scratch bridge client.
  The seller-facing `GuidedImportCard` path is still only offline-verified.
- A `SCOPE_MISMATCH` is invisible to the operator without a frontend. The runtime reported it correctly and
  the browser overlay did not change, so the operator could not tell why nothing advanced. `blockerView`
  already has the copy; wiring the FE to this carrier is what closes it.

---

# Addendum (2026-07-25, same day) — the seller's own path, and what it does NOT yet prove

The last two "not proven" items above were about a missing route, not a missing capability: the run existed and
nothing in the product could start it. That route now exists, and range discovery — the step that creates the
plan — is a hosted run rather than a gap.

## Proven offline, across a real socket

`collector/test/crossstack/fe-import-runtime-real-bridge.test.ts` drives the REAL frontend runtime
(`connectAwBridgeSession` with `expectedCarrier: import`, `createGuidedImportRuntime`) against a REAL
`BridgeServer` + `InitialImportEndpoint` + `ImportSegmentHost` + both real engines, over a real `ws` socket:

| | |
|---|---|
| Range discovery | `START_RUN(INITIAL_REVIEW_IMPORT_DISCOVERY, discoveryRef)` → `COMPLETED`, 5 steps |
| One segment | `START_RUN(INITIAL_REVIEW_IMPORT_SEGMENT, importRef)` → `COMPLETED`, required window on every view |
| `SCOPE_MISMATCH` | delivered to the frontend, `recoverable: true`, repaired by `REQUEST_STEP_RECHECK` |
| A whole sitting | discovery → segment → segment on ONE socket, each on a new runtime-minted identity |
| Refused ticket | a ref the server rejects gives a bounded failure, never a run that looks started |
| Wrong carrier | an export-expecting client refuses instead of half-attaching |

**One defect this found, which no single-sided test could.** `ImportSegmentHost` dropped its reference to a
finished session without releasing that session's transport subscription. Every completed run therefore stayed
attached for the agent's whole life, still answering commands and publishing its own views — invisible on
segment one, and from segment two onward a frontend would receive interleaved state from two runs, with
whichever had the higher revision winning. Now released before the next run is assembled, and pinned by a
listener count on the endpoint.

## Design decisions this slice settled

- **The SERVER decides the run kind, not the frontend's intent.** The host resolves the ticket and branches on
  what the ticket authorizes. A declared intent that disagrees with the server's answer fails closed rather
  than picking either: running the server's kind would guide a choreography the frontend is not rendering, and
  running the client's would spend a ticket on work it does not authorize.
- **Attach before minting.** The card connects to the import carrier FIRST and only then asks the backend for a
  launch ticket, and it hands the ticket back (`/launches/{ref}/expire`) if `START_RUN` is refused or never
  acknowledged. A single-use authorization must not be spent by an agent that could never have hosted the run.
- **Discovery's two barriers always occupy a step slot.** Whether the seller must pick the dates is only known
  once the bounds read answers, mid-run. Publishing four steps on one path and six on the other would move
  `totalSteps` under the frontend — the same reason `CONFIRM_RANGE` is `SKIPPED` rather than absent in a
  segment run.
- **Discovery is the one place dates leave the driver, and it is not a leak.** There the range IS the product:
  the backend stores it as the plan's range and the card shows it as 가져올 수 있는 기간. It goes to the server
  over the account's own authenticated channel, and never to a log, a local file, or the Action Window wire.
- **`noticeTexts` is deliberately empty.** The pure verdict can also read a per-query span cap out of page
  notices, but nothing consumes one (segmentation is monthly unconditionally), and scraping text off a live
  seller surface for an unused value is exposure with no purpose.
- **The failed-report blocker reuses `INGEST_FAILED`.** Same failure class — the runtime did its part and the
  server did not accept the result — and the frontend's existing copy for it is scope-neutral. A new blocker
  code would have been a contract change that bought a synonym.

## Still NOT proven

- **No frontend has ever driven a marketplace run.** The card is proven against a fixture driver over a real
  socket; the live segment above was driven by a scratch client. A live CTA-driven E2E is the open item.
- **`INITIAL_REVIEW_IMPORT_DISCOVERY` has still never touched NAVER.** The bounds read is expected to return
  `UNREADABLE` on the real surface — its date inputs are calendar-backed text fields with no `min`/`max` — so
  the live path will be the operator-guided one recorded as `OPERATOR_CONFIRMED`. That is a prediction from the
  element structure the operator pasted during the live run, not a measurement.
- The three remaining items from the original record (apply-requiring surface, segment `UNREADABLE` →
  `OPERATOR_CONFIRMED`, more than one segment) are unchanged.

---

# Addendum 2 (2026-07-25, seated live run) — the CTA path, proven end to end

Both open items above are now closed. A seller pressed **과거 리뷰 전체 연동하기** in SellerOps, and a month of
reviews landed in the database without any scratch client in the loop.

## Result

| | |
|---|---|
| Discovery ticket | **`CONSUMED`** · range **2023-07-01 ~ 2026-07-25** · `range_evidence = OPERATOR_CONFIRMED` |
| Plan created | 37 monthly segments, `ACTIVE` — built from what discovery established, no period asked of the seller |
| Segment ticket | **`CONSUMED`** · `scope_evidence = MACHINE_MATCHED` |
| Segment 1 (2023-07-01 .. 2023-07-31) | **`COMPLETED` + `COVERED`** · 61 rows |
| Attempt | **`SUCCEEDED`** · rows_new **61** · duplicate 0 · failed 0 |
| Rows in DB | **61** · coverage 1/37 |
| Backend | disposable `sellerops_riv_cta_*` on 18090, V27/V28, name-guarded, dropped after |

**Every marketplace click was the operator's.** The prediction above held exactly: the bounds read returned
nothing declared (`minAttrs: 0, maxAttrs: 0` on two correctly-found inputs), so discovery took the
operator-guided path and recorded `OPERATOR_CONFIRMED` — never relabelled as a machine read.

## What this proves that the cross-stack suite could not

- **The seller's own button starts a real run.** `aw_import_host_run_hosted {kind: DISCOVERY}` arrived from the
  card's `START_RUN` over the Bridge, and the SERVER decided the kind from the ticket.
- **Discovery creates the plan on a real surface.** The step that had a pure decision module and no runtime
  around it now has one, and it works where the marketplace declares no bounds at all.
- **A `SCOPE_MISMATCH` is finally visible to the person who can repair it.** The gate blocked (the screen held
  discovery's own range, not the segment's), the card rendered "선택한 기간이 달라요 / 날짜를 다시 선택해
  주세요", the operator corrected the dates and pressed the recheck, and the gate re-read `MATCH`. On the
  previous live run the runtime reported this correctly and the seller's screen said nothing.
- **Two runs, one sitting, one socket.** Discovery then a segment, each on a fresh runtime-minted identity,
  with no agent restart and no reconnect.

## Findings — four of them are ours, and one is a journey decision

| # | Finding | Where it bites |
|---|---|---|
| 12 | **`SCOPE_BLOCKED` leaves the previous step's highlight on the marketplace page.** Nothing unmounts it, so the seller sees "still waiting for the end date" on a run that has stopped and needs a repair. | The operator concluded the date field was broken and kept changing it; the run had already blocked 30 seconds earlier. |
| 13 | **A date barrier cannot be satisfied when the required value is ALREADY in the field.** The observer requires a value change, and discovery leaves its own range in the inputs — so the first segment's start date is usually already correct, and the end date defaults to today. | The seller must set a wrong date and correct it. Needs an engine-level answer (report the step `SKIPPED` when the field already holds what the gate will accept); the driver is not told the required window, by design. |
| 14 | **There is no seller path to pair the local agent.** `BridgeStatus` is the only surface with a 연결하기 button and `AppShell` mounts it only under `VITE_ENABLE_AGENT_BRIDGE=true`. | A guided import requires a paired agent; without the flag the CTA can never succeed. |
| 15 | **The backend allows exactly one CORS origin and the login form reports a network failure as bad credentials.** `127.0.0.1:5173` fails the preflight while `localhost:5173` passes. | Twenty minutes lost to a "wrong password" that was a 403. |
| — | **`REQUEST_STEP_RECHECK`'s label is "확인 완료" at every barrier.** At a blocked scope the seller has not confirmed anything — they corrected dates. | Per-barrier copy is owed. |
| 16 | **The premise of range discovery does not hold on this surface.** `available-range-discovery.ts` asks "how far back does the marketplace currently let this seller reach?" — but the operator confirmed NAVER's calendar restricts nothing, so there is no reachable limit to discover. What the seller is actually deciding is **how far back they want to import**, and the copy asking for "선택할 수 있는 가장 이전 날짜" describes a limit that does not exist. | The recorded value is still honest (`OPERATOR_CONFIRMED` = the seller established it), but the concept, the copy, and the consequence — the range they pick becomes the plan, so three years is 37 segments with no warning — all need a product-owner pass. A seller who does not know that will pick 2015 and be handed 130 segments. |

**A diagnosis I got wrong, recorded because the reasoning matters.** When the operator reported the end date
not advancing, I concluded Angular had replaced the tagged node and made the poll re-resolve `[data-aw-target]`
on every tick. The operator's own evidence disproved it — the tag was still on the input — and the log showed
the barrier had in fact passed and the run was parked at the gate (finding 12). The re-resolution change is
kept: it removes a real failure class (a detached node's value can never change again) and costs one
`querySelector` per 250ms. But it fixed nothing here, and calling it the fix would have been wrong.

**Recorded product decision (product owner, this session).** The current design makes the seller alternate
between two windows, and a blocker that only changes text in the *other* window is invisible — which is exactly
what happened. Going forward: **the seller chooses the import once in SellerOps, everything else completes
inside the SmartStore page, and they return when it is done.** The frontend keeps ownership of every sentence
(contract §6): it sends the already-composed prose down for the runtime to display, rather than the runtime
holding a copy map. Any control placed in the marketplace page must be unmistakably SellerOps' own and must
never click anything on NAVER.

## Limitations of this run, stated

- **The pairing approval control was NOT exercised.** `dev_tty_stderr` needs a real TTY and this harness
  redirects stderr, so the bridge correctly refused to pair; the run continued under
  `--dev-insecure-auto-approve`. The out-of-band approval remains unproven on this path.
- One account, one segment, a disposable local backend. Not operational status.
- The segment's `UNREADABLE` → `OPERATOR_CONFIRMED` branch and an apply-requiring surface are still untested.
- The card opened five import sockets over the sitting (dev remounts). Harmless for display — one session
  publishes to all — but worth a look before this ships.

---

# Addendum 3 — the SmartStore-side journey (offline, 2026-07-26)

**Status: offline-proven when written; LIVE-PROVEN the same day — see Addendum 4.** Everything below is verified
by the cross-stack suite over a real socket (`collector/test/crossstack/fe-import-runtime-real-bridge.test.ts`)
plus the per-module suites, and the journey it describes then ran live on 2026-07-26 for one segment. Two things
in it remain offline-only even after that run: the panel's **blocked** state (the live gate matched on the first
read) and the pairing approval control. Read Addendum 4 before citing anything here as live-verified.

## What the product owner changed, and why each change is a measured failure rather than a preference

| Decision | The evidence behind it |
|---|---|
| One start in SellerOps, then **finish inside the SmartStore window**. | The seller worked in the marketplace tab while the instructions and the blocker lived in the SellerOps tab. A `SCOPE_MISMATCH` was reported correctly and the operator kept changing a date for 30 seconds afterwards, because the only thing that changed was text in a window nobody was watching (finding 12). |
| Range selection is **the seller choosing how far back to import**, not discovery of a marketplace limit. End date = today; they pick the start month; the period **and its segment count** are confirmed before a plan exists. | The operator confirmed NAVER's review calendar restricts nothing — there was no limit to discover, so the tutorial asked about a constraint that does not exist (finding 16). And the consequence was never stated: the range chosen becomes the plan, so three years is 37 manual exports. |
| **Newest month first.** | A plan can be dozens of hand-performed exports and a seller may stop part-way. The recent months hold the reviews that still need answering. |
| A date step whose field **already holds the required value is `SKIPPED`.** | The barrier advances on a value CHANGE, so a correct value could never satisfy it; the live run had to set a deliberately wrong date and correct it (finding 13). |
| On a block: **remove the previous highlight** and show cause + repair + the recheck control in the marketplace page. | Finding 12, both halves. |
| The **frontend composes the overlay's sentences and sends them down.** | Contract §6 gives every user-facing word to the FE. Moving the surface must not move the ownership. |
| Every NAVER click stays the operator's. | Unchanged, and structurally so: no driver method clicks, and the in-page panel's own buttons stop their events at the panel. |

## What changed in the code

| Finding | Fix | Pinned by |
|---|---|---|
| 12 | The mismatch branch returns a new `CLEAR_HIGHLIGHT` effect; the live driver unmounts the spotlight, drops the `data-aw-target` tag, and stops the date poll. The stop is then rendered in the page with its repair. | `guidance-copy.test.ts`, `live-import-driver-frame.test.ts`, cross-stack "shows the stop, its repair…" |
| 13 | A `{prefilled}` probe runs after locate and **before** any annotation; `onTargetPrefilled(target, true)` reports the step `SKIPPED` and advances. `totalSteps` does not move. The driver answers through the gate's own read (`readExportScope` → `matchExportScope`), so the skip decision and the later verification cannot disagree. | `import-session.test.ts`, cross-stack "skips a date step whose field already holds…" |
| 14 | `AgentPairingPanel` on the card that is blocked without it — ungated, no env flag. The page owns the bridge client and passes the phase down. | `AgentPairingPanel.test.tsx`, `GuidedImportCard.test.tsx` |
| 15 | `loginFailure()` splits "the server rejected your credentials" from "nothing answered". No status, URL or origin reaches the screen. | `loginError.test.ts` |
| 16 | The discovery run is **deleted**, not reworded: engine, session, stages, driver role, dispatch and host branch are gone, and `actionWindow.importDiscovery.*` no longer exists. The seller picks a start month in SellerOps; the backend records `OPERATOR_SELECTED`. | `reviewImport.test.ts` (asserts no `importDiscovery.*` key survives), `import-host.test.ts` (a DISCOVERY ticket is refused, no driver call), `ReviewImportLaunchServiceTest` |
| recheck copy | `recheckLabel({copyKey, blockerCode})`, resolved blocker → step → fallback, used by the card AND carried in the pack for the in-page panel. | `reviewImport.test.ts`, `guidance-copy.test.ts` |

## How prose reaches the marketplace page without the runtime owning it

A new **FE → Runtime** frame, `aw_guidance_pack` (`contracts/action-window/v2/transport.ts`). The normative
message contract (`v2/index.ts`) is **untouched**: no enum, envelope, view model or validator changed, and the
Runtime→FE privacy invariant and `findProhibitedFields` are exactly as they were. The direction is inverted
rather than relaxed —

- the frontend composes every sentence (`buildImportGuidancePack()`), including the panel's own chrome;
- the runtime does lookup and `{param}` substitution only, and **a copy key with no entry renders no sentence**;
- `guidance-copy.test.ts` asserts there is **no Korean string literal** in either panel module, so a
  runtime-authored sentence cannot be added without failing a test;
- the pack is never echoed back, never persisted, and logged only as counts.

The pack is re-sent after every successful `START_RUN`, because the host builds a fresh session per segment and a
new session starts with no copy at all — without that the seller would get guidance on segment one and silence
afterwards.

## The panel is an input surface, not an actor

Its buttons are SellerOps' own controls, and pressing one is the same class of event as satisfying a barrier. The
fences that keep that true:

- `pointer-events` is enabled **only** on the panel; the spotlight stays transparent, so nothing can intercept a
  marketplace click;
- panel button handlers call `preventDefault()` + `stopPropagation()`, so a click never continues into a control
  underneath;
- copy is inserted with `textContent`; no `innerHTML` anywhere;
- an intent arriving from the page is treated as **untrusted input**: only the two commands the panel ever
  renders are accepted, then the runtime's own `allowedCommands` is checked. `SWITCH_TO_MANUAL` is allowed at a
  barrier and is still refused through this path, because the seller was never offered that button.
- `REQUEST_STEP_RECHECK` still only re-arms or re-reads. Nothing completes a step on anyone's word but the
  runtime's own observation.

## Still unproven after this slice

- **The whole in-page journey, live.** The panel, the skip, the cleared highlight and the panel-driven recheck
  have never met a real NAVER surface.
- More than one segment in a sitting on a live surface; an apply-requiring surface; the segment `UNREADABLE` →
  `OPERATOR_CONFIRMED` branch.
- The pairing **approval** control (still bypassed by `--dev-insecure-auto-approve` on the one live run).
- Whether the panel's fixed bottom-left position ever covers something the seller needs on a real page.
- The five-sockets-per-sitting dev observation from Addendum 2.

---

# Addendum 4 — LIVE: the new journey, one segment, 2026-07-26

**Ran live once**, seated operator, own test seller account, disposable local backend
(`sellerops_riv_journey_20260726T022837`, dropped afterwards). This is the first live evidence for the journey
Addendum 3 describes; it supersedes nothing in Addendum 2, which recorded the flow this replaces.

## Result

| | |
|---|---|
| Plan creation | `2026-06-01 ~ 2026-07-26`, 2 monthly segments, `range_evidence = OPERATOR_SELECTED`. **No marketplace window opened for this step** — the seller chose a start month in SellerOps and confirmed the period and the segment count. |
| Order | Newest month first: the ticket was minted for `2026-07-01 ~ 2026-07-26` while June stayed `PENDING`. |
| Guidance pack | `aw_import_guidance_pack {steps: 9, blockers: 9, commands: 2}` — the frontend's prose crossed the socket and reached the session the host had just built. Counts only in the log; no sentence appears anywhere in it. |
| Surface facts | `requiresApply: false`, `dateInputCount: 2`, `applyWordingPresent: true` but no apply control in the plan. |
| finding 13 | `aw_import_prefilled_probe {start_date, prefilled: false}` → the seller was asked. After they set the start date, `{end_date, prefilled: true}` → **the step was reported `SKIPPED`** and the run went straight to the gate. |
| Scope gate | `aw_import_scope_verdict {match: MATCH, datesParsed: 2, spanDiffers: false}` on the first read → `MACHINE_MATCHED`. |
| Ingest | `upload.segment.done {result: SUCCEEDED, rowsNewBucket: tens, duplicate: zero, failed: zero}`. Segment `COMPLETED + COVERED`, `covered_rows = 62`, 62 rows in `reviews`, attempt `SUCCEEDED`, plan `ACTIVE` (June still remaining). |
| Tickets | the DISCOVERY ticket `CONSUMED` by the plan creation; the first SEGMENT ticket `EXPIRED` (handed back after a refused `START_RUN` — see below); the real one `CONSUMED` with `scope_evidence = MACHINE_MATCHED`. |
| Log hygiene | zero occurrences of any launch ref, any date, or the surface URL in the agent log. |
| Operator effort | **two interactions with the marketplace**: type the start date, then press 엑셀 다운로드 and NAVER's own 확인. Gate-MATCH to ingest-complete was 11 seconds. |

## What this proves that Addendum 3 could not

- **The seller's own choice creates the plan, with no marketplace involvement at all.** The step that used to be
  a guided run through NAVER's date pickers is now a question answered in SellerOps, and the recorded evidence
  says exactly that (`OPERATOR_SELECTED` — never a machine claim).
- **finding 13 is closed on the real surface.** The current-month segment's end date defaults to today, which is
  precisely the case that could never satisfy a change-based barrier. It was skipped, live, with no wrong-date
  workaround — the manoeuvre the 2026-07-25 run had to perform.
- **The frontend's words reach the marketplace page over a real socket**, re-sent per run, with the runtime
  holding no prose of its own.
- **Newest-month-first is real**, not just a sort in a unit test.
- **A refused `START_RUN` costs nothing.** The ticket came back `EXPIRED` and the seller simply pressed again.

**What it does NOT prove, and must not be written as if it did.** The goal of the slice is that the seller never
has to look back at the SellerOps window — and **a log cannot see where someone is looking.** What was measured
is that the run needed two marketplace interactions and that the panel was rendered for every transition; whether
the operator actually got through it without reading the other window is **unconfirmed**. The next run must ask
explicitly, and the answer belongs here.

## The one failure, and what it was

The first `계속 가져오기` produced `aw_import_host_scope_refused` and no run. Cause: **the operator and the agent
were authenticated as different orgs.** The login form pre-fills `demo@sellerops.ai`, so the browser created the
plan and the ticket in the seeded demo org while the agent had been started with the freshly-seeded account's
credentials. The server answered `404 가져오기 요청을 찾을 수 없습니다` — deliberately the same answer as a
spent or non-existent ref, so a caller cannot probe the ref space — and the host refused fail-closed.

**Not a product defect; an environment trap, now recorded in the runbook as trap 6.** What it did prove: the
refusal is legible (the card surfaced a failure rather than hanging), and the unspent ticket was handed back.
Restarting the agent with the operator's own org was the whole fix; nothing was rebuilt and the plan survived.

## Observations worth keeping

- `frameResolved: false` with `iframePresent: true` and `dateInputCount: 2`: the date controls were found in the
  TOP document this time, unlike the 2026-07-25 run where the surface was frame-hosted and reading the top
  document was the first live failure. The shared-context fix means either answer works, but the surface is
  evidently not always frame-hosted — worth remembering before diagnosing a locate failure as a frame problem.
- `applyWordingPresent: true` while `requiresApply: false`: the wording heuristic sees apply-like text on a
  surface that needs no apply press. The plan was correct; the signal is noisier than the decision.
- The operator called the **start-month picker UI poor** and asked for it to be improved. Recorded as a `[PO]`
  follow-up: the mechanism is proven, the presentation is not settled.

## Added after the run, at the operator's request — and therefore NOT live-proven

They asked that pressing 연동 in SellerOps **bring up the seller-center window** instead of leaving them to find
it; on this run they had to go looking for it. A run now raises SellerOps' own window and, if it has drifted off
the review surface, navigates back to it (`naver/surface-presentation.ts`, injected into the driver by the
approval-gated boot so no URL ever enters the driver).

Both are actions on our own window — raising it, and following the same public application route the boot already
used. Nothing is clicked, typed, submitted or consented. The one refusal is load-bearing: **it never navigates
away from an off-origin page**, because a seller part-way through a NAVER login or a 2FA step would lose it, and
that is indistinguishable from SellerOps breaking their login. Off-origin, the window is raised and the run fails
closed on `LOGIN_REQUIRED` as before. `aw_import_surface_present` logs the branch as an enum plus two booleans —
never a URL.

**Written down as unproven:** this was implemented after the live segment completed, so no live run has exercised
it. The decision is pure and unit-tested (including every refusal branch), and the driver-level order — present
first, then ask whether the surface is usable — is pinned by a source guard.

## Still unproven after this run

- The window presentation above (added afterwards; see that section).
- More than one segment in a single sitting, live (the bounded-proof limit held at one).
- An apply-requiring surface; the segment `UNREADABLE` → `OPERATOR_CONFIRMED` branch; a live `SCOPE_MISMATCH`
  under the NEW panel (the gate matched on the first read, so the in-page blocker rendering — cause, repair,
  contextual recheck label — is still offline-proven only).
- The pairing **approval** control: `--dev-insecure-auto-approve` again, for the same TTY reason. Two live runs
  have now skipped it.
- Whether the panel's fixed bottom-left position ever covers something the seller needs.
