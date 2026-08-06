import { useState } from "react";
import {
  COUPANG_ISSUANCE_TUTORIAL,
  COUPANG_WING_URL,
  TUTORIAL_HINT_QUALIFIER,
} from "../../lib/guidedConnection";
import { AdvertisedCallIpPanel } from "../guidedConnection/AdvertisedCallIpPanel";

/** The tutorial step at which the seller registers SellerOps' fixed call IP in their Coupang app. */
const CALL_IP_STEP_ID = "register_call_ip";

/**
 * Text-fallback checklist for the Coupang WING Open API key issuance (mirrors {@link NaverIssuanceTutorial}).
 * It is guidance ONLY: SellerOps NEVER scripts WING, never auto-clicks 발급, and never reads a key value. The
 * one external action opens the OFFICIAL WING center in a NEW TAB (severed from the opener); every step is
 * performed by the seller there, and this checklist stays on screen so they can track where they are.
 *
 * Privacy: the only state here is which steps the seller has ticked — transient, in-memory, and NEVER a key
 * value or an account id. It is not persisted; a refresh restarts the checklist unticked (the reducer still
 * restores the issuance PHASE, and the hosted run reattaches idempotently).
 */
export function CoupangIssuanceTutorial({
  onComplete,
  completeLabel = "발급을 완료했어요",
  busy,
  advertisedEgressIps = [],
}: {
  /** Advance the journey once the seller confirms they finished at WING (→ credential entry). */
  onComplete: () => void;
  completeLabel?: string;
  busy?: boolean;
  /** SellerOps' advertised fixed egress IPv4(s) to register in the app's 'API 호출 IP'. Shown at the
   *  register-call-IP step. Empty/absent ⇒ fail-safe generic note, never a fabricated IP. */
  advertisedEgressIps?: readonly string[];
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openWing = () =>
    // New tab, severed from this opener (no window.opener handle back into SellerOps).
    window.open(COUPANG_WING_URL, "_blank", "noopener,noreferrer");

  const doneCount = COUPANG_ISSUANCE_TUTORIAL.filter((s) => checked.has(s.id)).length;

  return (
    <div className="space-y-4" aria-label="쿠팡 Open API 키 발급 안내">
      <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted" role="note">
        {TUTORIAL_HINT_QUALIFIER}
      </p>

      <ol className="space-y-3">
        {COUPANG_ISSUANCE_TUTORIAL.map((step, i) => (
          <li key={step.id} className="space-y-2 rounded-lg border border-line px-4 py-3">
            {/* Label wraps ONLY the checkbox + title (valid phrasing nesting); the help is a sibling so
                opening it never toggles the checkbox. */}
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked.has(step.id)}
                onChange={() => toggle(step.id)}
                aria-label={step.title}
              />
              <span className="block min-w-0 text-sm font-medium text-ink">
                {i + 1}. {step.title}
              </span>
            </label>

            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none text-warn">어디를 눌러야 하나요?</summary>
              <p className="mt-1">{step.hint}</p>
            </details>

            {step.id === CALL_IP_STEP_ID && <AdvertisedCallIpPanel ips={advertisedEgressIps} />}

            {step.opensCenter && (
              <button type="button" className="btn-ghost mt-2 text-sm" onClick={openWing}>
                쿠팡 윙 열기 (새 탭)
              </button>
            )}
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted" role="status" aria-live="polite">
          체크리스트 {doneCount}/{COUPANG_ISSUANCE_TUTORIAL.length}
        </span>
        <button type="button" className="btn-primary" onClick={onComplete} disabled={busy}>
          {completeLabel}
        </button>
      </div>
    </div>
  );
}
