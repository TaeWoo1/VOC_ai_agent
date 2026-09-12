# Coupang WING Review Acquisition over Aside — PoC v1

**Track:** Aside Acquisition — M3-C. **Baseline:** `reviewnary-pre-aside-v1` (`de1838f6`); M1+M2 at `1109e9ef`.
**Status:** **Phase A (read-only observation) — DONE. Phase B (explicit run → ingest → dedup → Review Core) —
DONE.** M3-C verdict: **DONE**, with four corrections to my own earlier statements recorded in §11.

> **NAVER stands untouched.** The NAVER one-explicit-run PoC is **`DEFERRED_BY_ENVIRONMENT`** (operator
> environment, 2026-09-12). The manifest prepared for it — `apr-nv-aside-obs-r1` — was **closed unapproved**.
> NAVER Seller Center this session: **tab 0 · click 0 · login 0 · observation 0 · export 0 · download 0.**
> **H-3 (NAVER store identity) stays OPEN/DEFERRED**; nothing in this document is evidence about it.

---

## 1. Why Coupang and not Cafe24

Cafe24 review acquisition already has a working official API connector, and replacing a working API with
browser automation is the opposite of what this track is for. Coupang WING review acquisition is the channel
whose CURRENT FACT is *authenticated browser execution* — seller PC → Local Helper → WING → seller-driven
page reads → one bounded handoff → existing ingestion. That is the thing an alternative executor can be
measured against.

## 2. Approval

| | |
|---|---|
| approvalId | `apr-cp-aside-obs-64cdf0` |
| runId | `wt-1f6da3f2` |
| mode | `READ_ONLY` |
| granted | operator, 2026-09-12, against the displayed manifest, explicitly excluding Phase B |
| gitSHA at grant | `1109e9ef` |

**Deviation, recorded rather than smoothed over.** `docs/sellerops_live_approval_contract.md` §3 says the
grant is a **press** on the SellerOps confirmation surface. An Aside-repl observation has no product surface
to press on — there is no run, no ticket, no screen. The grant was therefore the contract's one line against
the displayed manifest. Phase B does *not* inherit this shape: it is a product run with a ticket, and its
press exists.

**Retries.** Phase A ran the observation **three times** (front door with a narrow scan, front door with a
deeper scan, then the list page). Same session, same scope, same account, same channel, no code/branch change
between them — the live debug-loop that `CLAUDE.md` explicitly exempts from re-approval. Total live actions:
3 tabs opened, 3 closed, 1 in-page navigation to a route WING itself published, **0 clicks, 0 fills, 0 pager
presses, 0 downloads, 0 writes.**

## 3. What was observed

All values below are masked (`#` per digit) or are counts. No review body, no buyer value, no cookie, no
credential, and no URL query crossed into this document or into any log.

### 3.1 The Aside browser reaches WING already authenticated

| Signal | Front door | Review list |
|---|---|---|
| host | `wing.coupang.com` | `wing.coupang.com` |
| path | `/` | `/tenants/cs/product/review` |
| password inputs | 0 | 0 |
| sign-out words | 2 | — |
| iframes | 0 | **0** |
| elements | 2,671 | 2,216 |

The profile the Aside browser holds is a signed-in WING session. **Nothing logged in**; had it not been, the
program's first read returns `AUTH_REQUIRED` and stops before anything else — which is the same fence, tested
offline.

### 3.2 The review route is published by WING's own menu — it was not invented

