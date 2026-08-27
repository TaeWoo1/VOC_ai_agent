import { useCallback, useEffect, useState } from "react";
import { Section, ListBox } from "../ui/Section";
import { Status } from "../ui/Status";
import { BtnLink } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import { analytics } from "../../lib/analytics";
import { analyticsKind, caseTarget, preparedBadge } from "../../lib/proactive";
import type { ProactiveCaseView } from "../../lib/types";
import { previewText } from "../../lib/plainText";

/**
 * 「AI가 먼저 확인한 일」 — the one thing on this screen the seller did not ask for.
 *
 * <b>It is a section, not an app.</b> Every row ends at a screen that already exists. There is no
 * proactive-only detail page and no proactive-only action.
 *
 * <b>It renders nothing when there is nothing.</b> No empty state, no 「AI가 확인 중입니다」, no skeleton.
 *
 * <b>A failure here never takes the page down.</b>
 *
 * Rows, not cards (docs/reviewnary_design.md §4): what reviewnary did is the status word in the first
 * slot, the customer's sentence is the row, and the one control is 확인하기.
 */
export function ProactiveCases({ limit = 5, heading = "AI가 먼저 확인한 일", onLoaded, bare = false }: {
  limit?: number;
  heading?: string;
  /** How many rows this section ended up with — 0 included, and 0 on a failure. Reported, not counted twice. */
  onLoaded?: (count: number) => void;
  /** Render the rows only (no heading, no container) — for a parent that already provides both. */
  bare?: boolean;
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
    void api.markProactiveCaseOpened(view.id).catch(() => undefined);
  }, []);

  if (cases.length === 0) {
    return null;
  }

  const rows = (
    <ul className="divide-y divide-line/70">
      {cases.map((view) => (
        <li key={view.id}>
          <ProactiveRow view={view} onOpen={open} />
        </li>
      ))}
    </ul>
  );

  if (bare) {
    return <section aria-label={heading}>{rows}</section>;
  }
  return (
    <Section
      title={heading}
      ariaLabel={heading}
      hint={total > cases.length ? `전체 ${total}건 중 ${cases.length}건` : undefined}
    >
      <ListBox>{rows}</ListBox>
    </Section>
  );
}

function ProactiveRow({ view, onOpen }: { view: ProactiveCaseView; onOpen: (view: ProactiveCaseView) => void }) {
  const badge = preparedBadge(view);
  // Why it is here, in ONE line; what the evidence was is on the screen where the seller acts on it.
  const why = [view.reasonNote, view.recommendation].filter(Boolean).join(" · ") || null;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Status tone={badge.tone === "accent" ? "info" : badge.tone === "attention" ? "warn" : "neutral"} variant="word">
            {badge.label}
          </Status>
          {/* Channel and kind — the only metadata. 상품 is deliberately absent: this org's backlog is
              largely unattributed and 「상품 미지정」 on every row is not a fact the seller reads. */}
          <span className="break-keep text-sm text-muted">
            {view.channelNameKo ? `${view.channelNameKo} ` : ""}
            {view.subjectKind === "INQUIRY" ? "문의" : "리뷰"}
            {view.rating != null ? ` · ${view.rating}점` : ""}
          </span>
        </div>
        <p className="mt-0.5 break-keep text-base font-semibold leading-snug text-ink">{previewText(view.snippet)}</p>
        {why ? <p className="mt-0.5 break-keep text-sm leading-relaxed text-muted">{why}</p> : null}
        {/* The gap survives the trim: it is the only line that names something the SELLER can fix. */}
        {view.knowledgeGap ? <p className="mt-0.5 break-keep text-sm leading-relaxed text-muted">{view.knowledgeGap}</p> : null}
      </div>
      <BtnLink to={caseTarget(view)} onClick={() => onOpen(view)} size="sm" className="shrink-0">
        확인하기
      </BtnLink>
    </div>
  );
}
