# Coupang Aside PoC Hardening (M4) v1

**Status — DONE.** Offline proofs landed first; five live bounded reads and one deployed-backend ingest
proof followed under approval `apr-cp-aside-m4-f767f6` (2026-09-12). §7 is the live record. M3-C proved the spine once
(`docs/coupang_aside_review_acquisition_poc_v1.md`): one Coupang WING page read by a deterministic executor,
handed to the existing ingestion, deduped, visible in Review Core, with 0 marketplace clicks, 0 writes, 0 LLM
calls inside the execution. M4 does not extend that reach. It asks whether the three things M3 left standing —
two defects fixed but under-proven, one open question about review bodies, and one run's worth of evidence —
hold up when they are pressed on.

Nothing here adds a capability. No pagination, no scheduler, no marketplace write, no new parser, no change to
the provider seam or to the production default (`LOCAL_HELPER`). NAVER remains `DEFERRED_BY_ENVIRONMENT` and
untouched: tab 0 · click 0 · login 0 · observation 0.

---

## 1. Defect 1 — the envelope version. Proven, and now fenced as a class

M3 found that `acquireRuntime` stamped the **v1** `protocolVersion` while the acquisition engine validates with
**v2**, where `isActionWindowProtocolCompatible` is exact equality. Every WING read a seller could press was
refused `INVALID_ENVELOPE` before it reached a browser, and the unit tests stayed green because they judged the
envelope against fakes. The fix was one import.

`acquireRuntime.envelope.test.ts` (M3) proves that lane's envelope against the real v2 validator. What M4 adds
is the fence that generalizes it, because the next lane written can make the identical mistake and no
behavioural test it does not yet have will notice: **`protocolVersion.source.test.ts` declares, per sender,
which contract version its receiving endpoint validates with, and reads the imports to check it.**

| sender | receiving endpoint | version |
|---|---|---|
| `bridgeAdapter.ts` | `bridge/action-window-endpoint.ts` | **v1** |
| `acquire/acquireRuntime.ts` | `bridge/review-acquisition-endpoint.ts` | v2 |
| `locate/locateRuntime.ts` | `bridge/review-locate-endpoint.ts` | v2 |
| `reply/replyRuntime.ts` | `bridge/reply-submission-endpoint.ts` | v2 |
| `import/importRuntime.ts` | `bridge/initial-import-endpoint.ts` | v2 |
| `issuance/issuanceRuntime.ts` | `bridge/api-issuance-endpoint.ts` | v2 |

Two versions are live at once **on purpose**, so the test cannot simply demand v2 everywhere: the generic lane's
endpoint really does speak v1, and `bridgeAdapter` taking the constant from the shared `contract.ts` bridge —
which re-exports v1 — is correct there and only there. The fence resolves the bridge's own version from its
source rather than trusting its name, and a sender that appears without being declared fails the first
assertion. Saying which engine you speak to is the point.

It reads source rather than runtime deliberately: what went wrong was an **import**, and an import is a fact
about the text.

**Falsified before being kept.** With `acquireRuntime`'s import reverted to the pre-fix `../contract`, the two
envelope tests and two of the three fence assertions go red (2026-09-12); restored, all five pass.

---

## 2. Defect 2 — the stamp that flushed with no transaction. Now proven, not asserted

`IngestionService.stampAcquisition` runs a `@Modifying(flushAutomatically = true)` update from a caller that is
deliberately **not** transactional, so the flush has nowhere to find a transaction unless the method carries its
own. On 2026-09-12 it did not, and the first live WING read of this branch stored 9 reviews and then answered
the seller with HTTP 500 and `stored=0` — rows that were in fact written, and left unstamped.

M3 shipped the fix with a **structural** test: the annotation is present, and the caller is not transactional.
That test said plainly that it was weaker than asserting the behaviour and that the suite had no context to
assert it in. M4 built the context.

`StampAcquisitionHandoffTest` is a `@SpringBootTest` on its own in-memory database, **not** `@Transactional`, that
calls the real `AgentReviewHandoffService.handOff` with fresh rows and asserts the live symptom's exact inverse:
the handoff returns, reports what it stored, and every stored row carries the run that acquired it.

