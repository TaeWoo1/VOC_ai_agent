import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SectionHeader } from "../ui/SectionHeader";
import { Chip } from "../ui/Chip";
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
    <section className="space-y-3" aria-label={heading}>
      <SectionHeader
        title={heading}
        hint={
          total > cases.length
            ? `직접 찾지 않아도 되도록 미리 확인해 뒀습니다. 전체 ${total}건 중 ${cases.length}건`
            : "직접 찾지 않아도 되도록 미리 확인해 뒀습니다."
        }
      />
      <ul className="grid gap-3 md:grid-cols-2">
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
  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={view.priority === "HIGH" ? "accent" : "neutral"}>
          {PRIORITY_LABEL[view.priority]}
        </Chip>
        <span className="text-sm text-muted">
          {view.subjectKind === "INQUIRY" ? "문의" : "리뷰"}
          {view.channelNameKo ? ` · ${view.channelNameKo}` : ""}
          {view.rating != null ? ` · ${view.rating}점` : ""}
        </span>
      </div>

      {/* The row the seller recognises the work by. Masked server-side, never the buyer. */}
      <p className="break-keep font-semibold leading-snug text-ink">{view.snippet}</p>
      <p className="break-keep text-sm text-muted">{view.productName ?? "상품 미지정"}</p>

      {/* Why it is here NOW — the sentence this whole feature exists to be able to write. */}
      <p className="break-keep text-sm leading-relaxed text-ink">{view.reasonNote}</p>
      {view.recommendation ? (
        <p className="break-keep text-sm leading-relaxed text-muted">{view.recommendation}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span className="font-medium text-ink">{PREPARED_ACTION_LABEL[view.preparedAction]}</span>
        {evidence ? <span>· {evidence}</span> : null}
      </div>

      {/* The gap, when there is one — with the sentence that says what closing it would buy. */}
      {view.knowledgeGap ? (
        <p className="break-keep rounded-xl bg-canvas px-3 py-2 text-sm leading-relaxed text-muted">
          {view.knowledgeGap}
        </p>
      ) : null}

      <div className="mt-auto pt-1">
        <Link
          to={caseTarget(view)}
          onClick={() => onOpen(view)}
          className="inline-flex min-h-[36px] items-center justify-center rounded-xl border border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          확인하기
        </Link>
      </div>
    </div>
  );
}
