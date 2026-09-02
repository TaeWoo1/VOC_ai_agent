# NAVER Guided Acquisition — end-to-end, live

> **What this is.** The first complete run of the guided review import: a sentence in the home
> conversation → the seller's own SmartStore window → dates → 조회 → their own export click → automatic
> download detection → artifact validation → launch-bound ingest → the same conversation. Live, on
> 2026-09-02, segment **2026-08-20 ~ 2026-09-02**.
>
> **Marketplace WRITE 0 · automatic click 0 · automatic download 0 · consent by the seller.** Every press
> on NAVER was the operator's; the runtime highlighted, observed, and processed the file they produced.

---

## 0. What it produced

| | |
|---|---|
| attempt | `SUCCEEDED` · **rows_new 115 · rows_duplicate 33 · rows_failed 0** |
| scope evidence | **`MACHINE_MATCHED`** — the runtime read the selected range back and it agreed |
| segment / plan | `COMPLETED` / `COVERED`, covered_rows **148** — the window's whole content |
| reviews | NAVER `REAL` 4,340 → **4,455**; `acquisition_sync_job_id` **0 → 115** |
| run | `SELLER_CENTER_EXPORT`, 148 rows, bound to the launch through the attempt |

The duplicate count is the check, not a leftover: 33 is exactly the 2026-08-20/21/22 rows already held, and
115 is 08-23 onwards, which had never been imported. Every one of the 115 carries a non-blank channel review
id, and the attempt→segment→plan→account chain resolves to a `CONNECTED`, non-file-upload account on the same
channel — the three conditions `ExecutableIdentityResolver` requires for `MARKETPLACE`. Before this run the
product held **zero** stamped reviews: the 482 rows the 2026-08-23 import inserted predate `V83`, which is why
every NAVER review had resolved `NONE` and why the reply lane had never had an eligible object.

## 1. Six defects, each found by the run reaching further than the last one did

**A parked run now looks again by itself.** The surface probe ran ONCE, 0.2 seconds after the window opened —
while the seller was necessarily still logging in — and then waited for a human to press 「다시 확인」. The
first state of every first run was being treated as a stall only a person could clear. `ImportSegmentSession`
now watches a park and re-issues its repair: session/surface parks re-probe **quietly** (raising the window
every two seconds while someone types a password into it would be worse than the wait), and a scope park waits
for the seller's own 조회 press before re-reading, because the read reads the date INPUTS and a value typed
there is not a range the grid is showing. Measured live: **three automatic retries, zero seller rechecks.**

The safety line is what makes this legitimate rather than an act taken on the seller's behalf: re-probing and
re-reading are reads, and a read may advance guidance but never an action barrier
(`sellerops_live_approval_contract.md` §5b). No branch presses, exports, downloads or consents.

**A scope mismatch is re-read rather than waited on.** Same watcher. On 2026-09-02 the seller corrected the
dates in front of a run that had stopped reading, and nothing happened.

**The export tie is the seller's to break.** Two REAL controls on the review surface — an anchor reading
「다운로드」 and a button reading 「엑셀」, neither nested in the other (`exportCandidateShapes` finally said
so). Failing closed was right while the runtime had to NAME one of them; it is the wrong answer to a question
one press settles, and it killed the run at the last step before the file. Both are rung now and the ordinary
barrier follows — nothing clicks, and the artifact and scope gates still decide. `armObserver` watches every
tagged control rather than the first, which is what makes "press whichever is yours" observable. A date or
apply tie stays fatal: those are READ, and reading the wrong one is a wrong answer nobody would notice.

**The conversation lane sent no guidance pack.** The seller's window showed rings on the right controls and
not one word — no instruction, no stop reason, no recovery control. Not an overlay bug: the runtime authors no
sentence of its own by design, and `queuePanelRender` returns early without a pack. The onboarding card had
always sent it; the lane the product is built around never did, and that sitting's log carries no
`aw_import_guidance_pack` line at all.

**A detection window that expired was being treated as an answer.** The consent barrier awaited one cached
download race with a 15-second deadline; a seller reading NAVER's consent dialog takes longer. The resolved
`false` stayed cached, so every later poll returned it instantly and the run could never advance again even
once the file arrived. A spent race is dropped and re-armed; the underlying `waitForEvent("download")`
listener is now **kept across attempts**, because Playwright delivers nothing that happened while no listener
was armed and re-arming from scratch would lose exactly the download that arrives in the gap. For the same
reason `armObserver` no longer un-sees a click: it used to reset the flag on every re-arm, so a press landing
in the 250 ms gap was erased — and at the export barrier that is the press that produces the file.

**The file was refused as "not a workbook" by a workbook.** The last step, and the one that made the run look
finished while nothing had been written: `지원하지 않는 파일 형식입니다. CSV 또는 XLSX 파일을 올려주세요.` about
a valid OOXML package Excel opens. `UploadFormat` looked for `[Content_Types].xml` in the first 8 KB on the
stated assumption that the entry is always first. NAVER's export puts `xl/worksheets/sheet1.xml` first, so the
marker's local header sits **15,413 bytes** in. The ZIP branch now looks up to 1 MB — spent only on a file that
has already proven it is a zip — and it is not a loosening: an archive that never declares OOXML is still
`UNKNOWN`, pinned by a test built from a synthetic package rather than the seller's export.

## 2. Verification

collector **9,398** · frontend **2,632** · backend **3,634** · failures **0** · typechecks clean.

Two new collector suites (`guided-acquisition-autoresume`, `download-detection-rearm`) and three new backend
cases pin the behaviours above. No safety assertion was weakened; the date/apply ambiguity, the scope gate,
the single-use launch and the "no click, no download, no submit" driver surface are unchanged.

## 3. Reported, not fixed — for the Chat-first UX package

- **The result in the conversation is not in a readable shape.** The run reports completion; presenting what
  arrived (115 new, 33 already held, the window it covers) is a chat-surface question and is deliberately out
  of this package.
- **A highlight briefly landed on an unrelated control**, once, mid-run. Most likely the scope watcher
  re-locating the apply control (which re-tags, and the overlay rings what is tagged). Not reproduced since.
- **Channel continuity** — a NAVER follow-up turn came back with Cafe24/Coupang cards beside it.
- **The first turn asserted "no reviews today"** for a channel that had never been collected, and offered no
  path to collect it. The second phrasing did raise the card.
- **`reply/naver` minted seven pairing tickets in 70 ms** on a turn whose review list was empty — the same
  mount-storm shape the import lane fixed, in the lane that did not get the fix.
- **Three CTAs on one card** (최신 리뷰 가져오기 · 계속 확인하기 · 파일로 직접 올리기).
- **The seller had to reshape the plan by hand** for this sitting (abandon → pick a period → merge two
  segments) because the conversation lane extends to today and mints the newest remaining segment, which can
  only ever be the current month. reviewnary should compute the uncollected range itself.
- **`frameResolved: false` with `iframePresent: true`** remains unexplained, and is not a suspect in anything.