The repository has never held a WING 상품평 deep link, and says so where it refuses to guess one
(`COUPANG_WING_LOCATE_LANDING_URL` = WING's front door: *"inventing a marketplace URL is exactly the guess the
assumption rule forbids"*). So the route was **read off the shell**: of 188 anchors over 93 distinct paths,
exactly **one** is the review list.

| anchor text | path |
|---|---|
| 리뷰 목록 | `/tenants/cs/product/review` |
| 리뷰 이벤트 관리 | `/tenants/rfm-ss/manage-review-campaign/landing` (a campaign screen — not ours) |
| 문의/리뷰 | menu group, no route |

**A stale vocabulary was caught by this.** The first scan searched for **상품평** — this repository's word —
and found it in **zero** elements on the shell. WING's navigation now says **리뷰**. The word changed under
constants that were calibrated in 2026-08 and nothing had noticed, because nothing had looked since.

### 3.3 The list is still the list the 2026-08 calibration measured

Run through this repository's **own** census instrument (`buildReviewListCensusScript`, "it counts, and that
is the entire list of what it can do"):

| reading | value |
|---|---|
| `reason` | `OK` |
| unit level | `TBODY`, `unitCount` **10**, siblings sharing class shape 10 |
| unit source | `COLUMN` (the strong route, not field-word agreement) |
| tables / `th` / `tr` / `td` | 1 / 7 / 11 / 70 |
| column probe | `exposedWithOption` — header `노출상품ID (옵션ID)`, cells 22, with digits 10, distinct first-run values 7 |
| id-bearing attributes | digit runs of length **10 and 11** on every unit (product / option) |
| units with detail link | 10/10 · with image 10/10 · with star-like class 10/10 · **with rating aria 0/10** |
| `distinctRowSignatures` | **9** of 10 |
| pagination | numeric pager, `numericPagerCount` 14, `highestPagerNumber` **5**, date inputs 0, selects 4 |

Header words present as exact own-text: **상품평 · 별점 · 등록일 · 작성자**. Every one of them is already a
literal in `REVIEW_COLUMN_ROLES`, and the four roles the reader **requires** — `date · rating · product ·
body` — are all resolvable. The 2026-08 sitting's decision to supply candidate spellings generously ("one more
`indexOf` per header cell is free; a sitting is not") is what makes today's screen readable without a change.

Two findings worth carrying:

- **`unitsWithRatingAria` is 0.** The rating is rendered as star classes, not an aria label. The canonicalizer
  takes `parseReviewRating(ratingText, ratingAria)` — both — so this is survivable, but it is the single most
  likely cause of a row-drop in Phase B and the counter to read first.
- **`distinctRowSignatures` 9 < 10 units.** Two rows on this page carry the same digits everywhere. That is
  the screen-level restatement of `externalId = null`: WING publishes no per-review identifier, dedup is
  content-based (`ReviewDedupKey` v2, folding rating), and no key of any kind can be built from the numbers.

## 4. C-H3 — Coupang seller/account identity: **`C_H3_CONFIRMED`**

**The identifier:** **업체코드** — Coupang's own vendor code, `A` + 8 digits, printed in the WING shell chrome
as one span whose own text is `업체코드 A########`.

| property | evidence |
|---|---|
| channel-native | Coupang's own vendor code, not a display name (PD-4 requires exactly this) |
| present where it matters | observed on the **review list page itself**, not only on the front door |
| stable | it is the value a seller types into SellerOps when they issue API credentials |
| **already held by us** | `CredentialTemplates` seals it as `vendor_id`; `CoupangApiConnector` signs every order call with it |
| machine-verifiable | exact comparison, not resemblance |

It is **confirmed**, not composite: a single stable identifier exists and both sides of the comparison already
have it. The expectation is therefore not a new fact to collect — it is one this org gave us at connection.

**Two honest qualifications.**

1. **The label occurs twice.** That is the same duplication that parked the guided issuance walk on
   `LABEL_NOT_UNIQUE`. Pointing at it needs a unique element; *reading* it does not — the rule adopted is that
   every occurrence must **agree on one value**. Two elements printing the same code is agreement; two
   printing different codes is `UNRESOLVED`, never a guess.
2. **The digest is a comparison device, not a privacy device, and the code says so.** A vendor code is one
   letter and eight digits — SHA-256 over that space is enumerable, exactly as
   `connection/seller-account-fingerprint.ts` warns about small identifier spaces. It is used so the raw
   credential value never leaves the vault boundary and so a later reader cannot mistake it for a credential.
   It is not claimed to conceal the code from whoever holds the digest.

## 5. Where ASIDE plugs in — and what did *not* have to move

`acquire/coupang` does not run through `ImportSegmentHost`, so M1's segment seam was **not** stretched to
cover it. The seam that already existed is smaller and better:

```
ReviewAcquisitionProbeDriver
  ├─ LazyReviewAcquisitionDriver   (LOCAL_HELPER — the seller's own window, unchanged)
  └─ AsideReviewAcquisitionDriver  (ASIDE — the deterministic executor)
```

**Four methods, one of them required.** Everything else is untouched: the pure `ReviewAcquisitionEngine`, the
walk rule and its bounds, the canonicalizer, the one bounded handoff, `SELLER_CENTER_READ`, the dedup formula,
the backend, and the v2 view the frontend renders.

**The page-turn fence is inherited, not re-stated.** The seam has no verb for a page turn — *"a seam that
cannot express a page turn is the structural form of that rule"*. An Aside run cannot turn a page for the same
reason a seated one cannot.

**The PoC bound is one page.** `ASIDE_ACQUISITION_MAX_PAGES = 1`. At one page the run performs **zero
marketplace clicks** — it opens an official route and reads — which preserves the property every live-proven
seated run has had (*"paging performed by the seller (0 marketplace actions)"*) while the executor changes
underneath it. Deterministic pagination is a separate decision and is **not taken here**.

## 6. Order of operations, and what each refusal means

```
openTab(official route) → settle → AUTH → IDENTITY → ROWS
```

A page is not read until the store it belongs to has been established. The executor answers with identity and
rows in the same reply, so on a mismatch **the rows are in hand and are dropped unread** — asserted by test.

| what happened | wire word | recoverable | seller sees |
|---|---|---|---|
| sign-in wall | `LOGIN_REQUIRED` | yes | log in, try again |
| different store | `STORE_MISMATCH` | yes | sign in as the account you connected |
| nothing read / two disagreeing codes / no expectation | `STORE_UNRESOLVED` | yes | stopped without reading; check the screen |
| Aside not running / no answer | `EXECUTOR_UNAVAILABLE` | yes | the marketplace is fine; start the program |
| not a review list | `UNSUPPORTED_STATE` | yes | (unchanged) |
| unexplainable | `RUNTIME_FAULT` | no | start a new run |

Three blocker codes are new; every other word already existed. **`STORE_UNRESOLVED` is deliberately not
`STORE_MISMATCH`**: "we do not know" and "it is the wrong one" have different repairs, and neither may be
reported as success.

## 7. What changed in code

| file | change |
|---|---|
| `collector/src/action-window/coupang-review/wing-identity-inpage.ts` | **new** — the identity + sign-in-wall page scripts (strings, ES5, value-free by shape) |
| `collector/src/action-window/coupang-review/wing-store-identity.ts` | **new** — digest + the three verdicts |
| `collector/src/aside/coupang-review-workflow.ts` | **new** — one route, one version, screened by the product's own WING classifier |
| `collector/src/aside/coupang-review-runtime.ts` | **new** — the serialized in-browser program; **forwards** page scripts, authors none |
| `collector/src/aside/coupang-review-executor.ts` | **new** — plan/program/parse, reusing M2's CLI classification |
| `collector/src/aside/aside-review-acquisition-driver.ts` | **new** — the seam implementation |
| `backend/.../WingStoreIdentity.java` | **new** — the same digest, the other half of the comparison |
| `backend/.../AgentReviewAcquisitionTargetView.java` + service | `expectedStoreFingerprint` from the sealed `vendor_id`; a vault that cannot be opened yields **no** expectation, which is a stop |
| `contracts/action-window/v2/{index.ts,schema.json}` | 3 additive blocker codes |
| `review-acquisition-{engine,driver,run-session}.ts` | one optional `blocker` on the page report, one optional `lastBlocker()` — absent ⇒ byte-identical seated behaviour |
| `cli/local-agent.ts` | provider gate + driver choice + the one-page bound + a provider log line |
| `frontend/src/lib/actionWindow/copy.ts` | seller-facing copy for the three new words |

**The `evaluate` fence was narrowed, not lifted.** M2 banned `.evaluate(` across `src/aside/`. A review list
cannot be read without running a reader in the page, so the ban now exempts exactly one file — and that file
is held to a stricter rule than the ban was: it may name no DOM API, hold no string literal 40 characters or
longer, and every `evaluate` argument must be a **named plan field** (`/^plan\.[a-zA-Z]+Script$/`). Arbitrary
evaluate is still structurally impossible. The `password` token exemption is narrower still: the only
occurrences are the sign-in-field **selector** and the **count** it reports — counting a password field in
order to refuse is the opposite of the banned capability, and a guard that could not tell those apart would
forbid the fail-closed check.

## 8. Tests

| suite | result |
|---|---|
| collector | **404 files · 9,591 passed · 0 failed** (21 files / 160 skipped) |
| frontend | **2,781 passed · 0 failed** |
| backend | **3,909 tests · 0 failed** (25 skipped) |
| `tsc --noEmit` (collector) | clean apart from the pre-existing baseline error in `reply-session.test.ts` |
| aside guard | 14 → **28** assertions |

New offline coverage: the two page scripts against the shared fake DOM (including the twice-printed label and
the sign-in wall), the three verdicts, the driver's refusal paths, and the serialized runtime in an **empty
VM** proving the order `auth → identity → rows` and that a script which is not one of the three plan fields
can never reach the page.

**A fake was fixed, not a production selector.** `fake-dom.ts` rejected `input[type="password"]` — a selector
every real browser accepts — so the sign-in-wall test went green for the wrong reason. That is precisely the
failure that file's own docblock warns about, so the fake was corrected and given `childNodes`, which it
needed to express "this element's own text".

**Cross-language vector pinned.** The digest is computed in TypeScript on one side and Java on the other, in
processes that never meet. Both pin the same literal; a drifted domain string would otherwise make every real
store read as `MISMATCH`, which looks exactly like a seller signed into the wrong account.

## 8-A. Phase B — the live run (`apr-cp-aside-acq-128151` / `wt-0d19d3c6`)

**Two marketplace reads, both inside the approved cap of two.** Four presses happened; the first two never
reached Coupang (see §8-B), so only two opened a tab.

| | press 3 (16:59) | press 4 (17:02) |
|---|---|---|
| ticket | own single-use `acquisitionRef` | own single-use `acquisitionRef` |
| provider | `ASIDE`, `coupang-wing-review-read/1` | same |
| identity | **MATCH** | **MATCH** |
| read | `OK`, **10 rows**, `excludedColumns 1`, `rolesResolved 5`, pager resolved | `OK`, 10 rows, same |
| duration / LLM | 3,475 ms / **`llmCalls 0`** | 3,949 ms / **`llmCalls 0`** |
| walk | fresh 9 · known 1 · `PAGE_LIMIT_REACHED` · **pages 1** | identical |
| handoff | **HTTP 500** (§8-B defect 2) | **ok** — received 9 · **stored 0** · skipped 9 · failed 0 |
| marketplace clicks | **0** | **0** |

**Dedup is proven by the pair, and the proof is stronger than a replay would have been.** Press 3's ingest
committed 9 rows before the 500; press 4 re-read the same page and the ingestion spine skipped **9 of 9**
with 0 stored and 0 duplicates created — content-hash identity (`ReviewDedupKey` v2) holding against rows
inserted minutes earlier by a different run. Measured in the DB: REAL Coupang reviews **23 → 32 → 32**.

**Review Core reads them.** `GET /api/reviews/recent` returns today's acquisition at the top of the org's
review list — `COUPANG · ★3 · 2026-09-12 · 컵수거함 당겨바일체형 블랙` — with the product binding resolved by
the same canonicalizer the seated path uses. `reply-work` is **0**, which is correct and not a gap: WING
offers sellers no reply, so D8 means there is no reply work to have. Attention items **0** is likewise the
triage contract behaving — the nine are ★3/★4/★5 with no body, and `3★ 무조치 → 확인 필요 아님` is a
tie-breaker the contract states.

**Sync jobs:** two `SELLER_CENTER_READ` rows, `success_rows` 9 and 0 — the provenance the CollectionMethod
was already built to carry. No new method, no new column.

**File lifecycle: not applicable, and that is the finding.** WING has no export, so this lane never produces
a file. `~/Downloads` matched 0, the helper home holds no artifact, the repo holds none. NAVER's
quarantine/TTL question (PD-5) does not arise here at all.

## 8-B. Two defects the run found, both older than this package

Neither is in the Aside code. `git diff de1838f6..HEAD` shows this track had touched neither file.

**1. The conversation could never start a WING read.** `frontend/src/lib/actionWindow/acquire/acquireRuntime.ts`
imported `ACTION_WINDOW_PROTOCOL_VERSION` from the `../contract` bridge — which is **v1** — while the
acquisition engine validates with the **v2** envelope validator, and `isActionWindowProtocolCompatible` is
exact equality. Measured on the wire: mint `200`, `START_RUN` sent, `accepted:false reason:"INVALID_ENVELOPE"`,
and the seller told 「판매자센터 화면을 준비하지 못했습니다」. Every sibling runtime (import · locate · issuance ·
reply) already imports v2 for exactly this reason and `replyRuntime` writes down why `contract.ts` stays v1 —
this one runtime missed it, which is precisely why the lane was recorded `LOCAL_PROVEN · LIVE_UNPROVEN`.
**Fix:** take the constant from v2, leave every type on the bridge (re-typing the view rippled into components
this defect has nothing to do with — tried, reverted). **Regression:** the real v2 validator over the envelope
the real runtime emits — the one assertion a fake transport cannot make. Verified red on the old code.

**2. A handoff that stored the rows and reported failure.** `IngestionService.stampAcquisition` runs a
`@Modifying(flushAutomatically = true)` update, and its caller `AgentReviewHandoffService.handOff` is
deliberately non-transactional so a late failure cannot roll back reviews already stored. With no transaction
the flush throws `InvalidDataAccessApiUsageException` → HTTP 500 — **after** the ingest committed. Press 3 is
what that looks like to a seller: nine reviews written, `stored=0` reported, rows left unstamped. **Fix:** the
stamp carries its own transaction — one bounded statement, the smallest scope that can be correct.
**Why no test caught it:** every ingestion test is a `@DataJpaTest`, which wraps each method in a transaction,
so the production condition is the one condition the suite cannot reproduce. The new guard asserts the
annotation and says plainly that it is weaker than a behavioural test, which would need a non-transactional
Spring context this suite does not have.

## 9. What is still open

- **`unitsWithRatingAria = 0`** was the number Phase A said to watch; ratings came through anyway
  (★3/★4/★5 all recorded), so `parseReviewRating` reading printed text as well as aria is what carried it.
- **`tabs` semantics are unresolved**: it was empty on a freshly launched Aside and filled by `openTab`, so
  whether it can see tabs the operator opened is unknown. Not needed by this design (the run opens its own
  tab) and therefore not chased.
- **Stale 상품평 vocabulary in the navigation layer** — the list page's column words are current; the menu word
  is not. Nothing depends on the menu word today.
- **PILOT_ALLOWED / GA POLICY_GATED is unchanged** (`docs/coupang_review_policy_gate_v1.md`). D1–D8 hold; this
  package stores nothing new and sends nothing to a model.

## 11. Corrections to my own earlier statements

Recorded as they happened rather than reworded to look satisfied.

1. **「모델 호출 0」 in the Phase B manifest was wrong.** I based it on triage and self-pilot being off and
   overlooked that the product's own press arrives through a **conversation turn**, which plans with the LLM.
   Measured: **2 `agent_plan` calls** (in 6,796 / out 348 and 333, reasoning 0) — the operator's own typed
   sentence plus the static tool catalogue, no seller row. **0** draft, **0** judge, **0** triage, and
   **`llmCalls 0` inside both acquisition executions**. The acquisition is deterministic; the doorway to it is
   not, and the manifest should have said so.
2. **Four presses, not two.** Two were refused by defect 1 before any tab opened (marketplace untouched);
   press 3 read and hit defect 2; press 4 is the clean run. Marketplace reads: **2**, the approved cap.
3. **The first live ingest arrived through a failed run.** The nine rows exist because press 3's ingest
   committed before the 500. They are real, correctly deduped against afterwards, and **unstamped** — as is
   every earlier Coupang batch on this deployment, because the stamp has never once succeeded here.
4. **The transaction fix is not live-proven.** Press 4 inserted nothing, so `stampAcquisition` short-circuited
   on an empty id list and the fixed path never ran against a real insert. It is compile- and guard-verified
   only; the next run that stores a row is what proves it.

## 10. Product decisions raised (not taken)

1. **Deterministic pagination.** The PoC reads one page and clicks nothing. Turning pages under an Aside run
   would be the first time SellerOps presses a Coupang control, and the seated path's own docblocks and the
   2026-08-15 evidence row both state the opposite property. Raised, not taken.
2. **The digest's enumerability.** Accepted for a comparison that never leaves the machine pair. If the
   expectation is ever exposed more widely, it needs a server-held salt.
3. **Nine of nine reviews were textless.** The body role resolved and the canonicalizer kept them as
   rating-only. This store's August batch was also mostly textless (19 of 23, average body 5.7 characters), so
   this is consistent with the store rather than with a body-read regression — **but this run did not prove
   the distinction**, and proving it costs another read.
4. **Demo Org now carries nine more REAL Coupang reviews.** Approved in advance, and named again here because
   the canonical demo org is where other packages' evidence lives.

