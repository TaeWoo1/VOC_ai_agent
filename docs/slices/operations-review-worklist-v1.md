# Slice — Operations Review Worklist v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.** §4.1 and
> `docs/channel_capability_ledger.md` are untouched — this changes *where a seller finds their work*,
> not what a channel supports. Frontend only: **no backend, collector, contract, or migration change.**

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** the hand-off between PRIORITIZE and ACT
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — the work was filed under Settings

An audit of the whole journey (import history → worklist → detail/draft/approval → Action Window)
found one break far larger than the rest, and it was not a missing feature. Everything worked. It was
in the wrong place.

`AttentionSignalList` rendered in exactly one location: `ChannelDetail.tsx:382`, at
`/settings/channels/:accountId`. That single mount carried the honest "현재 확인이 필요한 리뷰 N건"
headline, the worst-first worklist, the category facet, triage, reply drafting, approval, and the
guided Action Window reply run — the entire ACT half of the wedge.

`lib/nav.ts` splits **운영** (frontstage, including **리뷰 운영**) from **연결·설정**, whose own
comment calls it "connection/collection tools". Every entry point into the worklist was in the
backstage group (`Channels.tsx:155`, `ConnectNaver.tsx:145`, `AlertSettings.tsx:203`). A grep for a
link into a channel detail from anywhere in 운영 returned **nothing** — not Home, not `/operations`,
not `ImportHistoryList`, not `ReviewWorkCard`.

So the page literally named 리뷰 운영 showed run status and import counts and **no reviews**, and the
product's own completion copy admitted it: *"확인이 필요한 리뷰는 **채널 화면**의 '오늘 확인할 일'에
표시돼요"* — a pointer, to Settings, with no link.

## 2. What changed

**Operations is now the review action surface.** `OperationsWorklist` mounts on `/operations` in the
`body` column, above the import-history rail: the worklist is what the seller came to do, the history
is the record of how it got here. `WorkbenchLayout` renders `body` before `rail` on desktop *and*
mobile, so that order holds on both.

**Settings is now connection/setup diagnostics only.** The worklist is *removed* from
`ChannelDetail`, which keeps health, credentials, schedules, backfill and collection history. One
mount, not two — so the two surfaces cannot drift in window semantics or copy, because there is only
one.

**The completion copy points at this page** instead of a channel screen, and its test now asserts the
string "채널 화면" is gone.

## 3. Explicit selection, never an inference

`resolveWorklistAccounts` (`lib/worklistAccounts.ts`) returns `none` / `single` / `choose`.

⚠ **`choose` carries no selection at all** — not null, not first, not most-recently-synced. This is
the load-bearing decision. `reviews` has no `seller_account_id`, so `IngestedReviewVocItemSource`
**refuses** to attribute reviews per-account when an org holds several on one channel and returns an
empty snapshot instead. Auto-picking here would render one account's view as the seller's whole
worklist: the exact inference the server declines to make, on the page they trust most. The test
asserts the resolution object has no `account` key at all.

`single` is *not* an inference — with one account there is nothing to choose between — but the UI
still **names** it, so a seller who later connects a second channel does not silently reinterpret
everything they remember from this page.

**No capability filter.** This does not decide which channels have a worklist; that answer lives
server-side in the VOC source registry, and a channel with no source already resolves to an honest
empty state. Encoding a channel list in the frontend would duplicate a product decision it has no
business holding and would silently exclude any channel added later.

## 4. Not review-only

Nothing here is review-specific — not the naming, not the shape. `AttentionSignalList` is already
channel-generic and renders inquiry signals (`UNANSWERED_INQUIRY`, `UNKNOWN_REPLY_STATUS`) beside
review ones, so an inquiry worklist needs **no new surface and no new resolution**. Calling this
"review accounts" or gating it on review capability would have made that a rewrite later; the review
headline stays where it already was, inside `AttentionSignalList`, and only appears when non-zero.

## 5. A gap this slice created, and closed

The new copy says the reviews appear **"아래"**. A worklist fetched on mount would have made that
false at the one moment a seller is certain to read it — they finish an export, read that their
reviews are below, and see the pre-import list.

`OperationsHome` therefore bumps a `refreshKey` when a run reaches a **terminal** status.
`FAILED` and `CANCELLED` are included alongside `COMPLETED` deliberately: a run can fail *after* a
partial ingest (`PARTIAL` is a real import outcome), so treating them as "nothing changed" would
leave the seller looking at a list that predates their own work. In-flight statuses are excluded —
nothing has reached the backend yet, so refetching would spend requests redrawing the same list. The
key is **not** threaded into the account read: an import does not connect a channel, and a test pins
that.

## 6. Verification

| | before | after |
|---|---|---|
| frontend | 710 | **733** |
| backend | 1490 (2 skipped) | unchanged, untouched |
| collector | 4843 / 95 skipped | unchanged, untouched |

Typechecks clean for both TS packages (`tsc --noEmit`; vitest does not typecheck).

**Every new rule falsified, each caught:**

| revert | test that failed |
|---|---|
| auto-pick the first of several accounts | `NEVER picks one when several exist` + 4 others |
| error state falls through to empty | `fails CLOSED — a dead read must never read as…` |
| worklist moved below the import history | `puts the work above the record` |
| completion copy points back at 채널 화면 | `points at the worklist on THIS page` |
| `refreshKey` not threaded to the worklist | `refetches when the page signals a settled run` + 1 |

⚠ One of those was caught for real rather than as an exercise: a `git checkout --` during
falsification reverted the copy change, and `points at the worklist on THIS page` failed on the next
full run.

Note `pages-copy.test.ts` globs `components/*` and `lib/*`, so the two new files were automatically
swept for banned roadmap phrasing (73 → 75 tests) without anything being added.

## 7. Recorded, not fixed

- **False calm on a multi-account channel.** The attention response still cannot say "I declined to
  answer": an ambiguous org gets an empty snapshot indistinguishable from "nothing needs attention"
  (logged WARN server-side, invisible to the client). The chooser makes *which* account explicit and
  so reduces the chance of misreading it, but does not remove it. A real fix needs account-scoped
  ingest — a product decision.
- `CommunityArticleList` still renders on `ChannelDetail`. It is arguably VOC content rather than
  setup diagnostics, but it is Cafe24's own store and out of this slice's scope.
- The high-rating complaint remains undetected; `rules-v2` is **not** started here.
- Carried forward: API-collected reviews are invisible to import history, and
  `CollectControlService.listRuns` filters after fetching, so `ChannelDetail`'s run list excludes
  every import.
- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
