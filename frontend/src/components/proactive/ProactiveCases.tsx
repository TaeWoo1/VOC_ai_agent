import { useCallback, useEffect, useState } from "react";
import { SectionHeader } from "../ui/SectionHeader";
import { Chip } from "../ui/Chip";
import { BtnLink } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import { analytics } from "../../lib/analytics";
import { analyticsKind, caseTarget, preparedBadge } from "../../lib/proactive";
import type { ProactiveCaseView } from "../../lib/types";
import { previewText } from "../../lib/plainText";

/**
 * 「AI가 먼저 확인한 일」 — the one thing on this screen the seller did not ask for.
 *
 * <b>It is a section, not an app.</b> Every card ends at a screen that already exists: an inquiry
 * opens the response flow it already had, a review opens the review list. There is no proactive-only
 * detail page and no proactive-only action, because a second place to work the same inquiry is a
 * second place to lose track of it.
 *
 * <b>It renders nothing when there is nothing.</b> No empty state, no "AI가 확인 중입니다" placeholder,
 * no skeleton on the first load. This section is an addition to a working screen; announcing its own
 * absence would cost the seller a glance every single visit to say nothing.
 *
 * <b>A failure here never takes the page down.</b> The read is deliberately the only fail-soft one in
 * the inquiry workflow — the queue behind it is still strict.
 */
export function ProactiveCases({ limit = 5, heading = "AI가 먼저 확인한 일", onLoaded }: {
  limit?: number;
  heading?: string;
  /**
   * How many cards this section ended up with — 0 included, and 0 on a failure.
   *
   * <b>Reported rather than counted twice.</b> The home briefing opens with a sentence that counts
   * what is on the screen below it, and a second read to find that number could disagree with the
   * one that was actually rendered. The section still owns its own fetch, its own telemetry and its
   * own fail-soft behaviour; it just says how many it drew.
   */
  onLoaded?: (count: number) => void;
}) {
  const [cases, setCases] = useState<ProactiveCaseView[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await api.getProactiveCases(limit);
        if (!live) return;
        setCases(response.items);
        setTotal(response.total);
        onLoaded?.(response.items.length);
        if (response.items.length > 0) analytics.track("proactive_cases_viewed");
      } catch {
        // Fail-soft: the section simply is not there.
        if (live) {
          setCases([]);
          setTotal(0);
          onLoaded?.(0);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [limit, onLoaded]);

  const open = useCallback((view: ProactiveCaseView) => {
    analytics.track("proactive_case_opened", { kind: analyticsKind(view) });
    // Fire-and-forget: a telemetry write must never stand between a seller and the work.
    void api.markProactiveCaseOpened(view.id).catch(() => undefined);
  }, []);

  if (cases.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2" aria-label={heading}>
      {/* No standing explanation under the heading. 「직접 찾지 않아도 되도록 미리 확인해 뒀습니다」 said
          the same thing the heading says, on every visit, above the only work that matters here. The
          hint now carries information or it is not there. */}
      <SectionHeader
        title={heading}
        hint={total > cases.length ? `전체 ${total}건 중 ${cases.length}건` : undefined}
      />
      <ul className="space-y-2">
        {cases.map((view) => (
          <li key={view.id}>
            <ProactiveCard view={view} onOpen={open} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProactiveCard({
  view,
  onOpen,
}: {
  view: ProactiveCaseView;
  onOpen: (view: ProactiveCaseView) => void;
}) {
  const badge = preparedBadge(view);
  // Why it is here, in ONE line. The card used to stack up to four grey sentences of equal weight —
  // reasonNote, prepared action, evidence count, knowledge gap, recommendation — under a headline,
  // and a reader with 50-year-old eyes does not survive four. What SellerOps did is now the badge;
  // what the evidence was and what is missing are on the screen where the seller acts on them.
  const why = [view.reasonNote, view.recommendation].filter(Boolean).join(" · ") || null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={badge.tone}>{badge.label}</Chip>
          {/* Channel and kind — the only metadata on the card. 상품 is deliberately absent: this
              org's backlog is largely unattributed, so the line read 「… · 상품 미지정」 on card after
              card, and a fact that is the same everywhere is not a fact the seller reads. */}
          <span className="break-keep text-sm text-muted">
            {view.channelNameKo ? `${view.channelNameKo} ` : ""}
            {view.subjectKind === "INQUIRY" ? "문의" : "리뷰"}
            {view.rating != null ? ` · ${view.rating}점` : ""}
          </span>
        </div>

        {/* The row the seller recognises the work by. Masked server-side, never the buyer. */}
        <p className="mt-2 break-keep text-lg font-semibold leading-snug text-ink">
          {previewText(view.snippet)}
        </p>

        {why ? (
          <p className="mt-1 break-keep text-base leading-relaxed text-muted">{why}</p>
        ) : null}
        {/* The gap, when there is one. It survives the trim because it is the only line on the card
            that names something the SELLER can go and fix — everything else describes what already
            happened. */}
        {view.knowledgeGap ? (
          <p className="mt-1 break-keep text-base leading-relaxed text-muted">{view.knowledgeGap}</p>
        ) : null}
      </div>

      {/* The single most important control on this section, at the emphasis that says so. */}
      <BtnLink to={caseTarget(view)} onClick={() => onOpen(view)} className="shrink-0">
        확인하기
      </BtnLink>
    </div>
  );
}
