# Coupang ASIDE — Operator-Run Incremental Lane (M5) v1

**What this lane is.** The seller presses 지금 동기화, a deterministic executor opens the Coupang WING 상품평
list, reads **one page**, and hands it to the ingestion the product already had. It is bounded, it is started
by a person, and it writes nothing to the marketplace.

**What this lane is not, and will not become without a separate decision.** It is not scheduled, not
unattended, not the production default, and not a backfill. `LOCAL_HELPER` remains the default and the
fallback; `ASIDE` is selected by explicit configuration on one machine.

| | |
|---|---|
| status | **operator-run incremental lane — READY** (M3 built it, M4 measured it, M5 finishes it as a product) |
| default | `LOCAL_HELPER` (unchanged) |
| selection | `REVIEWNARY_EXECUTION_PROVIDER=ASIDE`, explicit, per machine |
| unattended / scheduled | **NOT APPROVED** |
| pagination | **not implemented** — §3 |
| NAVER | `DEFERRED_BY_ENVIRONMENT`, untouched |
| Cafe24 | unchanged — it has a working API and this lane is not for it |

---

## 1. The seller's flow, end to end

1. The seller says 쿠팡 리뷰 동기화 (or presses the control the acquisition artifact draws).
2. A **single-use `acquisitionRef`** is minted for that press. One press, one ref, one run — a second read
   needs a second press.
3. The helper activates the `acquire/coupang` carrier and reports which executor is bound.
4. `ASIDE` opens one tab, and in one `aside repl` program reads, in this order: **auth → store identity →
   rows**. It closes the tab in `finally`.
5. The store is asserted against the fingerprint of the sealed `vendor_id`. **Anything but `MATCH` drops the
   rows unread** — they arrive in the same answer as the identity, and an unproven store is not read.
6. The rows go through the existing canonicalizer to the existing `POST /api/agent/review-handoff`, the
   existing dedup, the existing Review Core.
7. The run is recorded as a `sync_jobs` row, and the seller sees it in 수집 이력 with a coverage sentence (§2).

**Zero marketplace actions in the whole of it**: no click, no keystroke, no download, no write. The seam the
driver implements has no verb for turning a page, so the run cannot walk the list even by accident.

---

## 2. Coverage and freshness — what one bounded read can honestly say

A bounded read always stops early. Until now it said so in the agent's own word — `PAGE_LIMIT_REACHED`,
rendered to the seller **in red, as if the read had failed**. It had not: it did exactly what it was bounded
to do. `ReviewCoverageSignal` replaces that token with a claim the row can actually support.

| signal | derived from | the sentence the seller reads |
|---|---|---|
| `REACHED_KNOWN_GROUND` | `skipped > 0` — the read ran into reviews already stored; **or** no stop reason at all, which on this path means the pager said this was the last page | 읽지 못하고 남은 리뷰가 있다는 신호는 이번 수집에서 없었습니다. |
| `BACKLOG_POSSIBLE` | the walk stopped at a bound of its own (`PAGE_LIMIT_REACHED` / `REVIEW_LIMIT_REACHED`) **and every row it read was new** | 읽기 한도에서 멈췄고, 읽은 리뷰가 모두 새 리뷰였습니다. 더 이전 리뷰가 남아 있을 수 있습니다. |
| `UNDETERMINED` | anything else — an unreadable page, a pager that would not resolve, the operator ending the walk, a run that received nothing | 이번 수집만으로는 남은 리뷰가 있는지 알 수 없습니다. |

**Three things this deliberately does not do.**

- **It never says the collection is complete.** `REACHED_KNOWN_GROUND` means *nothing in this run indicated
  reviews were left behind it*. A seller who has never backfilled can see it on every incremental run while
  four fifths of their history has never been read. "전체 리뷰 수집 완료" is a claim no bounded read can make,
  and a test asserts the screen does not print anything of that shape.
- **It answers nothing for other kinds of run.** The signal is `null` unless the run was a screen read; an API
  pull and an upload have their own completeness semantics, and a coverage sentence on such a row would be
  invented. Null is not a fourth value.
