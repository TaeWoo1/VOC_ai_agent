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
 * The historical-import screen. ONE decision carries it — how far back to import — and from then on the work
 * happens in the seller's own SmartStore window; this card holds the summary they come back to (progress, the
 * period they chose, the next segment, completion).
 *
 * The segment/attempt machinery below it is real and still reachable, but as DIAGNOSTICS behind an
 * expander: it is how an operator inspects or repairs an import, not how a seller performs one. Making it
 * the workflow is what turned an onboarding step into a file-management chore.
 *
 * Fail-closed on a dead accounts read.
 */
/**
 * The channel the guided import can actually drive.
 *
 * One entry, and it is a statement of fact rather than a limit we chose here: the local agent hosts a NAVER
 * review surface (`collector/.../naver-live-import-driver.ts`) and the roadmap's §4.1 table lists no other. A
 * ticket for any other channel is refused by the runtime, which is where that rule belongs — this constant only
 * keeps the screen from leading a seller somewhere the runtime will stop them.
 */
const GUIDED_CHANNEL_CODES: readonly string[] = ["NAVER"];

export function ReviewImportPage() {
  const accounts = useApiData<SellerAccountResponse[]>(() => api.getSellerAccountsStrict(), []);
  // Read for ONE purpose: accounts carry a channel id and a display name, not a channel code, so this is the only
  // way to tell which of them the guided flow can serve. A failed read degrades to "no preference", never to a
  // blocked screen.
  const channels = useApiData(() => api.getChannels(), []);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [plansKey, setPlansKey] = useState(0);
  const bridge = useBridge();

  const guidedChannelIds = (channels.data ?? [])
    .filter((c) => GUIDED_CHANNEL_CODES.includes(c.code))
    .map((c) => c.id);
  /**
   * The account this screen works on.
   *
   * Defaults to one the guided flow can actually drive, NOT to whichever came back first. On 2026-07-26 the
   * demo org's first account was a Coupang one, so a seller reached "이 기간으로 시작하기" with 쿠팡 named on the
   * card — while every step after it guides NAVER. Picking arbitrarily is how a screen offers work that cannot
   * be done; the runtime now refuses such a ticket outright, and this stops the seller being sent there at all.
   */
  const active =
    accounts.data?.find((a) => a.id === accountId) ??
    accounts.data?.find((a) => guidedChannelIds.includes(a.channelId)) ??
    accounts.data?.[0] ??
    null;

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
              // The channel is always shown, even when the seller gave the account a nickname. An alias like
              // "라이브 2구간 테스트" tells you nothing about WHICH marketplace it is, and this screen's whole
              // choreography is marketplace-specific.
              <option key={a.id} value={a.id}>
                {a.alias ? `${a.alias} · ${a.channelNameKo}` : a.channelNameKo}
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
          // The pairing surface belongs to the page (it owns the bridge client) but has to APPEAR on the card,
          // which is the screen that is blocked without it. The live run found no seller-facing pairing entry
          // point at all — it existed only behind a developer env flag (finding 14).
          pairing={{
            phase: bridge.state.phase,
            confirmationCode: "confirmationCode" in bridge.state ? bridge.state.confirmationCode : null,
            onConnect: bridge.requestPairing,
            onRetry: bridge.retry,
          }}
          // The seller's chosen period became a plan, so the card's summary is re-read from the backend rather
          // than inferred from what was posted.
          onPlanCreated={() => setPlansKey((k) => k + 1)}
          onLaunched={() => setPlansKey((k) => k + 1)}
          // A finished segment run covered a month of the plan server-side, so the same re-read applies.
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