**Why the green suite could not see this, in two independent ways — either alone is enough.**

1. `@DataJpaTest` wraps every method in a transaction, so the flush always finds one. The production condition —
   no transaction at all — is the single condition that slice cannot reproduce.
2. `AgentReviewHandoffServiceTest` hand-`new`s `IngestionService`. A hand-built instance has no Spring proxy, so
   `@Transactional` on it does nothing whatsoever, and a behavioural assertion written there would pass with the
   annotation deleted.

**Falsified before being kept.** With the annotation removed, both cases fail with the live exception, word for
word:

```
org.springframework.dao.InvalidDataAccessApiUsageException:
  No EntityManager with actual transaction available for current thread - cannot reliably process 'flush' call
```

That is the 500 the seller saw, reproduced in a test that runs in CI. Restored, both pass. The class also
commits — its own database exists for that reason — which is why its fixtures are found-or-created and its reads
are scoped to their own org: the rows outlive the method, and that is the property under test rather than an
inconvenience.

**What remains unproven and is not pretended otherwise.** No live run has yet exercised the fixed path with rows
that were genuinely new, because press 4 (the run after the fix) re-read a page it had already stored and
inserted nothing. §6 is the plan for that, and it is the only part of M4 that needs a marketplace.

---

## 3. Review bodies — what the evidence says, and the instrument that can settle it

M3 reported that all 9 acquired reviews were textless and that it could not tell a store property from a read
regression. Four independent pieces of evidence now bear on it, and they agree.

**(a) This store's own record, by lane.** Every `REAL` Coupang review this deployment holds:

| ingested | lane | rows | textless |
|---|---|---|---|
| 2026-06-15 | file upload | 14 | 0 |
| 2026-08-23 | `LOCAL_HELPER` screen read | 23 | **19** |
| 2026-09-12 | `ASIDE` screen read | 9 | **9** |

The August sitting is the load-bearing row. It read this same list with this same script through the helper lane
and came back with **4 bodies out of 23**, interspersed by date with the textless ones — two rows written on
2026-08-20, one with 37 characters and one with none. A reader that cannot read bodies does not do that.

**(b) The two lanes carry the same instrument.** Both `coupang-wing-review-reader-driver.ts` and the Aside plan
call `buildReviewRowReadScript()` with no arguments, and `coupang-review-body-evidence.test.ts` now asserts the
two **strings** are equal. The Aside lane cannot read bodies differently from the lane that read four of them,
because it is not a different reader.

**(c) 0 of 9 is unremarkable at this store's rate.** At the August rate of 4 in 23, the chance that nine
consecutive reviews are all textless is ≈ 0.83⁹ ≈ **18%**. This is not a result that needs an explanation.

**(d) The backend already knew the shape of this seller.** `ReviewDedupKey.V3` exists because the first live
Coupang backfill found 86% of this seller's 상품평 were rating-only. v3 applies per row and only to textless
rows, and the DB confirms the correlation is exact: every textless row is v3, every row with a body is v2.

**Verdict: `STORE_PROPERTY`, with no evidence of a read regression — and one thing still unobserved.** No body
has yet travelled through the Aside lane live. The chain that would carry it is proven offline row by row
(`coupang-review-row-read.test.ts` runs the real generated script against a fake WING table and gets
`textless: false` with the body, and `textless: true, body: ""` for a placeholder row), but "proven offline" and
"observed live" are different claims and the second one is not being made.

**So M4 adds the instrument that can contradict the verdict at zero marketplace cost.** The reading already
carried the answer and nobody was counting it: `bodyExpandable` is the body cell's **own offer to show more**, so
a row that is textless *and* expandable is a body the list is hiding from the reader. `bodyEvidenceOf` counts
four things — `textless`, `expandable`, `truncated`, and `textlessExpandable` — and the Aside read line now
reports them. Counts only, never text (policy gate D3/D4).

`textlessExpandable` is the only number there that can accuse the reader, and it is why the function exists. If
a live run reports it above zero, this section is wrong and says so by itself.

