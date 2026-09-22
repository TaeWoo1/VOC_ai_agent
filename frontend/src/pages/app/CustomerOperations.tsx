import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { PageHead } from "../../components/ui/PageHead";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { Disclosure } from "../../components/ui/Disclosure";
import { Status } from "../../components/ui/Status";
import { CustomerOperationsExceptions } from "../../components/customerOperations/CustomerOperationsExceptions";
import { api } from "../../lib/apiClient";
import {
  cadenceLabel,
  DUTIES_REVIEWNARY,
  DUTIES_SELLER,
  kstClock,
  lastRunWord,
  NO_ELIGIBLE_SOURCE_SENTENCE,
  RESPONSIBILITY_DESCRIPTION,
  RESPONSIBILITY_NAME,
  scopeLabels,
  sourceHealthLine,
  statusWord,
} from "../../lib/customerOperations";
import type {
  CustomerOperationsHome,
  CustomerOperationsSourceHealth,
  ResponsibilityRunView,
  ResponsibilityView,
} from "../../lib/customerOperationsTypes";

/**
 * 「고객 운영 관리」 — the job the seller handed over: what it covers, what Reviewnary does and what stays with the
 * seller, when it last looked and when it looks next, the three exception areas, and the recent checks.
 *
 * <b>There is no 「지금 확인」.</b> The job works its own fixed windows; the only check a person causes is the one
 * starting (or resuming) it causes for the window that is open. And there is no control here that answers a customer,
 * resolves a case or changes a policy — those are on the screens that own them.
 */
