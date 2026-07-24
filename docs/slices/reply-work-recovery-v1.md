# Slice — Dismissed Reply-Work Recovery v1 (제외한 작업 + 복원)

> **Status:** IMPLEMENTED, offline. A review set aside from 내 답변 작업 (작업에서 제외) is no longer a
> one-way trapdoor: it can be found in a **제외한 작업** recovery list and put back (**복원**), at any
> age. Restore **deletes no history, mutates no draft or disposition, writes no outcome, and claims no
> completion.** One migration (V26), two endpoints, a generalized read predicate.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the 내 답변 작업 worklist)
- **Date:** 2026-07-24 · **Live contact:** none

---

## 1. Why — dismissal had no honest way back

The exit-clarity slice made 작업에서 제외 confirmed and explained, but the confirmation had to admit
"제외한 항목만 따로 모아 보는 화면은 아직 없어요." A review dismissed while RESPONSE_NEEDED (the common
case) had **no** existing re-entry: re-marking 대응 필요 is a no-op when the disposition is already
RESPONSE_NEEDED, and the only other automatic trigger is saving a new draft — which the seller may not
want to touch. An aged-out dismissed review could become permanently unreachable. This slice adds the
honest recovery path.

## 2. What changed

**Restore is its own append-only fact, not an un-dismiss.** The dismissal row is never deleted; a
restore row simply OUTRANKS it. `review_reply_work_restore` (V26) mirrors the dismissal table
field-for-field — each operator-owned reply-work fact is its own append-only table (triage / draft /
approval / outcome / dismissal, now restore).

**A shared, globally-monotonic event sequence arbitrates dismiss vs restore — not timestamps.**
Wall-clock times can tie (same tick) or skew. Both tables draw a `seq` from one DB sequence
(`reply_work_event_seq`), so the newest EXPLICIT action for a review is the one with the greatest seq,
a total order that decides same-timestamp cases deterministically. Verified directly on PostgreSQL 15
with three events sharing one instant: dismiss → SET_ASIDE, restore → ACTIVE, dismiss → SET_ASIDE,
each decided purely by seq. Production creates the sequence in V26; the offline H2 test schema creates
the same object via a test-only `schema.sql` (Flyway is disabled under test; a plain `seq` column is
not a Hibernate-generated identity, so the entity mapping cannot emit it).

**Automatic re-entry is preserved, unchanged.** `NOT_DISMISSED_PREDICATE` gains ONE disjunct — a
restore whose seq exceeds the review's greatest dismissal seq. The two automatic triggers (a genuinely
newer RESPONSE_NEEDED decision or a newer draft revision, both timestamp-based against the latest
dismissal) are untouched and independent.

**The 제외한 작업 read reuses existing state.** `findDismissedReplyWorkByChannel` is the negation of the
generalized predicate: committed, not reported, and currently set aside. Not window-scoped, so an
aged-out set-aside review stays reachable. Returned as a `Slice` (size+1, no count query) ordered
deterministically by latest `dismissed_at` DESC then `r.id` DESC, so it **pages with 더 보기 / hasMore
rather than hiding older items behind a hard cap**.

**Endpoints.** `POST …/reply-work/restore` (idempotent on `commandId`, org/actor from the token,
channel-hosting authorized) mirrors dismiss; `GET …/reply-work/dismissed?page&size` serves the paged
recovery list with the same coverage/false-calm guard.

**Frontend.** A collapsible, **lazy** 제외한 작업 section in `MyReplyWork` (no read until opened) lists
set-aside reviews (read-only triage), each with a **복원** control that restores + drops the row and
refetches the to-do so the review reappears there; **더 보기** appends pages. The 작업에서 제외
confirmation now points to this recovery path instead of admitting there is none.

## 3. What is NOT in this slice

- **No history deletion** — dismissal rows are never removed; restore is a new append that outranks.
- **No draft/disposition mutation, no outcome, no completion claim** — restore only moves the review
  back onto the to-do.
- **No carrier / Bridge / automation / live contact.** No live run.

## 4. Verification

| | before | after |
|---|---|---|
| backend | 1524 | **1541** |
| frontend | 820 | **826** |
| collector | untouched | untouched |

Backend + frontend typechecks clean. **Disposable PostgreSQL 15:** all 26 migrations apply; V26 shapes
correct (sequence, `dismissal.seq` NOT NULL, restore table + uq/idx); idempotency uq enforced;
seq-arbitration proven on tied timestamps.

**Backend** (`ReplyWorkWorklistTest` +14, `OperatorReplyWorkRestoreControllerTest` +3): recovery-list
membership (only currently-set-aside committed, not-reported), restore re-entry, restore idempotency
(one row, replay), same-timestamp seq arbitration, repeated dismiss/restore sequences, automatic
re-entry still works alongside restore, aged-out reachability, 더 보기 pagination/hasMore, most-recent
ordering + reload persistence, org isolation (another org's restore doesn't resurrect my review),
channel-hosting refusal, no-completion, and the route boundary.

**Frontend** (`MyReplyWork.test.tsx` +5): the recovery list is lazy (no read until opened); 복원 calls
the endpoint with an idempotency key, drops the row, refetches the to-do, and shows no completion word;
더 보기 appends a page rather than hiding items; an unattributable scope declines rather than showing
"nothing set aside"; a dead recovery read never renders as empty.

**Falsified:** neutering the restore disjunct in `NOT_DISMISSED_PREDICATE` fails 5 arbitration/re-entry
tests; a lazy/pagination/coverage regression fails the frontend recovery tests.
