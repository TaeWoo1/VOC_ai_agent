import { useState } from "react";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { planStatusLabel } from "../../lib/reviewImport";
import type { ReviewImportPlanView, SellerAccountResponse } from "../../lib/types";
import { ReviewImportEntry } from "./ReviewImportEntry";
import { ReviewImportPlanDetail } from "./ReviewImportPlanDetail";

/**
 * The Initial Review Import entry point: choose a connected seller account, start a new historical
 * import, or resume an existing plan (interrupted work is reachable here, not lost). Selecting a plan
 * opens the resumable detail. Fail-closed on a dead accounts read.
 */
export function ReviewImportPage() {
  const accounts = useApiData<SellerAccountResponse[]>(() => api.getSellerAccountsStrict(), []);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [plansKey, setPlansKey] = useState(0);

  const active = accounts.data?.find((a) => a.id === accountId) ?? accounts.data?.[0] ?? null;

  const plans = useApiData<ReviewImportPlanView[]>(
    () => (active ? api.listReviewImportPlans(active.id) : Promise.resolve([])),
    [active?.id, plansKey],
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

      {active ? <ReviewImportEntry account={active} onCreated={(id) => setPlanId(id)} /> : null}

      <section aria-label="진행 중인 가져오기" className="rounded-2xl bg-surface p-5 shadow-card">
        <h3 className="mb-3 text-base font-semibold text-ink">진행 중인 가져오기</h3>
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
  );
}
