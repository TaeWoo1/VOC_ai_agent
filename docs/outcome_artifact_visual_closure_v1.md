# Outcome Artifact + Visual Final Closure v1

> **What this is.** The cross-layer presentation blockers `a041b163` left standing, closed at their
> source. **Visual direction and chat semantics are frozen** — no new design system, no new agent
> architecture, no new colour token, no new component library. Planner/model, acquisition E2E,
> retrieval/memory, approval/write safety and the channel contract are untouched.
>
> **Marketplace calls 0 · WRITE 0 · model calls: the planner ones the QA turns made · migrations 0.**

---

## §1 The completion's numbers travel as numbers

**Root cause.** The backend's attempt row holds five facts about a finished guided acquisition —
channel, window, `rowsNew`, `rowsDuplicate`, `rowsFailed` — and `acquisitionSummary` turned all five
into one Korean sentence:

> 네이버 리뷰 8월 20일~9월 2일을 확인했습니다. 새로 들어온 리뷰 115건, 이미 확인한 리뷰 33건입니다.

A screen that wants to give the count a size, the window a place, or a failure a colour then has only
one way in: take our own sentence apart again. That is the shape this repository refuses everywhere
else, and it is why the two seconds after a collection finishes read as a system log.

**The contract.** One closed artifact, `ACQUISITION_RESULT`, in the same vocabulary as the other
seventeen — values only, no run id, no plan, no segment, no provenance:

```ts
interface AcquisitionResultArtifact extends ArtifactBase {
  type: "ACQUISITION_RESULT";
  channelCode: string; channelNameKo: string;
  periodStart: string | null; periodEnd: string | null;   // both ends or neither
  rowsNew: number | null; rowsDuplicate: number | null; rowsFailed: number | null;
}
```

`acquisitionResultOf()` builds it from the record the backend already answers; `acquisitionMeaning()`
writes the prose. **Neither restates the other**: the sentence says what the result MEANS (something new
arrived / nothing did / we cannot say which) and carries no digit and no date, and the card carries the
digits and the date and no sentence. `titleSaid` is declared by the producer, because the meaning
sentence is built from these same receipts and always stands above them.

**No completion truth is duplicated.** The claim ladder (`reviewClaim.ts`) is untouched, and the rule
that already governed it extends by one clause: a claim whose count equals the receipt's `rowsNew` for
that channel moves to the evidence disclosure, exactly as one that equals the list total does. A claim
that DIFFERS is genuinely new information and is still said — live, 「이번에 확인한 … 리뷰는 50건입니다」
stands beside a card reading 115, because 50 rows carried a date and 115 rows were new to the store.

**Nothing is derived on the card.** 115 and 33 are two observations; 148 is a third that nobody made, so
it is not shown. A tally the record does not hold renders nothing at all rather than a zero we did not
observe, and `rowsFailed: 0` renders nothing because a card read in two seconds should not spend a row
on a reassurance. A failure that DID happen gets its own figure, in `bad`.