- **It is not a new record.** Every input is already on the run row — the method, the three counts, and the
  stop reason the handoff writes into `error_message` when a walk did not complete. No column, no table, no
  migration. It is a pure function of one row, computed where the row is read.

One distinction the derivation is careful about: **the operator saying they were done is not the list saying
it ended.** `OPERATOR_FINISHED` is `UNDETERMINED`, not known ground.

---

## 3. What the seller sees, and the two things they do not

Reused surfaces, no new screen:

- **last successful sync** — 채널 연결 and the first-source summary, unchanged.
- **success / failure** — the status chip on each 수집 이력 row, unchanged.
- **coverage / freshness** — the sentence above, new, on screen-read rows only.
- **the trigger** — previously the raw token `ACTION_WINDOW`; now **화면에서 실행**. An unmapped trigger now
  renders as nothing at all rather than as its own token: an internal word on a seller screen is the defect
  that map exists to prevent, and a missing chip costs less than a raw enum.

**Not on a seller screen, and reported rather than smuggled in:**

- **The provider.** It is named in the helper's boot summary (`reviewAcquisitionProvider`) and again in every
  run's log line. It is *not* on a seller screen, because the two places it could go are both wrong for it:
  `/bridge/health` is unauthenticated and its own contract says it carries no connection detail, and the
  Action Window run view is a shared v2 contract. Putting it in front of a seller is a product decision with
  a wire change behind it, and M5 does not take it.
  **RESOLVED (M6), the other way:** the product decision was taken and it was *not* to surface it —
  `execution_strategy_v1.md` §5. Technical provider names stay off ordinary seller screens and stay
  identifiable to whoever operates the machine.
- **A read that failed before it stored anything.** `AUTH_REQUIRED`, `STORE_MISMATCH`, `STORE_UNRESOLVED`,
  `EXECUTOR_UNAVAILABLE` are shown **live**, in the window, in seller words — but they produce no `sync_jobs`
  row, because nothing was collected. So after the window closes there is no record of why a press did
  nothing. That is a real gap; closing it means a failure record, which is a new kind of row and not this
  package's to invent.
  **RESOLVED (M6):** `execution_strategy_v1.md` §6. It did not need a new kind of row — an ordinary
  `sync_jobs` row with the same method and trigger, `FAILED`, zero counts, and the closed failure word where
  this path already records its named ending. No migration. The one failure it still cannot record is an
  unresolved binding, because the account slot is what failed to resolve.

---

## 4. Pagination and backlog — still not implemented, and why

Measured in M4 and unchanged here: this seller's list carries more than one page behind the one that is read
(the acquisition reader saw page 1 of 3; the Phase A census read the highest page number as 5 — the two
instruments disagree and neither was re-measured here). One page of ten covers roughly **19 days** at this
store's rate, and the one observed interval between sittings was **20**, which is how M4 found three days that
neither run observed.

The recommendation does not change:

1. **Do not add a page-turn verb.** The absence of one from `ReviewAcquisitionProbeDriver` is what guarantees
   this agent cannot walk a marketplace on its own, and the seam is shared — adding it for Aside would remove
   the guarantee from every lane at once, including ones an operator is standing at.
2. **Backlog belongs to the operator-attended lane.** `LOCAL_HELPER` already walks up to 100 pages, with the
   operator turning each one. A one-time backfill is exactly the job that should require a person.
3. **Incremental belongs here**, run often enough. The measured margin is ~19 days.

`BACKLOG_POSSIBLE` (§2) is what makes the limitation legible instead of silent: a full page of entirely new
reviews now says so on the seller's own screen.

---

## 5. The invariants this lane is held to, and what holds them

