import { type AnalyticsEventName, type AnalyticsEvents, isAnalyticsEvent, sanitize } from "./events";
import type { AnalyticsSink, ConsentGrant } from "./sink";

/**
 * The single analytics abstraction (docs/auth_growth_instrumentation_v1.md §2-8). Pages call
 * `analytics.track("sign_up", { method: "email" })`; the sinks (GTM, PostHog) are decided once at init from
 * env, and with no env there are no sinks — local/dev is OFF and `track` is a no-op.
 *
 * Consent (docs/service_readiness_v1.md §2-4): a sink starts only once 분석 consent is granted. Before a decision
 * events are buffered (≤ MAX_BUFFER, this page load) and flushed on grant; a refusal drops them. Withdrawing
 * consent later tells the sinks to stop.
 *
 * `once` events (per session): the same event+props pair fires at most once per page load — used for
 * `first_sync_completed`, whose polling source could otherwise repeat it.
 */
export interface Analytics {
  init(sinks: AnalyticsSink[]): void;
  /** `null` = no decision yet (buffer). */
  setConsent(grant: ConsentGrant | null): void;
  readonly consent: ConsentGrant | null;
  track<E extends AnalyticsEventName>(event: E, props?: AnalyticsEvents[E]): void;
  /** Fire only once per page load for this event+props combination. */
  trackOnce<E extends AnalyticsEventName>(event: E, props?: AnalyticsEvents[E]): void;
  identify(userId: string | null): void;
  /** True when at least one sink is active. */
  readonly enabled: boolean;
  /** True when sinks are running (consented and started). */
  readonly started: boolean;
  /** Test/inspection hook: what was emitted (after sanitizing), regardless of sinks. */
  readonly emitted: ReadonlyArray<{ event: AnalyticsEventName; props: Record<string, string> }>;
}

export const MAX_BUFFER = 100;

export function createAnalytics(warn: (message: string) => void = defaultWarn): Analytics {
  let sinks: AnalyticsSink[] = [];
  let started = false;
  let grant: ConsentGrant | null = null;
  const seen = new Set<string>();
  let identified: string | null = null;
  const emitted: Array<{ event: AnalyticsEventName; props: Record<string, string> }> = [];
  const buffer: Array<{ event: AnalyticsEventName; props: Record<string, string> }> = [];

  const allowed = () => sinks.length > 0 && grant?.analytics === true;

  function startSinks() {
    if (started || !grant) return;
    started = true;
    for (const s of sinks) {
      try {
        s.start?.(grant);
      } catch {
        // a vendor that fails to load must never break the product
      }
    }
    if (identified !== null) deliverIdentify(identified);
    for (const item of buffer.splice(0)) deliver(item.event, item.props);
  }

  function deliver(event: AnalyticsEventName, props: Record<string, string>) {
    for (const s of sinks) {
      try {
        s.track(event, props);
      } catch {
        // never let a sink throw into product code
      }
    }
  }

  function deliverIdentify(userId: string | null) {
    for (const s of sinks) {
      try {
        s.identify(userId);
      } catch {
        // ignore
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
    if (grant === null) {
      if (buffer.length < MAX_BUFFER) buffer.push({ event, props });
      return true;
    }
    if (!grant.analytics) return true;
    startSinks();
    deliver(event, props);
    return true;
  }

  return {
    get enabled() {
      return sinks.length > 0;
    },
    get started() {
      return started;
    },
    get consent() {
      return grant;
    },
    get emitted() {
      return emitted;
    },
    init(next) {
      sinks = next;
      started = false;
      buffer.length = 0;
    },
    setConsent(next) {
      const before = grant;
      grant = next;
      if (next === null) return;
      if (!next.analytics) {
        buffer.length = 0;
        if (started) {
          for (const s of sinks) {
            try {
              s.consent?.(next);
            } catch {
              // ignore
            }
          }
        }
        return;
      }
      if (!allowed()) return;
      if (!started) {
        startSinks();
        return;
      }
      if (before?.analytics !== next.analytics || before?.marketing !== next.marketing) {
        for (const s of sinks) {
          try {
            s.consent?.(next);
          } catch {
            // ignore
          }
        }
      }
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
      if (!allowed()) return;
      startSinks();
      deliverIdentify(userId);
    },
  };
}

function defaultWarn(message: string) {
  if (import.meta.env.DEV) console.warn(message);
}
