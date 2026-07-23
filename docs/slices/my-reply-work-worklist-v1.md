# Slice — 내 답변 작업 (My Reply Work) Worklist v1

> **Status:** IMPLEMENTED, offline. A persistent home for the operator's OWN committed reply work.
> **No auto-drafting, no dispatching, no Bridge change, no migration, no verified-completion claim** —
> it adds a place to stand, not a second way to reply.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (prepare → handoff → operator-reported completion)
- **Date:** 2026-07-24 · **Live contact:** none

---

## 1. Why — committed work had no home

The journey audit found the highest-impact missing step dead-center in the ACT arc: **everything a
seller committed to was reachable only by re-entering the exact arrival-signal drill-down that raised
the row** — window-scoped, signal-scoped, page-scoped, and reset by any window or account change.

- A seller interrupted mid-draft who closed the tab had **no way back to that draft** except
  remembering which review it was and re-navigating. The frontend already carried a
  `prepared`/`localWork` promotion hack whose only job was to stop the panel vanishing **mid-session** —
  the pain was known and patched session-locally, never across sessions.
- After 답변함으로 기록, the row was only **sunk** in the arrival list; there was no record of finished
  work anywhere.

The arrival worklist answers *"what came in"*. Nothing answered *"what did I commit to"*.

## 2. What changed

**Membership (backend, `ReviewRepository.COMMITTED_REPLY_WORK_PREDICATE`).** A review is the
operator's committed work when there is an explicit `RESPONSE_NEEDED` triage decision **OR** standing
reply work (a saved draft, or an APPROVED approval). Unioned rather than derived: a seller who
drafted and then moved the disposition has still done work that must not vanish; approvals join
drafts for the same reason `preparedFor` unions them — an approval implies a draft only because a
service rule says so today.

**Two reads, both account/org-scoped through the same `unambiguousChannelFor` resolution:**

- **to-do** — committed **and not reported**, worst-first (`rating asc` with **NULL ratings pushed
  LAST explicitly** — this lens has no `minRating` floor, and bare `rating asc` sorts nulls first on
  H2 and last on PostgreSQL, which would make the top of an operator's worklist depend on the DB).
  Reported rows are **excluded, not sunk**: this list is "what is still mine", and finished work would
  crowd out what remains. (The arrival list still sinks rather than drops — that divergence is
  deliberate and documented on both queries.)
- **recently reported** — bounded (default 5, ceiling 20), ordered by when the **report** was recorded
  (the outcome's own `createdAt` via a correlated MAX, so one row per review), most recent first.

**`GET /api/seller-accounts/{accountId}/reply-work`** → `OperatorReplyWorkView { sellerAccountId,
channel, coverage, todo, recentlyReported }`. **Deliberately no window parameter** — a commitment is
the operator's until they finish or abandon it, so the read survives a reload, a window change and a
new session. That persistence IS the feature.

**Coverage guard reused.** The view carries the same `AttentionCoverage` verdict as the attention
summary: an unattributable scope (multi-account, or a channel with no source) lists **nothing** and
says why. Reply work read from a scope we cannot attribute would be work shown under the wrong account.

**Frontend (`MyReplyWork`)** mounts on the operations surface beside the arrival worklist and
**reuses `VocItemCard` — and through it the existing `VocItemReplyPrep` flow — unchanged.** Rows carry
the identical `OperatorVocItem` shape (mapped through the same `toItem` + batch stampers), so the
reply-preparation panel drives them with no new path. Recording an outcome refetches, so a finished
row leaves the to-do and appears under 최근에 기록한 답변 without a manual reload.

**Copy (FE-owned).** The to-do states the promise — *"화면을 새로 열어도 그대로 남아 있습니다"*. The
reported section pairs the two facts it must always pair: *"답변했다고 기록한 리뷰예요. SellerOps는
채널에 실제로 등록됐는지 확인하지 않습니다(확인 안 함)."* — never 완료.

## 3. What is NOT in this slice

- **No auto-drafting.** Triage still drafts nothing; preparation happens only when the operator opens it.
- **No dispatching.** Nothing sends; the reply still leaves via the clipboard and the human.
- **No Bridge change, no migration, no new acquisition path.** Two queries over existing tables.
- **No verified-completion claim.** `verification` is `UNVERIFIED` by construction — there is no
  read-back oracle for a public reply — so the surface says 기록함 · 확인 안 함, never 완료.
- **Not window-scoped**, and that is the point rather than an omission.

## 4. Verification

| | before | after |
|---|---|---|
| backend | 1506 (2 skipped) | **1513** (2 skipped) |
| frontend | 808 | **815** |
| collector | untouched | untouched |

Both typechecks clean.

**Backend** (`ReplyWorkWorklistTest`, 7): membership is RESPONSE_NEEDED **or** a standing draft and
nothing else (MONITOR is a decision, not a commitment; an untouched 1★ belongs to the arrival queue);
ordering is worst-first then newest; a reported reply **leaves the to-do and appears under recently
reported**; recently-reported is most-recently-reported-first and bounded; every reported row is
UNVERIFIED and never a completion claim; org/account scoping (another org's commitment on the same
review is invisible); an ambiguous multi-account scope lists nothing and says why.

**Frontend** (`MyReplyWork.test.tsx`, 6): the to-do lists committed rows and states the persistence
promise; the read carries **no window** (a commitment cannot be invalidated by a date range); a
reported reply renders in its own section labelled UNVERIFIED and never 답변 완료; a COVERED empty
to-do reads honestly; an unattributable scope declines; a dead read never renders as an empty worklist.

**Falsified:** dropping the reported-exclusion from the to-do query fails 2 backend tests.

## 5. Recorded, not fixed

- **The to-do has no explicit "abandon" action.** A seller who changes their mind moves the
  disposition off RESPONSE_NEEDED, but a saved draft still holds the row in the list. Whether an
  explicit dismissal belongs here is a product-owner decision, not a silent default.
- **`SUBMISSION_ABORTED` still yields no benefit** — recorded in history, absent from both sections.
- **The reply-since-import gap is unchanged**: a reply posted on the channel outside SellerOps stays
  invisible until the next import.
- **Run 7 — EXECUTED and COMPLETED 2026-07-24.** No gate consumed by this slice, no live contact.