| invariant | held by |
|---|---|
| the envelope version matches the engine that validates it | `protocolVersion.source.test.ts` (per-sender declaration) + `acquireRuntime.envelope.test.ts` (real v2 validator) |
| the provenance stamp survives a non-transactional caller | `StampAcquisitionHandoffTest` (behavioural, committing, no ambient transaction) + `StampAcquisitionTransactionTest` (the annotation cannot be removed silently) |
| "textless" means what storage means by it | `coupang-review-body-evidence.test.ts` — the counter and the canonicalizer must return the same number |
| an unproven store is not read | `aside-review-acquisition-driver.test.ts` — rows in hand on `MISMATCH`/`UNRESOLVED`, dropped unread |
| zero marketplace action, and no LLM | `aside-guard.test.ts` — `aside repl` and `--version` only, `exec` (the model-driven surface) appears nowhere, the runtime holds no DOM API name, every `evaluate` argument is a repository-authored script; and the read's own log line carries `llmCalls: 0` |
| ASIDE never quietly becomes LOCAL_HELPER | `coupang-acquisition-provider-selection.test.ts` — every driver the carrier hands out is the deterministic one, the default with no environment is the seated one, an unknown provider refuses to boot |

---

## 5-A. Rendered against the real history, not a fixture

The 12 screen-read runs this deployment holds were classified by the derivation and drawn on the seller's own
채널 상세 (local stack, real DB, no marketplace, 1440/1366/1152):

- **6 runs → `REACHED_KNOWN_GROUND`**, and **1 run → `BACKLOG_POSSIBLE`** — and the one is
  `2026-09-12 16:59`, the first Aside ingest, whose nine rows were all new. That is precisely the run M4
  found a three-day unobserved gap behind. The signal picked it out of twelve without being told.
- **raw `ACTION_WINDOW` 0 · raw `PAGE_LIMIT_REACHED` 0 · completion claim 0**, at all three widths.
- 7 rows carry **화면에서 실행**; console errors 0; off-host requests 0; no horizontal scroll.

---

## 6. Live proof status

- **Read, repeat, idempotency, identity, LLM-zero** — `LIVE PASS`, 5/5 (M4, `apr-cp-aside-m4-f767f6`).
- **M5 itself performed no marketplace read.** Everything in this document was built and checked offline or
  against the local database; the one screen render in §5-A opened no marketplace and the helper was never
  started for it.
- **The stamp fix on a marketplace-sourced NEW ingest — `OUTSTANDING_NON_BLOCKING_EVIDENCE`.**

### 6.1 What is outstanding, and why it stays outstanding

The transaction fix is proven twice: **offline at the production condition** (`StampAcquisitionHandoffTest` —
a committing, non-transactional Spring context; removing the annotation reproduces the seller's own
exception) and **live against the deployed backend** (real HTTP handoff on a disposable org: 200, `stored 2`,
both rows stamped). What has never been observed is the same fixed path ingesting rows that **came off the
marketplace and were new**, because every page read since the fix has been a page this organisation already
held.

A manifest for one more bounded page-1 read (`apr-cp-aside-m5-newrow`) was prepared and **displayed, and the
operator declined it** — correctly, on the odds: this store produces roughly one review every two days, so a
read taken to find out would almost certainly have re-read the same nine rows and spent a marketplace request
to learn nothing.

**It is closed unapproved and must not be reused.** The evidence is deferred to the next approved run that
happens to meet new reviews, and the three ways of manufacturing that condition stay forbidden: changing the
seller's own list filter on their behalf, pagination, and deleting stored rows so they arrive again as new.

**It does not block adoption.** The defect it would exercise is fixed, tested at the condition that produced
it, and exercised end to end against the deployed backend; what remains unproven is the marketplace's half of
a path whose other half is proven, and no part of the lane depends on it being proven to be safe to run.

---

## 7. Adoption

**Merge-ready as an operator-run lane.** The production default is untouched, the provider is opt-in per
machine, and every claim this document makes is held by a test named in §5.

**Not ready, and not proposed:** unattended or scheduled execution, ASIDE as a default, backlog through this
lane, and any marketplace write. Those are separate decisions and none of them is asked here.

**Marketplace cost of this package: 0.** No read, no click, no write, no download — and one prepared manifest
deliberately not spent.
