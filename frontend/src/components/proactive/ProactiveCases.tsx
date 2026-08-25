import { useCallback, useEffect, useState } from "react";
import { SectionHeader } from "../ui/SectionHeader";
import { Chip } from "../ui/Chip";
import { BtnLink } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import { analytics } from "../../lib/analytics";
import {
  PREPARED_ACTION_LABEL,
  PRIORITY_LABEL,
  analyticsKind,
  caseTarget,
  evidenceLabel,
} from "../../lib/proactive";
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
export function ProactiveCases({ limit = 5, heading = "AI가 먼저 확인한 일" }: {
  limit?: number;
  heading?: string;
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
        if (response.items.length > 0) analytics.track("proactive_cases_viewed");
      } catch {
        // Fail-soft: the section simply is not there.
        if (live) {
          setCases([]);
          setTotal(0);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [limit]);

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
  const evidence = evidenceLabel(view);
  // One line, in the order a seller reads it: what it is, what SellerOps did, what that was built on.
  const status = [view.reasonNote, PREPARED_ACTION_LABEL[view.preparedAction], evidence]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={view.priority === "HIGH" ? "accent" : "neutral"}>
            {PRIORITY_LABEL[view.priority]}
          </Chip>
          <span className="break-keep text-sm text-muted">
            {view.subjectKind === "INQUIRY" ? "문의" : "리뷰"}
            {view.channelNameKo ? ` · ${view.channelNameKo}` : ""}
            {view.rating != null ? ` · ${view.rating}점` : ""}
            {` · ${view.productName ?? "상품 미지정"}`}
          </span>
        </div>

        {/* The row the seller recognises the work by. Masked server-side, never the buyer. */}
        <p className="mt-1.5 break-keep font-semibold leading-snug text-ink">
          {previewText(view.snippet)}
        </p>

        {/* Why it is here NOW, and how far SellerOps got — one line, because three stacked sentences
            of the same weight is how a card stops being read. */}
        <p className="mt-1 break-keep text-sm leading-relaxed text-muted">{status}</p>
        {view.recommendation ? (
          <p className="mt-0.5 break-keep text-sm leading-relaxed text-muted">
            {view.recommendation}
          </p>
        ) : null}
        {/* The gap, when there is one — a sentence, not a box. A tinted panel inside a card read as a
            warning about the card itself. */}
        {view.knowledgeGap ? (
          <p className="mt-0.5 break-keep text-sm leading-relaxed text-muted">{view.knowledgeGap}</p>
        ) : null}
      </div>

      {/* The single most important control on this section, at the emphasis that says so. It used to
          be an outline button — the quietest thing on a screen whose whole point was to be acted on. */}
      <BtnLink to={caseTarget(view)} size="sm" onClick={() => onOpen(view)} className="shrink-0">
        확인하기
      </BtnLink>
    </div>
  );
}
