import { useReducer, useRef, useState } from "react";
import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import type { CredentialTemplateView } from "../../lib/types";
import type { GuidedIssuanceRuntime } from "../../lib/actionWindow/issuance/issuanceRuntime";
import {
  COUPANG_RENEWAL_COPY as R,
  coupangRenewalReducer,
  INITIAL_COUPANG_RENEWAL_STATE,
} from "../../lib/coupangRenewal";
import { recoveryCopy } from "../../lib/coupangTutorial";
import { SecureCredentialForm } from "../guidedConnection/SecureCredentialForm";
import { CoupangRenewalGuidedWalkthrough } from "./CoupangRenewalGuidedWalkthrough";

/** The safe replace outcome the flow needs (a subset of CredentialReplaceResultView). */
export interface RenewalReplaceOutcome {
  status: "SUCCESS" | "FAILED";
  reasonCode: string | null;
}

/**
 * The guided-renewal flow for an already-connected, expiring Coupang account. Owns the pure renewal reducer
 * and sequences: guided WING renewal walkthrough (or the agent-free text path) → masked credential REPLACE
 * form (new secrets + operator-confirmed expiry date) → the backend atomic replace → done. On failure the
 * old credential is preserved (backend rollback) and a safe reason lets the operator retry — the existing
 * account / orders / cursor are never touched, and the FE creates no new account.
 *
 * The secrets flow straight from {@link SecureCredentialForm} to `onReplace`; they never enter this reducer,
 * an event, or storage. `onReplace` is the page's call into `api.replaceCredential`.
 */
export interface CoupangRenewalFlowProps {
  template: CredentialTemplateView | null;
  /** Perform the atomic replace (page → api.replaceCredential). Resolves the safe outcome; a throw ⇒ FAILED. */
  onReplace: (secrets: Record<string, string>, tokenExpiresAt: string | undefined) => Promise<RenewalReplaceOutcome>;
  /** Leave the renewal flow after success (e.g. back to the connection status / channel). */
  onDone: () => void;
  /** CONTROLLED seam forwarded to the walkthrough for offline/fixture rendering (run/onCommand/hostRuntime). */
  walkthroughSeam?: {
    run?: ActionWindowRunView | null;
    onCommand?: (type: CommandType) => void;
    hostRuntime?: GuidedIssuanceRuntime;
  };
}

/** Convert a `yyyy-mm-dd` date-input value to an ISO instant (end of that day, UTC), or undefined if blank. */
function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}T23:59:59Z`);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

export function CoupangRenewalFlow({ template, onReplace, onDone, walkthroughSeam }: CoupangRenewalFlowProps) {
  const [state, dispatch] = useReducer(coupangRenewalReducer, INITIAL_COUPANG_RENEWAL_STATE);
  const [busy, setBusy] = useState(false);
  // Operator-confirmed new-key expiry (yyyy-mm-dd). NEVER auto-estimated; blank ⇒ tokenExpiresAt omitted.
  const [expiryDate, setExpiryDate] = useState("");
  const inFlight = useRef(false);

  const submitReplace = async (secrets: Record<string, string>) => {
    if (inFlight.current || !template) return;
    inFlight.current = true;
    dispatch({ type: "SUBMIT" });
    setBusy(true);
    try {
      const outcome = await onReplace(secrets, dateInputToIso(expiryDate));
      dispatch({ type: "REPLACE_RESULT", status: outcome.status, reasonCode: outcome.reasonCode });
    } catch {
      // A transport/throw is fail-closed FAILED — the backend keeps the old credential; nothing is destroyed.
      dispatch({ type: "REPLACE_RESULT", status: "FAILED", reasonCode: null });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (state.phase === "guide") {
    return (
      <div className="space-y-4" data-testid="coupang-renewal" data-phase="guide">
        <p className="text-sm text-muted break-keep">{R.guideIntro}</p>
        <CoupangRenewalGuidedWalkthrough
          onComplete={() => dispatch({ type: "WALKTHROUGH_DONE" })}
          busy={busy}
          run={walkthroughSeam?.run}
          onCommand={walkthroughSeam?.onCommand}
          hostRuntime={walkthroughSeam?.hostRuntime}
        />
      </div>
    );
  }

  if (state.phase === "done") {
    return (
      <div className="space-y-4" data-testid="coupang-renewal" data-phase="done">
        <div className="rounded-xl border border-brand/40 bg-good/10 p-5" role="status">
          <p className="font-semibold text-ink">{R.doneTitle}</p>
          <p className="mt-1 text-sm text-muted break-keep">{R.doneBody}</p>
        </div>
        <button type="button" className="btn-primary" onClick={onDone}>
          {R.doneCta}
        </button>
      </div>
    );
  }

  // replace | replacing | replace_error — the masked REPLACE form (+ operator-confirm expiry, + error banner).
  const isError = state.phase === "replace_error";
  const submitting = busy || state.phase === "replacing";
  const errorCopy = isError ? recoveryCopy(state.reasonCode) : null;

  return (
    <div className="space-y-5" data-testid="coupang-renewal" data-phase={state.phase}>
      <section aria-label="새 키로 교체" className="space-y-2">
        <h3 className="text-base font-bold text-ink">{R.replaceTitle}</h3>
        <p className="text-sm text-muted break-keep">{R.replaceBody}</p>
      </section>

      {errorCopy && (
        <div className="rounded-xl border border-bad/40 bg-bad/5 p-4" role="alert" data-testid="coupang-renewal-error">
          <p className="font-semibold text-ink">{errorCopy.title}</p>
          <p className="mt-1 text-sm text-muted break-keep">{errorCopy.body}</p>
        </div>
      )}

      {/* Operator-confirm the NEW key's expiry date — never auto-estimated. Optional: blank ⇒ backend leaves
          it UNKNOWN (which re-offers the confirm path) rather than guessing. */}
      <section aria-label="새 키의 만료일 확인" className="space-y-2 rounded-xl border border-line bg-canvas/40 p-4">
        <label htmlFor="coupang-renewal-expiry" className="block text-base font-semibold text-ink">
          {R.expiryConfirmTitle}
        </label>
        <p className="text-sm text-muted break-keep">{R.expiryConfirmBody}</p>
        <input
          id="coupang-renewal-expiry"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          aria-label={R.expiryConfirmLabel}
          className="w-full rounded-xl border border-line px-4 py-2.5 text-base focus:border-brand focus:outline-none"
        />
        <p className="text-xs text-muted break-keep">{R.expiryConfirmOptional}</p>
      </section>

      {template ? (
        <SecureCredentialForm
          template={template}
          onSubmit={submitReplace}
          submitting={submitting}
          heading={R.replaceHeading}
          idPrefix="coupang-renew-cred"
        />
      ) : (
        <p className="text-muted" role="status">
          연결에 필요한 정보를 불러오는 중입니다…
        </p>
      )}
    </div>
  );
}
