import type { AnalyticsEventName } from "./events";

/**
 * A destination for already-sanitized events. Sinks are the ONLY code that knows a vendor exists; pages call
 * `analytics.track` and nothing else (docs/auth_growth_instrumentation_v1.md §2-8).
 */
export interface AnalyticsSink {
  readonly name: string;
  /** Called once, on the first `track`/`identify` after init — the place to load a vendor script. */
  start?(): void;
  track(event: AnalyticsEventName, props: Record<string, string>): void;
  /** Opaque internal user id (UUID) or null on sign-out. Never an email or a name. */
  identify(userId: string | null): void;
}