---

## 4. Pagination — measured, and recommended against for this lane

The Aside lane runs with `ASIDE_ACQUISITION_MAX_PAGES = 1`, so every run reads page 1 and stops on
`PAGE_LIMIT_REACHED` with `complete = false`. What that costs is now measured rather than argued.

**What the list is.** The Phase A census read this seller's 상품평 list as a numeric pager with
`highestPagerNumber = 5`, **0 date inputs** and 4 selects. Ten rows per page, so roughly **50 reviews in about
5 pages**, and a bounded read reaches the newest fifth of them.

**What one page covers, in days — and the gap the two sittings already left.** The August read's newest stored
row was written 2026-08-23. The September page held **ten rows whose oldest was written 2026-08-27**. So the
page did not reach known ground: **2026-08-24 through 08-26 was never observed by either run**, and if this
seller received a review in those three days it is not in this deployment and nothing says it is missing. At the
measured rate — 9 distinct reviews across the 17 days the page did cover, ≈ 0.53/day — a page of ten covers
about **19 days**, and the interval between the two sittings was **20**. The bound was reached on the first
interval anyone tried.

This is the fail-closed side working as designed (the run reports `complete = false` and the sync job lands
`PARTIAL`), and it is also the precise shape of what one page costs.

**A correction to how the live line reads.** `fresh: 9, known: 1` does **not** mean one row was already stored.
`knownKeys` has no external seeder anywhere in the collector — the walk seeds it from the rows it reads — so the
known row was a duplicate **of another row on the same page**: two reviews the screen prints identically, which
is the recorded v1 limitation (`coupang_review_policy_gate_v1.md` §9.2: two of the operator's own ten reviews
were identical in every number the page prints). It compounds with textlessness, because a textless row has no
body to separate it. On this page it cost one review in ten.

**Need.** Real but bounded, and it splits in two:

- **Backlog** — a seller's first use reaches 1 page of 5 and the run correctly reports itself incomplete. Four
  fifths of their history never arrives.
- **Incremental** — after a backlog exists, one page keeps up at this store provided the read runs at least
  every two weeks. At three weeks it starts losing reviews, and it would still say so.

**Risk of taking it, which is why the recommendation is not to.**

1. **The seam has no verb for a page turn, and that absence is the guarantee.**
   `ReviewAcquisitionProbeDriver` has four methods and none of them turns a page; the operator turns it and the
   walk re-reads. Adding a page-turn verb for Aside adds it to the **shared** seam, so the guarantee that this
   agent cannot walk a marketplace on its own would be gone in every lane at once, including the ones an
   operator is standing at.
2. **It converts 0 marketplace clicks into N unattended clicks.** The current run's strongest safety property is
   an integer, and it is zero. A pager click is the "arbitrary crawling / unattended walk" the brief forbids,
   and the caps (`MAX_ACQUISITION_PAGES` 100, `MAX_ACQUISITION_REVIEWS` 500) would become the only bound.
3. **The gain is smaller than it looks.** Pages 2–3 of today's list are reviews this org already holds; only
   pages 4–5 are new, and they are one-time backlog rather than an ongoing need.

**Recommendation — do not implement deterministic pagination in the Aside lane.** Three cheaper things answer
the same needs without a new verb or a click:

- **Backlog, once:** run it through the existing `LOCAL_HELPER` lane, where the operator turns the pages with
  their own clicks and the walk already supports up to 100 of them. The capability exists and is proven; what it
  needs is an operator, which is exactly the right requirement for a one-time backfill.
- **Incremental:** run the bounded read more often. The measured margin at this store is **~19 days**, and the
  one observed interval of 20 days already overran it.
- **Honesty, which is the cheapest of the three and the one this document would take first:** the handoff
  already knows whether a page overlapped stored ground — `skipped > 0` means it did, and the 2026-09-12 run
  reported `skipped 0` on its first press. A full page with **nothing** skipped is precisely a page that may
  have had more behind it, and today nothing distinguishes it from a page that comfortably reached known ground.
  The two runs above differ in exactly that way and the record does not show it. Surfacing the distinction needs
  no click, no verb and no new read — it is a derivation from counts the handoff already returns. It is **not
  implemented here** (M4 implements no acquisition behaviour), and it is the M5 recommendation.

