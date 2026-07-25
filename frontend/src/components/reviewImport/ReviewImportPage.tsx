import { useState } from "react";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { useBridge } from "../../hooks/useBridge";
import { agentAvailabilityFromBridgePhase, planStatusLabel } from "../../lib/reviewImport";
import type {
  ReviewImportPlanDetailView,
  ReviewImportPlanView,
  SellerAccountResponse,
} from "../../lib/types";
import { GuidedImportCard } from "./GuidedImportCard";
import { ReviewImportEntry } from "./ReviewImportEntry";
import { ReviewImportPlanDetail } from "./ReviewImportPlanDetail";

/**
 * The historical-import screen. ONE action carries it — 과거 리뷰 전체 연동하기 — and everything the seller
 * needs (progress, the range NAVER allows, the next segment, completion) sits on that card.
 *
 * The segment/attempt machinery below it is real and still reachable, but as DIAGNOSTICS behind an
 * expander: it is how an operator inspects or repairs an import, not how a seller performs one. Making it
 * the workflow is what turned an onboarding step into a file-management chore.
 *
 * Fail-closed on a dead accounts read.
 */
export function ReviewImportPage() {
  const accounts = useApiData<SellerAccountResponse[]>(() => api.getSellerAccountsStrict(), []);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [plansKey, setPlansKey] = useState(0);
  const bridge = useBridge();

  const active = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.[0] ?? null;

  const plans = useApiData<ReviewImportPlanView[]>(
    () => (active ? api.listReviewImportPlans(active.id) : Promise.resolve([])),
    [active?.id, plansKey],
  );

  // The plan the guided card summarises: the newest one still worth working on. An ABANDONED plan is
  // deliberately skipped — the seller ended it, so offering to continue it would resurrect a decision they
  // already made.
  const currentPlan = plans.data?.find((p) => p.status !== "ABANDONED") ?? null;
  const currentDetail = useApiData<ReviewImportPlanDetailView | null>(
    () => (currentPlan ? api.getReviewImportPlan(currentPlan.id) : Promise.resolve(null)),
    [currentPlan?.id, plansKey],
  );

  if (accounts.loading) {
    return <p className="text-base text-muted">불러오는 중…</p>;
  }
  if (accounts.error || !accounts.data) {
    return (
      <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad" role="alert">
        계정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
      </p>
    );
  }
  if (accounts.data.length === 0) {
    return (
      <p className="rounded-2xl bg-surface p-5 text-base text-muted shadow-card">
        먼저 판매 채널 계정을 연결해 주세요.
      </p>
    );
  }

  if (planId && active) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            setPlanId(null);
            setPlansKey((k) => k + 1);
          }}
          className="self-start text-sm text-brand underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          ← 가져오기 목록으로
        </button>
        <ReviewImportPlanDetail planId={planId} accountId={active.id} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {accounts.data.length > 1 ? (
        <label className="text-sm text-ink">
          계정
          <select
            value={active?.id ?? ""}
            onChange={(e) => setAccountId(e.target.value)}
            className="ml-2 rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {accounts.data.map((a) => (
              <option key={a.id} value={a.id}>
                {a.alias ?? a.channelNameKo}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {active ? (
        <GuidedImportCard
          account={active}
          plan={currentDetail.data ?? null}
          agent={agentAvailabilityFromBridgePhase(bridge.state.phase)}
          onLaunched={() => setPlansKey((k) => k + 1)}
          // A guided run that finished changed the plan server-side — a discovery run CREATED it, a segment run
          // covered a month of it — so the card's own summary is re-read from the backend rather than inferred.
          onRunSettled={() => setPlansKey((k) => k + 1)}
          onUseFileFallback={() => currentPlan && setPlanId(currentPlan.id)}
        />
      ) : null}

      {/* Diagnostics, not the workflow. Collapsed by default: this is where an operator inspects segments,
          attempt history, split/merge, and the manual file fallback when a guided run cannot happen. */}
      <details className="rounded-2xl bg-surface p-5 shadow-card">
        <summary className="cursor-pointer text-base font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          자세히 보기 (구간·이력·직접 가져오기)
        </summary>

        <div className="mt-4 flex flex-col gap-4">
          {active ? <ReviewImportEntry account={active} onCreated={(id) => setPlanId(id)} /> : null}

          <section aria-label="진행 중인 가져오기">
            <h4 className="mb-3 text-base font-semibold text-ink">진행 중인 가져오기</h4>
            {plans.loading ? (
              <p className="text-sm text-muted">불러오는 중…</p>
            ) : plans.error || !plans.data ? (
              <p className="text-sm text-bad" role="alert">
                목록을 불러오지 못했어요.
              </p>
            ) : plans.data.length === 0 ? (
              <p className="text-sm text-muted">아직 만든 가져오기 계획이 없어요.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {plans.data.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPlanId(p.id)}
                      data-testid="plan-list-row"
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-3 text-left transition hover:bg-line/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <span className="text-ink break-keep">
                        {p.requestedStart} ~ {p.requestedEnd}
                      </span>
                      <span className="shrink-0 text-sm text-muted">{planStatusLabel(p.status)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}
