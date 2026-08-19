import { useState } from "react";
import { Link } from "react-router-dom";
import { useOptionalConsent } from "./ConsentProvider";
import { PRIVACY_PATH } from "../legal";

/**
 * The cookie / analytics consent banner (docs/service_readiness_v1.md §2-4). Rendered only while a decision is
 * pending under the banner policy. 필수 is not a choice; 분석 and 마케팅 are separate. The wording is structural
 * — the confirmed cookie list / legal sentence is a launch item (§7).
 */
export function ConsentBanner() {
  const consent = useOptionalConsent();
  const [detail, setDetail] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const [marketingOn, setMarketingOn] = useState(false);
  if (!consent?.pending) return null;
  const { decide } = consent;

  const box = "rounded-lg border border-line px-3 py-2 text-sm text-ink";
  const button =
    "inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <div>
          <p id="consent-title" className="text-base font-semibold text-ink">
            분석 도구 사용에 동의해 주세요
          </p>
          <p className="mt-1 break-keep text-sm leading-relaxed text-muted">
            서비스 운영에 필요한 필수 저장소는 항상 사용됩니다. 선택 항목(분석·마케팅)은 동의한 경우에만 켜지며, 언제든
            바꿀 수 있습니다.{" "}
            <Link to={PRIVACY_PATH} className="font-medium text-brand-700 underline-offset-2 hover:underline">
              개인정보처리방침
            </Link>
          </p>
        </div>
        {detail ? (
          <fieldset className="grid gap-2 sm:grid-cols-3" aria-label="동의 항목">
            <label className={`${box} opacity-80`}>
              <input type="checkbox" checked disabled className="mr-2 align-middle" /> 필수 (항상 사용)
            </label>
            <label className={box}>
              <input
                type="checkbox"
                checked={analyticsOn}
                onChange={(e) => setAnalyticsOn(e.target.checked)}
                className="mr-2 align-middle"
              />{" "}
              분석 (이용 통계)
            </label>
            <label className={box}>
              <input
                type="checkbox"
                checked={marketingOn}
                onChange={(e) => setMarketingOn(e.target.checked)}
                className="mr-2 align-middle"
              />{" "}
              마케팅 (광고 측정)
            </label>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {detail ? (
            <button
              type="button"
              className={`${button} bg-brand-700 text-white hover:bg-brand-600`}
              onClick={() => decide({ analytics: analyticsOn, marketing: marketingOn })}
            >
              선택 저장
            </button>
          ) : (
            <>
              <button type="button" className={`${button} border border-line text-ink hover:bg-canvas`} onClick={() => setDetail(true)}>
                직접 선택
              </button>
              <button
                type="button"
                className={`${button} border border-line text-ink hover:bg-canvas`}
                onClick={() => decide({ analytics: false, marketing: false })}
              >
                필수만 사용
              </button>
              <button
                type="button"
                className={`${button} bg-brand-700 text-white hover:bg-brand-600`}
                onClick={() => decide({ analytics: true, marketing: true })}
              >
                모두 동의
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
