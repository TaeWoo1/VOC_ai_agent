# Slice — 작업에서 제외 (Reply-Work Dismissal) v1

> **Status:** IMPLEMENTED, offline. The operator can set a review ASIDE from their 내 답변 작업 to-do
> without claiming a reply happened. **Deletes no draft, writes no outcome, implies no completion.**
> One append-only table (V25), one idempotent endpoint, a read-time predicate; re-entry is automatic.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the 내 답변 작업 worklist)
- **Date:** 2026-07-24 · **Live contact:** none

---

## 1. Why — a committed review with no way off the list but "done"

After the 내 답변 작업 slice, a review was in the to-do while ANY of RESPONSE_NEEDED / a standing draft /
an APPROVED approval held it. The draft leg is disposition-independent, so a seller who saved a draft
and then changed their mind could not remove the review: moving the disposition off RESPONSE_NEEDED
left the draft holding it, and the only exits were reporting a reply (a completion claim they didn't
earn) or deleting the draft (losing work). There was no honest "set this aside".

## 2. What changed

**A dismissal is its own record — not a disposition, not an outcome.** Overloading `NO_ACTION` would
conflate "nothing to do" with "set my draft aside" AND fail the new-draft re-entry rule (a new draft
doesn't change the disposition); an outcome would falsely claim a reply. So dismissal is a dedicated,
operator-owned fact, mirroring how triage/draft/approval/outcome are each their own table.

**Data — `review_reply_work_dismissal` (V25, append-only).** `id, org_id, review_id, command_id,
dismissed_by, dismissed_at`, with `(org_id, command_id)` UNIQUE for idempotency and an index on
`(review_id, dismissed_at desc)` for the read. Append-only IS the history (no `updated_at`, no audit
table), like `review_reply_outcome`. Verified on a disposable PostgreSQL 15: V25 applies, the FK to
`reviews` is enforced, and the columns are `timestamptz`/`varchar` as intended.

**Read-time predicate — `ReviewRepository.NOT_DISMISSED_PREDICATE`.** An otherwise-eligible review is
included only when there is no dismissal, OR its latest committing signal is NEWER than its latest
dismissal — a `RESPONSE_NEEDED` triage decision (`decidedAt`), or a saved draft version (`createdAt`).
So a dismissal removes the review, and **re-entry is automatic** on either named trigger, with no
"restore" write and no writer coupling. Only decision/version timestamps count: an ordinary read or an
unrelated timestamp touch (e.g. a re-import bumping `reviews.updated_at`) can never reactivate it.
The correlated-subquery + timestamp logic was proven directly against PostgreSQL (excluded when the
dismissal is newer; re-enters when a fresh RESPONSE_NEEDED supersedes it).

**Endpoint — `POST …/attention/items/{actionRef}/reply-work/dismiss`** (idempotent on `commandId`).
Org and actor come from the token, never the client; the account must host the review's channel or
the ref is unaddressable. A repeat is a 200 replay (fast-path lookup + a `DataIntegrityViolation`
catch on the unique index for the concurrent case), not a second row. `ReviewReplyWorkDismissalService`
writes only the dismissal.

**Frontend.** Each to-do row gains a **작업에서 제외** control that calls the endpoint with a fresh
idempotency key and refetches, so the row leaves the list without a reload. Its copy states plainly
that it sets the review aside only — no draft deletion, no reply recorded, no completion.

## 3. What is NOT in this slice

- **No draft deletion or mutation** — the draft and its version history survive untouched.
- **No outcome, no completion claim, no verification** — a dismissal asserts nothing about the reply.
- **No "restore" endpoint** — re-entry is via the two existing committing actions, by timestamp.
- **Recently-reported (UNVERIFIED) items are unchanged** — dismissal touches only the to-do.
- **No auto-drafting, no dispatching, no Bridge work.**

## 4. Verification

| | before | after |
|---|---|---|
| backend | 1513 (2 skipped) | **1524** (2 skipped) |
| frontend | 815 | **816** |
| collector | untouched | untouched |

Both typechecks clean. **Disposable PostgreSQL 15:** V25 applied; table/FK/index shape correct; the
NOT_DISMISSED predicate exercised both ways on real data.

**Backend tests** (`ReplyWorkWorklistTest` +8, `OperatorReplyWorkDismissalControllerTest` +3):
dismissal removes the row while the draft + history survive; repeated same-commandId dismissal is an
idempotent single row + replay; a dismissal is not a completion (no outcome, empty recently-reported);
re-entry on a fresh RESPONSE_NEEDED; re-entry on a new draft version; stale signals do not reactivate;
org isolation (another org's dismissal doesn't hide my review); the write refuses an account that
doesn't host the review's channel; reload persistence (a fresh read still excludes). Route boundary:
the colon-bearing ref survives the path, org/actor come from the token, an anonymous caller never
reaches the service, a repeat is a 200 replay.

**Frontend** (`MyReplyWork.test.tsx` +1): 작업에서 제외 calls the dismiss endpoint with an idempotency
key (never an outcome write), the set-aside row leaves the list on refetch, and no completion word
appears.

**Falsified:** dropping the `NOT_DISMISSED_PREDICATE` from the to-do query fails 6 backend tests.

## 5. Recorded, not fixed

- **`SUBMISSION_ABORTED` still yields no benefit** — unchanged by this slice.
- **A dismissed review with only an old approval** (no newer triage/draft) stays out until a committing
  action supersedes — consistent with the two named re-entry triggers; approval alone is not one.
- **Run 7 — EXECUTED and COMPLETED 2026-07-24.** No gate consumed by this slice, no live contact.
