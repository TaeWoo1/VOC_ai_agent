import type { AnalyticsEventName } from "./events";

/** What the visitor allowed (docs/service_readiness_v1.md §2-4). A sink is only started once `analytics` is true. */
export interface ConsentGrant {
  analytics: boolean;
  marketing: boolean;
}

/**
 * A destination for already-sanitized events. Sinks are the ONLY code that knows a vendor exists; pages call
 * `analytics.track` and nothing else (docs/auth_growth_instrumentation_v1.md §2-8).
 */
export interface AnalyticsSink {
  readonly name: string;
  /** Called once, when analytics consent allows it — the place to load a vendor script. */
  start?(grant: ConsentGrant): void;
  /** Consent changed after start (e.g. 마케팅 toggled, or 분석 withdrawn → the sink must stop collecting). */
  consent?(grant: ConsentGrant): void;
  track(event: AnalyticsEventName, props: Record<string, string>): void;
  /** Opaque internal user id (UUID) or null on sign-out. Never an email or a name. */
  identify(userId: string | null): void;
}
