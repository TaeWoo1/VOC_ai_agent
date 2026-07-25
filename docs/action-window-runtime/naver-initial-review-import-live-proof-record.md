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
