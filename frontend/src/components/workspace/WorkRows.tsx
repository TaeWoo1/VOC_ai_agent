import { DecisionList, DecisionRow } from "../ui/DecisionRow";
import { selectionHref } from "./MasterDetail";
import { isOldBacklog, sharedRowFacts, type HomeWorkRow } from "../../lib/homeWork";
import { waitLabel } from "../../lib/copy/customerOps";
import type { CaseQueueState } from "../../pages/app/OperationsCase";

/**
 * The rows of 확인할 일 — on 오늘 (the first few) and on the queue (all of them) — drawn once, here.
 *
 * <p><b>No row carries a button.</b> Every row used to end in 「검토」 — twenty-seven identical controls, the first one
 * solid, on a list whose rows were already links. A row is now a selection: on a wide screen it opens the item in the
 * pane beside the list, where the one primary action lives; on a narrow one it opens the item's own screen, exactly
 * as before.
 *
 * <p><b>A reason every row carries is not a reason to tell them apart</b> (`lib/sharedWord.ts`). Measured on the
 * real org at 1440×900, all five rows of 오늘 read 「리뷰」 in a badge and 「쿠팡 리뷰 ★1」 beside it — the word
 * twice on one line, five times down the list, on a screen whose content is what the customers wrote. When every
 * row shares the tag the rows drop the badge and the list says it once: on 오늘 the heading already does
 * ({@code reasonCounts}, with its count), which is what {@code captionSaysReason} means; anywhere else this list
 * prints the caption itself, so the word is never simply lost.
 *
 * <p><b>The wait leads the row</b>, because this list is ordered by it. It used to sit right-aligned at x=1327 —
 * 990px from the start of the sentence it qualifies — so the sort key was the last thing the eye reached. Nothing
 * else about the row moved and no ordering changed.
 *
 * <p><b>The two groups are drawn, not just sorted.</b> {@link isOldBacklog} has ordered this list inside two groups
 * since the Demo Core freeze; a year-plus backlog row still waited in the same unbroken list, at the same weight as
 * this month's. A divider now says where the old ones start. Nothing is hidden, folded or re-ordered.
 */
export function WorkRows({
  rows,
  selectedKey,
  wide,
  search,
  now,
  ariaLabel,
  showBacklogDivider = true,
  dense = false,
  captionSaysReason = false,
  sharedOver,
}: {
  rows: HomeWorkRow[];
  selectedKey: string | null;
  wide: boolean;
  /** The page's current query string, kept on every selection link. */
  search: string;
  now?: Date;
  ariaLabel: string;
  showBacklogDivider?: boolean;
  /** {@link DecisionRow}'s two-line reading. Both lists use it: on the queue scrolling IS the work, and on 오늘
      the three-line reading spent 60% of the viewport on five rows and pushed the list's own exit under the dock. */
  dense?: boolean;
  /** The screen's own heading already names what every row shares (오늘 prints it beside the count). Then this
      list does not print a second caption for it. */
  captionSaysReason?: boolean;
  /**
   * The population the caller's caption speaks for. A brief draws five rows of a list of eleven, and a fact may
   * only be lifted off the rows when it is true of every row the caption covers — not merely of the five drawn.
   * Defaults to the rows drawn, which is the whole list wherever there is no brief.
   */
  sharedOver?: HomeWorkRow[];
}) {
  const caseIds = rows.map((r) => r.caseId).filter((id): id is string => id !== null);
  const shared = sharedRowFacts(sharedOver ?? rows);
  const firstOld = showBacklogDivider ? rows.findIndex((r) => isOldBacklog(r, now ?? new Date())) : -1;
  const oldCount = firstOld >= 0 ? rows.length - firstOld : 0;

  const draw = (row: HomeWorkRow) => {
    // A review opened on its own page from here offers the way back to here.
    const fullScreen = row.kind === "REVIEW" ? `${row.to}?from=work` : row.to;
    return (
      <DecisionRow
        key={row.key}
        tone={row.reason.tone}
        icon={row.reason.icon}
        tag={row.reason.tag}
        title={row.title}
        line={row.line}
        wait={waitLabel(row.since, now)}
        rating={shared.rating === null ? row.rating : null}
        source={shared.source === null ? row.source : null}
        tagHidden={shared.tag !== null}
        to={selectionHref(wide, row.key, fullScreen, search)}
        state={!wide && row.caseId ? ({ caseIds } satisfies CaseQueueState) : undefined}
        selected={wide && row.key === selectedKey}
        dense={dense}
      />
    );
  };

  const said = sharedPhrase(shared);
  const caption = said && !captionSaysReason ? <p className="mb-2 px-1 text-sm text-muted">{said}</p> : null;

  if (firstOld <= 0) {
    return (
      <>
        {caption}
        <DecisionList ariaLabel={ariaLabel} plain={dense}>
          {rows.map(draw)}
        </DecisionList>
      </>
    );
  }
  return (
    <div className="space-y-4">
      {caption}
      <DecisionList ariaLabel={ariaLabel} plain={dense}>
        {rows.slice(0, firstOld).map(draw)}
      </DecisionList>
      <p className="flex items-center gap-3 text-sm font-semibold text-muted" role="separator">
        <span>1년 넘게 기다린 것 {oldCount.toLocaleString("ko-KR")}건</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </p>
      <DecisionList ariaLabel={`${ariaLabel} · 1년 넘게 기다린 것`} plain={dense}>
        {rows.slice(firstOld).map(draw)}
      </DecisionList>
    </div>
  );
}

/**
 * 「모두 쿠팡 ★1 리뷰」 — what the whole list says, said once. Null when the rows differ, which is the ordinary
 * case and the one where every fact belongs on its own row.
 *
 * <p><b>「모두」 stays</b> (product-owner decision, 2026-09-26). The phrase sits where Intercom draws 「5 Open ⌄」
 * and Linear draws its filter pills — the position of a filter — and this list is not filtered. Dropping the word
 * would turn a true claim about all eleven rows into a label that invites 「so what is hidden?」. What was actually
 * awkward is that 「쿠팡 리뷰」 and 「★1」 arrived as two glued tokens; composed from the three hoisted pieces it is
 * one noun phrase, and the composition never takes {@link HomeWorkRow.source} apart.
 */
export function sharedPhrase(shared: {
  tag: string | null;
  source: string | null;
  rating: number | null;
  channel: string | null;
  subject: string | null;
}): string | null {
  const star = shared.rating === null ? null : `★${shared.rating}`;
  // Channel and noun were hoisted separately, so the star can stand between them.
  if (shared.channel && shared.subject) {
    return `모두 ${[shared.channel, star, shared.subject].filter(Boolean).join(" ")}`;
  }
  // No channel name to place the star against: the composed source (or the reason tag) is all there is, and it
  // already reads as one phrase. The source already contains the noun the tag repeats (「쿠팡 리뷰」 vs 「리뷰」).
  const parts = [shared.source ?? shared.tag, star].filter(Boolean);
  return parts.length > 0 ? `모두 ${parts.join(" ")}` : null;
}
