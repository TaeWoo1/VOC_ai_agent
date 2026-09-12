# Coupang WING Review Acquisition over Aside — PoC v1

**Track:** Aside Acquisition — M3-C. **Baseline:** `reviewnary-pre-aside-v1` (`de1838f6`); M1+M2 at `1109e9ef`.
**Status:** **Phase A (read-only observation) — DONE.** **Phase B (one explicit run + ingest) — NOT RUN, awaiting
its own displayed manifest and grant.**

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
| collector | **403 files · 9,586 passed · 0 failed** (21 files / 160 skipped) |
| frontend | **236 files · 2,779 passed · 0 failed** |
| backend | **3,907 tests · 0 failed** (25 skipped) |
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

## 9. What is still open

- **Phase B has not run.** No ingest, no dedup proof, no Review Core proof, no live row count.
- **`unitsWithRatingAria = 0`** — the first counter to read in Phase B.
- **`tabs` semantics are unresolved**: it was empty on a freshly launched Aside and filled by `openTab`, so
  whether it can see tabs the operator opened is unknown. Not needed by this design (the run opens its own
  tab) and therefore not chased.
- **Stale 상품평 vocabulary in the navigation layer** — the list page's column words are current; the menu word
  is not. Nothing depends on the menu word today.
- **PILOT_ALLOWED / GA POLICY_GATED is unchanged** (`docs/coupang_review_policy_gate_v1.md`). D1–D8 hold; this
  package stores nothing new and sends nothing to a model.

## 10. Product decisions raised (not taken)

1. **Deterministic pagination.** The PoC reads one page and clicks nothing. Turning pages under an Aside run
   would be the first time SellerOps presses a Coupang control, and the seated path's own docblocks and the
   2026-08-15 evidence row both state the opposite property. Raised, not taken.
2. **The digest's enumerability.** Accepted for a comparison that never leaves the machine pair. If the
   expectation is ever exposed more widely, it needs a server-held salt.

