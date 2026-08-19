import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { analytics } from "../analytics";
import {
  clearConsent,
  consentPolicy,
  readConsent,
  writeConsent,
  type ConsentDecision,
  type ConsentEnv,
  type ConsentPolicy,
} from "./consent";

/**
 * Consent for the browser (docs/service_readiness_v1.md §2-4). Holds the stored decision, exposes the policy
 * (`banner` | `not-applicable`), and pushes every change into the analytics layer — which is the only thing a
 * decision changes right now (Sentry is 필수 and does not wait).
 */
export interface ConsentState {
  policy: ConsentPolicy;
  decision: ConsentDecision | null;
  /** True when the banner should be on screen: banner policy and no decision yet. */
  pending: boolean;
  decide(choice: { analytics: boolean; marketing: boolean }): void;
  /** Forget the decision and show the banner again ("언제든 바꿀 수 있습니다" — the footer's 쿠키·분석 설정). */
  reopen(): void;
}

const ConsentContext = createContext<ConsentState | undefined>(undefined);

export function ConsentProvider({
  children,
  env = import.meta.env as unknown as ConsentEnv,
}: {
  children: ReactNode;
  env?: ConsentEnv;
}) {
  const policy = useMemo(() => consentPolicy(env), [env]);
  const [decision, setDecision] = useState<ConsentDecision | null>(() => readConsent());

  const decide = useCallback((choice: { analytics: boolean; marketing: boolean }) => {
    const next = writeConsent(choice);
    setDecision(next);
    analytics.setConsent({ analytics: next.analytics, marketing: next.marketing });
  }, []);

  const reopen = useCallback(() => {
    clearConsent();
    setDecision(null);
    // Until the new decision: nothing more leaves the browser (a running sink is told to stop by a refusal;
    // "pending" buffers). A previously granted sink keeps its state until the seller decides again.
    analytics.setConsent({ analytics: false, marketing: false });
  }, []);

  const value = useMemo<ConsentState>(
    () => ({ policy, decision, pending: policy === "banner" && decision === null, decide, reopen }),
    [policy, decision, decide, reopen],
  );
  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

/** The banner's hook: no provider (a test rendering `App` alone) = no banner, not a crash. */
export function useOptionalConsent(): ConsentState | undefined {
  return useContext(ConsentContext);
}

export function useConsent(): ConsentState {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within ConsentProvider");
  return ctx;
}