export function CustomerOperations({ now }: { now?: Date }) {
  const [view, setView] = useState<ResponsibilityView | null | undefined>(undefined);
  const [home, setHome] = useState<CustomerOperationsHome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const loadHome = useCallback(async () => {
    try {
      setHome(await api.getCustomerOperationsHome());
    } catch {
      setHome(null);
    }
  }, []);

  useEffect(() => {
    let live = true;
    api
      .getCustomerOperations()
      .then((v) => {
        if (live) setView(v);
      })
      .catch(() => {
        if (live) setView(null);
      });
    void loadHome();
    return () => {
      live = false;
    };
  }, [loadHome]);

  async function act(run: () => Promise<ResponsibilityView>) {
    setBusy(true);
    setError(null);
    try {
      setView(await run());
      setConfirmStop(false);
      await loadHome();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHead
        title={RESPONSIBILITY_NAME}
        meta={
          view && view.available ? (
            <Status variant="word" tone={statusWord(view.status).tone}>
              {statusWord(view.status).label}
            </Status>
          ) : undefined
        }
      />
      {view === undefined ? <p className="text-sm text-muted">불러오는 중입니다.</p> : null}
      {view === null ? (
        <p className="text-sm text-bad" role="alert">
          {RESPONSIBILITY_NAME}를 불러오지 못했습니다.
        </p>
      ) : null}
      {view && !view.available ? (
        <p className="break-keep text-muted">이 계정에서는 아직 {RESPONSIBILITY_NAME}를 사용할 수 없습니다.</p>
      ) : null}
      {view && view.available ? (
        <>
          <section aria-label="맡긴 일" className="space-y-5 rounded-2xl border border-line bg-surface p-5">
            {/* The page title already names this; the card no longer says it a second time (Phase 4). */}
            <p className="break-keep leading-relaxed text-ink">{RESPONSIBILITY_DESCRIPTION}</p>

            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
              <Fact label="확인 주기" value={cadenceLabel(view.cadenceMinutes)} />
              <Fact
                label="마지막 확인"
                value={
                  home?.lastCheckedAt
                    ? `${kstClock(home.lastCheckedAt, now)}${lastRunWord(home.lastRunStatus) ? ` · ${lastRunWord(home.lastRunStatus)}` : ""}`
                    : "아직 없음"
                }
              />
              <Fact
                label="다음 확인"
                value={
                  view.status === "ACTIVE"
                    ? kstClock(view.nextRunAt, now) ?? "곧"
                    : view.status === null
                      ? "시작하면 바로 첫 확인을 합니다"
                      : "멈춰 있음"
                }
              />
            </dl>

            <div className="grid gap-5 sm:grid-cols-3">
              <Duty title="확인 대상" items={scopeLabels(view.sourcesInScope)} />
              <Duty title="제가 하는 일" items={DUTIES_REVIEWNARY} />
              <Duty title="내 확인이 필요한 일" items={DUTIES_SELLER} />
            </div>

            <div className="space-y-3 border-t border-line pt-4">
              {error ? (
                <p className="break-keep text-sm text-bad" role="alert">
                  {error}
                </p>
              ) : null}
              {view.status === null || view.status === "STOPPED" ? (
                view.eligible ? (
                  <Btn disabled={busy} onClick={() => act(() => api.activateCustomerOperations())}>
                    {view.status === "STOPPED" ? `${RESPONSIBILITY_NAME} 다시 맡기기` : `${RESPONSIBILITY_NAME} 시작하기`}
                  </Btn>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="break-keep text-ink">{NO_ELIGIBLE_SOURCE_SENTENCE}</p>
                    {/* The channel list, not one channel: this responsibility can start from any of the
                        channels it can collect without a person, and the connect screen is where the seller
                        chooses. Pointing at Cafe24 sent every other seller to the wrong shop. */}
                    <BtnLink to="/connect">판매 채널 연결하기</BtnLink>
                  </div>
                )
              ) : null}
              {view.status === "ACTIVE" || view.status === "PAUSED" ? (
                confirmStop ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="break-keep text-sm text-ink">
                      중지하면 새 확인을 하지 않고, 열려 있는 확인 요청도 닫습니다. 중지할까요?
                    </p>
                    <Btn variant="outline" size="sm" disabled={busy} onClick={() => act(() => api.stopCustomerOperations())}>
                      중지하기
                    </Btn>
                    <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmStop(false)}>
                      취소
                    </Btn>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    {view.status === "ACTIVE" ? (
                      <Btn variant="outline" disabled={busy} onClick={() => act(() => api.pauseCustomerOperations())}>
                        일시정지
                      </Btn>
                    ) : (
                      <Btn disabled={busy} onClick={() => act(() => api.resumeCustomerOperations())}>
                        다시 시작
                      </Btn>
                    )}
                    <Btn variant="ghost" disabled={busy} onClick={() => setConfirmStop(true)}>
                      중지
                    </Btn>
                  </div>
                )
              ) : null}
            </div>
          </section>

          {view.status !== null && home?.available ? (
            <CustomerOperationsExceptions home={home} now={now} headingLevel="h2" />
          ) : null}

          {view.runs.length > 0 ? (
            <Disclosure label="최근 확인 기록" note={`${view.runs.length}회`}>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
                {view.runs.map((run) => (
                  <RunItem key={run.id} run={run} now={now} />
                ))}
              </ul>
            </Disclosure>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RunItem({ run, now }: { run: ResponsibilityRunView; now?: Date }) {
  const latest = new Map<string, CustomerOperationsSourceHealth>();
  for (const s of [...run.sources].sort((a, b) => a.attempt - b.attempt)) {
    latest.set(`${s.sellerAccountId}:${s.dataType}`, {
      channelCode: s.channelCode,
      channelNameKo: null,
      dataType: s.dataType,
      completeness: s.completeness,
      observedCount: s.observedCount,
      newCount: s.newCount,
      failureReason: s.failureReason,
      observedAt: s.observedAt,
      sellerActionRequired: s.failureReason === "AUTH_REQUIRED" || s.failureReason === "NOT_CONNECTED",
    });
  }
  return (
    <li className="p-3">
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-medium text-ink">{kstClock(run.windowStart, now)} 확인</span>
        <span className="text-muted">{runStatusKo(run)}</span>
        {run.attempt > 1 ? <span className="text-muted">{run.attempt}번째 시도</span> : null}
      </p>
      {latest.size > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {[...latest.values()].map((s) => (
            <li key={`${s.channelCode}-${s.dataType}`} className="break-keep text-sm text-muted">
              {sourceHealthLine(s).text}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function runStatusKo(run: ResponsibilityRunView): string {
  switch (run.status) {
    case "SUCCESS":
      return "모두 확인";
    case "PARTIAL":
      return "일부만 확인";
    case "FAILED":
      return "확인하지 못함";
    case "RUNNING":
      return "확인 중";
    case "PENDING":
      return "확인 대기";
    case "CANCELLED":
      return run.failureReason === "MISSED" ? "확인하지 못하고 지나감" : "진행하지 않음";
    default:
      return "";
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 break-keep font-medium text-ink">{value}</dd>
    </div>
  );
}

function Duty({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="break-keep text-sm text-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function messageOf(e: unknown): string {
  if (isAxiosError(e)) {
    const data = e.response?.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string" && data.message.trim()) return data.message;
  }
  return "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}
