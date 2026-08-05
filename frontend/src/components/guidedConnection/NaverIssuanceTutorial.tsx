import { useState } from "react";
import {
  NAVER_API_CENTER_URL,
  TUTORIAL_HINT_QUALIFIER,
  type TutorialStep,
} from "../../lib/guidedConnection";
import { AdvertisedCallIpPanel } from "./AdvertisedCallIpPanel";

/** The tutorial step at which the seller registers SellerOps' fixed call IP in their NAVER app. */
const CALL_IP_STEP_ID = "register_call_ip";

/**
 * Step-by-step NAVER Commerce API issuance tutorial (used for both the new-app issuance walk and the
 * existing-app reuse walk — the caller passes the step list). It is guidance only: SellerOps NEVER
 * auto-clicks the API center or reads a credential. The one external action opens the OFFICIAL center in
 * a NEW TAB; every step is performed by the seller there, and this SellerOps checklist stays on screen so
 * they can track where they are when they return.
 *
 * Privacy: the only state here is which steps the seller has ticked — transient, in-memory, and NEVER
 * containing a credential value or an account id (product constraint). It is not persisted; a refresh
 * simply restarts the checklist unticked (the reducer still restores the issuance PHASE).
 */
export interface NaverIssuanceTutorialProps {
  steps: readonly TutorialStep[];
  /** Advance the journey once the seller confirms they finished at the API center. Omit to render the
   *  checklist as pure guidance (e.g. above the existing-app credential form, where entering the
   *  credential IS the completion). */
  onComplete?: () => void;
  completeLabel?: string;
  busy?: boolean;
  /** SellerOps' advertised fixed egress IPv4(s) to register in the app's 'API 호출 IP'. Shown at the
   *  register-call-IP step. Empty/absent ⇒ fail-safe generic note, never a fabricated IP. */
  advertisedEgressIps?: readonly string[];
  /** COPY ONLY. An existing-app seller CONFIRMS their store's one app (no "발급"); a new-app seller issues
   *  one. The region heading follows the same path-aware convention as the completion label. Default false
   *  (new-app issuance). Never changes the step list — the caller passes the correct `steps`. */
  reuseExistingApp?: boolean;
}

export function NaverIssuanceTutorial({
  steps,
  onComplete,
  completeLabel,
  busy,
  advertisedEgressIps = [],
  reuseExistingApp = false,
}: NaverIssuanceTutorialProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCenter = () =>
    // New tab, and severed from this opener (no window.opener handle back into SellerOps).
    window.open(NAVER_API_CENTER_URL, "_blank", "noopener,noreferrer");

  const doneCount = steps.filter((s) => checked.has(s.id)).length;

  return (
    <div className="space-y-4" aria-label={reuseExistingApp ? "NAVER API 확인 안내" : "NAVER API 발급 안내"}>
      <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted" role="note">
        {TUTORIAL_HINT_QUALIFIER}
      </p>

      <ol className="space-y-3">
        {steps.map((step, i) => (
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
              <button type="button" className="btn-ghost mt-2 text-sm" onClick={openCenter}>
                NAVER 커머스 API 센터 열기 (새 탭)
              </button>
            )}
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted" role="status" aria-live="polite">
          체크리스트 {doneCount}/{steps.length}
        </span>
        {onComplete && (
          <button type="button" className="btn-primary" onClick={onComplete} disabled={busy}>
            {completeLabel}
          </button>
        )}
      </div>
    </div>
  );
}
