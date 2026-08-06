import { useState } from "react";
import type { CoupangExpiryState, CoupangExpiryStatusView } from "../../lib/types";
import {
  daysRemainingLabel,
  expiryStateView,
  shouldOfferRenewal,
  type ExpiryTone,
} from "../../lib/coupangExpiry";

/** Renewal CTA label — single-sourced so the completion screen, channel list, and Operations never drift. */
export const RENEW_CTA_LABEL = "WING에서 API 키 갱신하기";

const TONE_CLS: Record<ExpiryTone, string> = {
  ok: "bg-good/10 text-good",
  warn: "bg-warn/10 text-warn",
  attention: "bg-bad/10 text-bad",
  expired: "bg-bad/10 text-bad",
  unknown: "bg-ink/5 text-muted",
};

/** Text-only tone chip for an expiry state (admin-console style — no glyph). */
export function ExpiryChip({ state }: { state: CoupangExpiryState }) {
  const view = expiryStateView(state);
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${TONE_CLS[view.tone]}`}
      data-testid="coupang-expiry-chip"
      data-state={state}
    >
      {view.label}
    </span>
  );
}

/** `yyyy-mm-dd` from an ISO instant, for an honest absolute-date display. Empty for an unparseable value. */
function isoDay(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The credential-expiry block for the Coupang connection COMPLETION screen. It shows the key's expiry state
 * + date; when the state is UNKNOWN (Coupang WING expiry is not machine-readable) it offers an
 * OPERATOR-CONFIRMATION date input — the operator enters the exact date, which the page stores as the token
 * expiry (never auto-estimated). From WARN_14 onward (renewRecommended) it surfaces the guided-renewal CTA.
 */
export function CoupangExpiryPanel({
  expiry,
  onRenew,
  onConfirmExpiry,
  busy,
}: {
  expiry: CoupangExpiryStatusView;
  /** Enter guided renewal (the "WING에서 API 키 갱신하기" CTA). */
  onRenew?: () => void;
  /** Store the operator-confirmed expiry date (ISO). Shown only when the state is UNKNOWN. */
  onConfirmExpiry?: (tokenExpiresAtIso: string) => void;
  busy?: boolean;
}) {
  const [date, setDate] = useState("");
  const isUnknown = expiry.state === "UNKNOWN";
  const dayLabel = daysRemainingLabel(expiry.daysRemaining);
  const offerRenewal = shouldOfferRenewal(expiry);

  const confirm = () => {
    if (!date || !onConfirmExpiry) return;
    const iso = new Date(`${date}T23:59:59Z`).toISOString();
    onConfirmExpiry(iso);
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-canvas/40 p-4" data-testid="coupang-expiry-panel">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted">키 유효기간</span>
        <ExpiryChip state={expiry.state} />
      </div>

      {!isUnknown && expiry.expiresAt && (
        <p className="text-sm text-muted">
          만료일 {isoDay(expiry.expiresAt)}
          {dayLabel ? ` · ${dayLabel}` : ""}
        </p>
      )}

      {isUnknown && (
        <div className="space-y-2" data-testid="coupang-expiry-confirm">
          <p className="text-sm text-muted break-keep">
            쿠팡 윙 발급 화면의 유효기간(만료일)을 확인해 그대로 입력해 주세요. SellerOps는 만료일을 임의로
            추정하지 않습니다.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="coupang-completion-expiry" className="sr-only">
              만료일을 확인해 입력
            </label>
            <input
              id="coupang-completion-expiry"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="만료일을 확인해 입력"
              className="rounded-xl border border-line px-4 py-2 text-base focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={confirm}
              disabled={busy || !date || !onConfirmExpiry}
            >
              만료일 저장
            </button>
          </div>
        </div>
      )}

      {offerRenewal && onRenew && (
        <button type="button" className="btn-primary" onClick={onRenew} disabled={busy}>
          {RENEW_CTA_LABEL}
        </button>
      )}
    </div>
  );
}
