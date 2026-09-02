# NAVER Guided Reply — Phase 2 live proof: approved draft filled into the exact review's composer

**2026-09-03 · `LIVE PASS` · marketplace WRITE 0 · submit 0**

## The claim this run establishes

> A draft the seller **explicitly approved** was placed into the composer of the **exact NAVER review** it
> was approved for, and the run stopped there. reviewnary posted nothing.

Everything narrower than that sentence is a residual and is written down in §6. In particular: **the reply
was not posted**, the channel was not told anything, and `COMPOSER_FILLED` is a local observation — the
text is in the box, and the box is still the seller's to send or discard.

---

## 1. Run identity

| | |
|---|---|
| HEAD | **`0f9b4187`** |
| Date | 2026-09-03 04:46 KST |
| Org | `7146c50f-ff6d-4c83-ae96-18c930e6d8e0` (canonical Demo Org) |
| Seller account | `bdccb7a7-99b9-45f7-aa09-8cf2e14c7f03` — NAVER, API mode (`is_file_upload=false`), `CONNECTED` |
| Channel | NAVER `9e53507e-a38d-449f-95fd-1b9b8e5a4bd3` |
| Approval | single-use, granted in-turn by the product owner; allowed actions `OPEN_EXACT_REVIEW_DETAIL` ×1 · `OPEN_COMPOSER` ×1 · `FILL_APPROVED_DRAFT` ×1; terminal at `WAIT_FOR_SUBMIT` |
| Run mode | `FULL_SUBMIT` (the product path's only mode — see §6) with `composerFill` and `agentOpensComposer` on |

## 2. Target and its provenance

| | |
|---|---|
| Review | `c329471c-90ea-4a55-b874-912c3fc88ccd` |
| Channel review id | `5052821329` · fingerprint `b2ea75b5bd04c376088e7a92eb930f3dce4d41eb29dbb453fbab1849ed12d527` (`review-id-fingerprint/v1`) |
| Product | 선바로 일체형 전선몰딩 열고 닫기 편한 전선몰드 |
| Rating / written | ★4 · 2026-08-28 |
| `executableIdentity` | **`MARKETPLACE`** |

**Identity comes from acquisition provenance, not from the shape of a string.** All three conditions
`ExecutableIdentityResolver` requires held, and were re-read at HEAD:

1. A trusted acquisition run wrote the row — sync job `c1701821-16ef-4ef9-9bde-146f16fed8f0`,
   method `SELLER_CENTER_EXPORT`, with a complete launch binding (segment attempt `5e4dcf94` → segment
   `561e1432` → plan `7cdb6e0f` → account `bdccb7a7`).
2. Exact org + API-mode account binding on the review's own channel.
3. The provider's own object identity present (`external_id = 5052821329`).

## 3. The approved draft

| | |
|---|---|
| Approval | **`188019ca-cf1f-4373-920f-aa3e16bb3071`** · state `APPROVED` · decided 2026-09-03 02:05:44 KST by `SELLER:242829f0-…` |
| Approved version | **3** |
| Approved fingerprint | **`44627df4be881fc993f4fbcae839a85d244d833ce156ddac32119a55961c7bd3`** (`review-reply-v1`) |
| Audit trail | one transition, `(none) → APPROVED`, command `628ecaf2-…` — no approve/withdraw cycle |
| Draft head | v3 == approved head; v1 `700b7924…` and v2 `7482a92e…` unchanged, no new version written |

The approved text was written by the **seller**, not the model: v1 was the rule-based template's output,
and v3 is the seller's own edit of it. The fingerprint was reproduced independently of the database before
the run.

The single-use binding this run spent: `e6cf811bc9504362` · `bound_version 3` ·
`bound_fingerprint 44627df4…` · `execution_mode GUIDED_BROWSER_EXECUTION` · resolved 04:46:38 KST.

## 4. What the run did, in its own log

```
04:46:44  surface_ready    {rowsOnPage:22, stablePolls:3}
04:46:51  locate_sweep     {step:9, rowsInPane:25, matches:1}
04:46:51  ladder           {fingerprintHits:1, ratingConsistent:1}
04:46:51  detail_control   {candidates:1}
04:46:53  detail_scope     {candidates:2, matched:1, nested:1}
04:46:53  open_composer    {via:"detail", opened:true}
04:46:53  locate_composer  {composersInRow:1}
04:46:53  execution_observed {state:"COMPOSER_FILLED"}
```

Counted over the whole run: `open_composer` **1** · `locate_composer` **1** · `execution_observed` **1** ·
`submitted` / `SELLER_SUBMISSION_OBSERVED` / `OPERATOR_REPORTED` / any report marker **0**. Nothing follows
`COMPOSER_FILLED`.

**Three independent identity checks stand between the row and the keystrokes:**

1. **Locate** — exactly one row on the page carried an id token whose fingerprint equals the backend's
   `review-id-fingerprint/v1`, and its rating did not contradict the hint (`fingerprintHits 1`,
   `ratingConsistent 1`).
2. **Detail control** — exactly one control inside that row carried the same fingerprint
   (`candidates 1`). Submit wording disqualifies a control before its identity is even considered.
3. **Detail scope** — after the click, exactly one visible panel held exactly one composer **and** an
   element whose text fingerprints to the submission target's `review-body-fingerprint/v1`
   (`matched 1`; one nested duplicate dropped as the same panel at two depths).

Only then does the fill gate run, and it additionally requires one matched row, one composer, a `MATCHED`
review-id verdict, and a draft present.

## 5. Database after the run

| Fact | Value |
|---|---|
| `review_reply_execution` | **1 row** — `lane GUIDED`, `status **COMPOSER_FILLED**`, `verification COMPOSER_FILLED`, bound to v3 `44627df4…`, ref `e6cf811b…`, `recorded_by SELLER:242829f0-…` |
| `provider_ref` on that row | **empty** — there is no marketplace post id, because nothing was posted |
| `review_reply_outcome` (target) | **0** |
| `reviews.reply_state` | **`PENDING`** · `replied_at` **null** |
| Approval | `APPROVED` v3, unchanged |
| Drafts | 3 rows (v1/v2/v3), unchanged — no version written by this run |
| Other reviews: execution / outcome / approval | **0 change** — org-wide `review_reply_execution` is this one row; the org's 4 `review_reply_outcome` rows all belong to review `4e00cd46` and were written 2026-07-20/21 |
| NAVER `reply_state='ANSWERED'` rows | 38, all from the seller-center export's own 답글여부; newest `replied_at` 2026-08-21 — untouched by this run |
| Marketplace submit / save / send / publish | **0** |

**`COMPOSER_FILLED` is not "posted".** It is this product's record that the approved text reached the box.
The empty `provider_ref` is what makes that distinction checkable rather than merely stated.

## 6. Residuals — what this run did NOT establish

- **The reply was not posted.** No submit control was pressed, by anyone, and the run is parked at
  `WAIT_FOR_SUBMIT`. Whether NAVER accepts this reply, and what it looks like afterwards, is unproven.
- **Neither terminal was called.** 「답변함」 (`REQUEST_STEP_RECHECK`) and 「답변 안 함」 (`SWITCH_TO_MANUAL`)
  were both outside the grant, so the run holds no operator-reported outcome.
- **`ABORT_REHEARSAL` is unreachable from the product path.** The resident carrier hardcodes
  `mode: "FULL_SUBMIT"`; only the seated CLI can select the abort-terminal mode, and that path refuses
  under `NODE_ENV=production`. The product-owner accepted `FULL_SUBMIT` for this run on the explicit
  condition that no terminal command be called. reviewnary's inability to submit rests on the source
  fence (`reply-guard.test.ts`, 1,006 assertions: `.fill(` in one file, `.click(` in one file once, and
  no `.press(`/`keyboard`/`dispatchEvent`/`.submit(`/`requestSubmit` anywhere in the reply lane), not on
  the mode.
- **One channel, one review, one seller.** Nothing here says a second NAVER account, a review with no
  detail modal, or a differently-rendered grid behaves the same way.
- **§4.1 capability truth does not move on this document.** This is a run record. NAVER review reply
  remains what the capability table says it is; promoting it is a product-owner decision.

## 7. What was fixed to get here (results only)

Nine live attempts. Each failure was diagnosed from a measurement, not a guess, and each fix names the
measurement that justified it. The intermediate logs are deliberately not carried into canonical context.

| # | What was actually wrong | Commit |
|---|---|---|
| 1 | A recoverable surface blocker ended the run instead of being waited out | `7437f4c1` |
| 2 | NAVER's sign-in page read as signed in (`nid.naver.com/nidlogin.login` has no `/login` path segment) | `30cd8e13` |
| 3 | The SPA's shell read as the review list — the scan ran 441 ms after landing | `47e9d0d0` |
| 4 | A zero fingerprint-hit count could not distinguish "wrong range" from "no ids in the DOM" | `70ee53d0` |
| 5 | A half-drawn table read as a finished list (7 rows on a list that settles at 22) | `51bf0bfc` |
| 6 | Locate only ever read the first screen, while 35 reviews are newer than the target | `a1bc3134` |
| 7 | The sweep scrolled a navigation pane, because the row scan also matches `ul > li` | `019ed9b3` |
| 8 | The review id lives in an `ng-click` handler; the attribute rung accepted only `data-*`/`id`/`name` | `ef4680c8` |
| 9 | The composer is not in the row at all — it is in a detail modal the review-body link opens | `c7752e36` |
| 10 | The fill gate compared the real matched row index against a hardcoded `0` | `0f9b4187` |

Diagnostics were added alongside (`4b2cd60f`) so the surface, locate and composer stages each report what
they saw — counts, verdicts and closed reasons only, never a review id, page text or the draft.

**Verification at HEAD:** collector **9,411 tests / 0 failures**; `reply-guard.test.ts` **1,006 assertions**
green; the submit fence was not relaxed at any point in this sitting.

## 8. Method note

The path from row to composer was **observed, not inferred**. After two wrong inferences from log counts,
the remaining work was done by attaching read-only to the seller's own logged-in profile and reading the
DOM: which attributes a review row carries, where the review id actually lives, which pane scrolls, and
what appears when the review-body link is pressed. Those observations made zero marketplace writes and are
what §7 items 7–10 rest on.
