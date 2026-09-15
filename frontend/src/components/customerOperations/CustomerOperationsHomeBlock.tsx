import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BtnLink } from "../ui/Btn";
import { Status } from "../ui/Status";
import { api } from "../../lib/apiClient";
import { cadenceLabel, kstClock, lastRunWord, RESPONSIBILITY_NAME, statusWord } from "../../lib/customerOperations";
import type { CustomerOperationsHome } from "../../lib/customerOperationsTypes";
import { CustomerOperationsExceptions } from "./CustomerOperationsExceptions";

/**
 * 「고객 운영 관리」 on the Home — the job's one-line state, then its three exception areas.
 *
 * <b>Draws nothing unless it has something true to say.</b> A failed read, a deployment that has not opened the job
 * for this organisation, and an organisation with no connected Cafe24 all render null: a Home that said 「직접 판단하실
 * 일은 없습니다」 on the strength of an error would be reporting a clear morning nobody checked.
 */
export function CustomerOperationsHomeBlock({ now }: { now?: Date }) {
  const [home, setHome] = useState<CustomerOperationsHome | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    // Through a resolved promise so a client without this call (an older test double) is a failed read, not a crash.
    Promise.resolve()
      .then(() => api.getCustomerOperationsHome())
      .then((r) => {
        if (live) setHome(r);
      })
      .catch(() => {
        if (live) setHome(null);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!home || !home.available) return null;

  if (home.status === null) {
    if (!home.eligible) return null;
    return (
      <section aria-label={RESPONSIBILITY_NAME} className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <p className="break-keep text-sm text-ink">
          {RESPONSIBILITY_NAME}를 맡기시면 Reviewnary가 {cadenceLabel(home.cadenceMinutes)} 새 문의와 리뷰를 확인하고,
          직접 판단하실 일만 알려드립니다.
        </p>
        <BtnLink to="/customer-operations" size="sm" variant="outline">
          {RESPONSIBILITY_NAME} 보기
        </BtnLink>
      </section>
    );
  }

  const word = statusWord(home.status);
  const runWord = lastRunWord(home.lastRunStatus);
  const last = kstClock(home.lastCheckedAt, now);
  return (
    <section aria-label={RESPONSIBILITY_NAME} className="space-y-3 pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex flex-wrap items-center gap-x-2 text-base font-bold text-ink">
          {RESPONSIBILITY_NAME}
          <Status variant="word" tone={word.tone}>
            {word.label}
          </Status>
        </h2>
        <Link
          to="/customer-operations"
          className="rounded text-sm font-semibold text-brand-700 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          자세히 보기
        </Link>
      </div>
      <p className="break-keep text-sm text-muted">
        {cadenceLabel(home.cadenceMinutes)} 확인 · 마지막 확인 {last ?? "아직 없음"}
        {runWord ? `(${runWord})` : ""} · 다음 확인{" "}
        {home.status === "ACTIVE" ? kstClock(home.nextCheckAt, now) ?? "곧" : "멈춰 있음"}
      </p>
      <CustomerOperationsExceptions home={home} now={now} headingLevel="h3" />
    </section>
  );
}