---

## 5. Suites

| suite | files | tests | failed |
|---|---|---|---|
| collector | 405 | 9,601 | 0 |
| frontend | 238 | 2,784 | 0 |
| backend | — | 3,911 | 0 |

New this package: `StampAcquisitionHandoffTest` (2), `protocolVersion.source.test.ts` (3),
`coupang-review-body-evidence.test.ts` (9 — two of them added after §7.2), plus one case in
`aside-review-acquisition-driver.test.ts`. No test was rewritten and no safety test was weakened.

---

## 6. What still needs a marketplace, and what it would settle

Three questions cannot be answered offline, and all three are answered by repeating the same bounded read that
M3 already ran — same page, same cap, same zero clicks.

1. **Repetition.** Success rate, wall-clock spread, `stored / skipped / failed`, identity verdict, LLM calls in
   execution, and wrong-or-ambiguous actions over N identical runs. M3 has n = 2 successful reads; a PoC that
   ran twice has not been measured.
2. **The body verdict, live.** Every run now reports `textless / bodyExpandable / textlessExpandable`. One
   `textlessExpandable > 0` overturns §3.
3. **The stamp fix at the production condition, live.** It needs a run in which rows are genuinely new. Today's
   page 1 is entirely stored, so it requires either a review arriving during the sitting (this store averages
   ~0.6/day) or the **operator** changing their own list's filter so page 1 shows rows this org has not yet
   collected — the NAVER precedent, where the seller sets the window and we only read what is shown. We do not
   touch the filter, and we do not turn a page.

Two routes were considered for (3) and rejected: deleting the 9 PoC rows from the Demo Org to force re-insertion
(a mutation of the canonical org with derived state hanging off those rows, to prove something the offline test
already proves at the same condition), and reaching pages 4–5 (pagination, §4).

---

## 7. The live sitting — `apr-cp-aside-m4-f767f6`, 2026-09-12

Five presses of 지금 동기화, each its own single-use `acquisitionRef`, each one page. **0 marketplace clicks,
0 downloads, 0 marketplace writes, 0 LLM calls inside any execution**, and the helper log holds no review text.
Background producers were forced off for the sitting (scheduler, self-pilot, proactive), and NAVER was not
reached by anything: 0 NAVER lines in the backend log, NAVER review count unchanged at 4,543.

### 7.1 Repetition — five runs, and they are the same run five times

| # | verdict | reason | rows | textless | expandable | textless+expandable | roles | excluded | pager | LLM | read ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | MATCH | OK | 10 | *(instrument defective — §7.2)* | | | 5 | 1 | — | 0 | 4,155 |
| 2 | MATCH | OK | 10 | 10 | 0 | **0** | 5 | 1 | 1 of 3 | 0 | 4,114 |
| 3 | MATCH | OK | 10 | 10 | 0 | **0** | 5 | 1 | 1 of 3 | 0 | 3,618 |
| 4 | MATCH | OK | 10 | 10 | 0 | **0** | 5 | 1 | 1 of 3 | 0 | 3,363 |
| 5 | MATCH | OK | 10 | 10 | 0 | **0** | 5 | 1 | 1 of 3 | 0 | 3,993 |

Every run's walk: `rows 10 · fresh 9 · known 1 · PAGE_LIMIT_REACHED · pages 1`. Every run's handoff:
`received 9 · stored 0 · skipped 9 · failed 0`.

- **success 5/5** · **identity mismatch 0** · **wrong or ambiguous action 0** · **LLM in execution 0**
- read wall-clock **3,363–4,155 ms, mean 3,849** (n = 5; M3's two reads were 3,475 and 3,949, so seven
  consecutive reads now sit inside one second of spread)
- **idempotency held on every one of them**: five re-reads of a stored page stored nothing and said so.

The `known: 1` is the same one row every time, and §4 explains what it is — an intra-page pair the screen
prints identically, not a row already in the database.