**Live**, on the real Demo Org run of 2026-09-02 (`c1701821`, the attempt behind the brief's numbers):
the prose reads 「네이버 스마트스토어 리뷰를 새로 가져왔습니다. 이어서 확인하겠습니다.」 and under it the
card reads **네이버 스마트스토어 · 8월 20일~9월 2일** then **115 새로 들어옴 · 33 이미 있던 리뷰**, the
115 at `2xl` bold and everything else stepped down. The seller's two-second question — 무엇을 최신화했고
무엇이 새로 들어왔는지 — is answered by the two largest things on the card.

## §2 The sentinel window

**Root cause, exactly.** `ConversationService` handed the claim ladder a placeholder range so its filter
would pass everything:

```ts
claimsFor(primary.items, primary.scope.period ?? { from: "0000-00-00", to: "9999-99-99", token: null }, …)
```

`windowWord`'s default branch then printed it, and a seller read
「이번에 확인한 네이버 스마트스토어 리뷰 중 **0000-00-00~9999-99-99**에 작성된 리뷰는 50건입니다」.

**Fix.** `claimsFor` takes `DateWindow | null`. The row filter keeps every dated row when the window is
null — **the count does not move**, because that is precisely what the sentinel range did — and the only
thing that changes is the clause: with a window, 「… 중 오늘 작성된 리뷰는 N건입니다」; without one,
「이번에 확인한 … 리뷰는 N건입니다」. **An unbounded read names no period rather than inventing one.**
Claim semantics are otherwise unchanged: levels, precedence, and every existing sentence stand.

**Regression, two locks.** A unit test asserts the count is identical either way and that no sentinel
string survives; a source scan asserts no `.ts` under `agent-runtime/src` holds either literal in code.
The live sweep counts sentinel occurrences in the rendered `document.body` at all three widths: **0**.

## §3 The two remaining visual debts

**One footer, not two.** The inquiry collection ended in 「문의 16건 더 보기」 (full width, `sm`) above
「문의 화면에서 보기」 (its own row) — and the heavier of the two was the weaker action. `MoreRows` takes
an optional trailing node and renders one line: expand on the left where the rows end, the way out on the
right. It is the shape the review list already had.

**A review with no words.** Every ratings-only row was named 「별점만」, so four of them read as one
review printed four times. The name is now built from facts the row already holds — 「별점 5점만 남긴
리뷰 · {상품}」 — and, because the product moved INTO the name, it leaves the meta line rather than being
said twice; the ★ badge likewise renders only for rows whose name does not already state the rating.
Nothing is read or derived. Where neither rating nor product exists the row says 「내용 없는 리뷰」 rather
than pretending.

## §4 Design skills bootstrap

Three `.claude/skills/*` symlinks were committed pointing into `.agents/skills/`, which is ignored — a
fresh clone got three files that exist and resolve to nothing. Both are ignored now; `skills-lock.json`
stays tracked and `docs/design_skills_bootstrap.md` carries the one command that restores them, with the
note that this is **design-time tooling with no runtime, build, test or CI dependency**.

---

## Verification

| | |
|---|---|
| agent-runtime | **822** tests · 0 failures · typecheck clean |
| frontend | **2,652** tests · 223 files · 0 failures · typecheck clean |
| backend · collector | unchanged by this package |
| browser (real Demo Org, 1440 / 1366 / 1152) | A–E · **AA violations 0** · horizontal scroll 0 · off-host requests 0 |

**A** the acquisition completion (the real `c1701821` record, read through the product's own resume) ·
**B** 「그중 안 좋은 거 있어?」 straight after it · **C** sentinel occurrences **0** in the rendered page ·
**D** 20 inquiries, footer measured as one row · **E** several ratings-only reviews.

The one console error per pass is `503 /bridge/pair/request` — a local helper that IS running and
refusing to pair. Asking is how the page finds out; the browser logs any non-2xx resource.

**Test contracts rewritten, and why.**

- `chatFirstContinuity.test.ts` §3 — the completion's facts became an object and its prose a meaning.
  Every fact the old block asserted is still asserted, on the artifact that now carries it, plus two new
  ones: the prose contains no digit of the record, and the card is reachable end to end.
- `freshnessUx.test.ts` — a pre-existing `readonly` cast error (present at `a041b163`, so the previous
  package's "typecheck clean" was not true of `agent-runtime`) replaced with the contract's own type.
  No assertion changed.

**No safety assertion was weakened.**

---

## Reported, not fixed

- **Two ratings-only reviews of the same product on the same day still share a row name.** The facts that
  could separate them further are the date (already on the meta line) and nothing else; putting three
  facts in the title makes it a caption rather than a name. Left as is.
- **The completion turn re-raises its own step.** After the resume the re-planned turn asks for the next
  collection (「오늘 12:43 이후 아직 확인하지 못했어요」) directly under the receipt. That is the freshness
  routing being correct — the read IS newer than the sync — but a card asking for the step the seller
  just completed sits oddly beside its receipt. Frozen lane; reported.
- **The receipt is lost when the follow-up read fails.** `compose`'s FAILED branch returns no artifacts,
  exactly as it already dropped the completion prose. Carrying it through is a behaviour change to the
  failure path and is out of this package's scope.
- **QA scaffolding stands**: one conversation fixture per width in the Demo Org run-store bucket (a copy
  of a real waiting turn with its `requestedAt` moved before the real run finished, so the resume matches
  that run), and the QA-only JVM quota raise on the local backend. No product default changed, nothing
  written to the Demo Org.
