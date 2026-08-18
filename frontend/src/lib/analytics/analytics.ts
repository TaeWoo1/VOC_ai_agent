import { type AnalyticsEventName, type AnalyticsEvents, isAnalyticsEvent, sanitize } from "./events";
import type { AnalyticsSink } from "./sink";

/**
 * The single analytics abstraction (docs/auth_growth_instrumentation_v1.md §2-8). Pages call
 * `analytics.track("sign_up", { method: "email" })`; the sinks (GTM, PostHog) are decided once at init from
 * env, and with no env there are no sinks — local/dev is OFF and `track` is a no-op.
 *
 * `once` events (per session): the same event+props pair fires at most once per page load — used for
 * `first_sync_completed`, whose polling source could otherwise repeat it.
 */
export interface Analytics {
  init(sinks: AnalyticsSink[]): void;
  track<E extends AnalyticsEventName>(event: E, props?: AnalyticsEvents[E]): void;
  /** Fire only once per page load for this event+props combination. */
  trackOnce<E extends AnalyticsEventName>(event: E, props?: AnalyticsEvents[E]): void;
  identify(userId: string | null): void;
  /** True when at least one sink is active. */
  readonly enabled: boolean;
  /** Test/inspection hook: what was emitted (after sanitizing), regardless of sinks. */
  readonly emitted: ReadonlyArray<{ event: AnalyticsEventName; props: Record<string, string> }>;
}

export function createAnalytics(warn: (message: string) => void = defaultWarn): Analytics {
  let sinks: AnalyticsSink[] = [];
  let started = false;
  const seen = new Set<string>();
  let identified: string | null = null;
  const emitted: Array<{ event: AnalyticsEventName; props: Record<string, string> }> = [];

  function ensureStarted() {
    if (started) return;
    started = true;
    for (const s of sinks) {
      try {
        s.start?.();
      } catch {
        // a vendor that fails to load must never break the product
      }
    }
  }

  function emit(event: string, rawProps: Record<string, unknown> | undefined): boolean {
    if (!isAnalyticsEvent(event)) {
      warn(`analytics: unknown event "${event}" dropped`);
      return false;
    }
    const { props, dropped } = sanitize(event, rawProps);
    if (dropped.length) warn(`analytics: ${event} dropped non-allow-listed props: ${dropped.join(", ")}`);
    emitted.push({ event, props });
    if (sinks.length === 0) return true;
    ensureStarted();
    for (const s of sinks) {
      try {
        s.track(event, props);
      } catch {
        // never let a sink throw into product code
      }
    }
    return true;
  }

  return {
    get enabled() {
      return sinks.length > 0;
    },
    get emitted() {
      return emitted;
    },
    init(next) {
      sinks = next;
      started = false;
    },
    track(event, props) {
      emit(event, props as Record<string, unknown> | undefined);
    },
    trackOnce(event, props) {
      const key = `${event}:${JSON.stringify(props ?? {})}`;
      if (seen.has(key)) return;
      seen.add(key);
      emit(event, props as Record<string, unknown> | undefined);
    },
    identify(userId) {
      // Idempotent: the auth context calls this on every user change, including the initial "no user yet";
      // a sink hears about a change of identity, not about every render.
      if (userId === identified) return;
      identified = userId;
      if (sinks.length === 0) return;
      ensureStarted();
      for (const s of sinks) {
        try {
          s.identify(userId);
        } catch {
          // ignore
        }
      }
    },
  };
}

function defaultWarn(message: string) {
  if (import.meta.env.DEV) console.warn(message);
}