### 7.2 The instrument was wrong, and the first live run is what caught it

Run 1 reported **`textless: 0`** on a page whose handoff then skipped nine rows as textless duplicates. Both
statements cannot be true. `bodyEvidenceOf` was testing the raw cell, and WING does not leave a rating-only
cell empty — it prints `등록된 내용이 없습니다.` there, which is precisely the discovery `EMPTY_BODY_PLACEHOLDERS`
exists to record. A second, looser definition of "empty" standing beside the one that decides storage is how a
diagnostic ends up contradicting the ingest it was written to explain.

Fixed to reuse `stripExpanderChrome` + `isEmptyReviewBody` — the canonicalizer's own two transforms — with two
regression cases, one of which asserts the counter and the canonicalizer return the same number for the same
page. Runs 2–5 used the corrected instrument.

This is written down rather than quietly amended because it is the second time in two milestones that a thing
which only runs live was wrong in a way no green suite could see, and because the defect was in the very
instrument that was supposed to keep §3 honest.

### 7.3 Bodies — the verdict survived the instrument that could have overturned it

**`textless 10 · bodyExpandable 0 · textlessExpandable 0`, four runs out of four.**

Not one cell on this page offers to show more than it prints. The list is not hiding bodies from the reader;
there are no bodies. §3's `STORE_PROPERTY` verdict stands, and it now stands on a live measurement that was
free to contradict it — which is a different and better thing than standing on an argument.

### 7.4 The stamp fix, live on the deployed backend

Run 6 as written in the manifest — a marketplace-sourced ingest of genuinely new rows — **did not occur**: no
review arrived at this store during the sitting (all five pages identical, newest review unchanged), and the
operator did not widen the WING filter. That condition was not forced and is not reported as met.

What was proven instead, without a marketplace and without touching the Demo Org: the **running backend**, over
real HTTP, on a genuinely new ingest.

```
POST /api/agent/review-handoff   → HTTP 200
{"received":2,"stored":2,"skipped":0,"failed":0,"complete":false,"importId":"57861058-…"}

body_len | rating | dedup v | stamped | acquisition_sync_job_id
      11 |      5 |       2 | t       | 57861058-…
       0 |      3 |       3 | t       | 57861058-…
```

Its historical counterpart is exact: the same endpoint, the same service, rows inserted — and on 2026-09-12 an
HTTP 500 with `stored: 0` and no stamp. Now 200, the count reported, both rows stamped, and the two rows keyed
on the two different formulas (v2 with a body, v3 textless) that a real page mixes.

**What this proof is and is not.** It ran on a **disposable org** created through the product's own signup, with
a seller-account row inserted by hand and synthetic bodies — so what it establishes is that the ingest-and-stamp
path in the *deployed* backend is correct at the production transaction condition, not that a marketplace-sourced
new ingest has been observed end to end. The org was deleted afterwards (12 scoped rows, single transaction).
The cleanup tool refused it at first because the hand-inserted account read as `CONNECTED`; that fence is right,
and the account was demoted to the status it should have carried before the org was removed.

### 7.5 The Demo Org, before and after

| | before | after |
|---|---|---|
| COUPANG `REAL` reviews | 46 | **46** |
| stamped | 0 | **0** |
| newest review | 2026-09-12 09:00 | **unchanged** |
| `SELLER_CENTER_READ` sync jobs | 7 | 12 (+1 per run) |
| NAVER reviews | 4,543 | **4,543** |

Five runs, and the only thing they wrote to the seller's org is five honest records of having read a page whose
contents it already had.

### 7.6 One measurement disagrees with a Phase A number, and it is not resolved

The acquisition reader saw the pager as **current 1, highest 3, next available** on every run. The Phase A census
recorded `highestPagerNumber 5` for the same list earlier the same day. They are different instruments reading
the same control, and this sitting did not determine which is right or whether the list's own state changed
between them. §4's recommendation does not depend on which it is — 1 of 3 and 1 of 5 are both "most of the list
is behind page 1" — but the number is reported as the disagreement it is rather than as a fact.
