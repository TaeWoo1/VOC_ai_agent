/**
 * Sentry PII / secret scrubbing (docs/service_readiness_v1.md §2-1) — pure functions over the event shape, so
 * the rule is testable without the SDK. Removes: request query strings, `Authorization` / `Cookie` headers,
 * the user (entirely), breadcrumb URLs' query parts, and bearer / `code=` / `token=` shaped fragments in text.
 * The seller's email, name, 상호, review / inquiry text and marketplace ids never appear in a Sentry event
 * because no code puts them there; this is the fence for what the SDK collects on its own.
 */

const SECRET_SHAPED = /(bearer\s+[A-Za-z0-9._~+/=-]{8,})|(([?&]|\b)(code|token|onboardingToken|access_token|refresh_token|client_secret|password)=[^&\s]*)/gi;
/** An email address anywhere in free text (a DB unique-key message, an axios error string) is the seller's identity. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Breadcrumb data keys that carry a URL (fetch/xhr `url`, navigation `from`/`to`). */
const URL_DATA_KEYS = ["url", "from", "to"] as const;
const HEADER_DROP = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);

export function stripQuery(url: string | undefined | null): string | undefined {
  if (typeof url !== "string") return undefined;
  const cut = [url.indexOf("?"), url.indexOf("#")].filter((i) => i >= 0);
  return cut.length ? url.slice(0, Math.min(...cut)) : url;
}

export function scrubText(text: string | undefined | null): string | undefined {
  if (typeof text !== "string") return undefined;
  return text
    .replace(SECRET_SHAPED, (_m, bearer: string | undefined, _pair, prefix: string | undefined, key: string | undefined) =>
      bearer ? "bearer [redacted]" : `${prefix ?? ""}${key}=[redacted]`,
    )
    .replace(EMAIL_SHAPED, "[email]");
}

/** Strip the query/fragment from every URL-bearing key of a breadcrumb's data (shared by beforeBreadcrumb and scrubEvent). */
export function scrubBreadcrumbData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of URL_DATA_KEYS) {
    if (typeof data[key] === "string") data[key] = stripQuery(data[key] as string);
  }
  delete data["http.query"];
  delete data["http.fragment"];
  // A console breadcrumb carries the console arguments — free-form text nobody audited.
  delete data.arguments;
}

/** The subset of a Sentry event / transaction this scrubber touches. Structural, so it accepts the SDK's types. */
export interface ScrubbableEvent {
  user?: unknown;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
  transaction?: string;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.user;
  if (event.request) {
    event.request.url = stripQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (HEADER_DROP.has(key.toLowerCase())) delete event.request.headers[key];
      }
    }
  }
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) crumb.message = scrubText(crumb.message);
      scrubBreadcrumbData(crumb.data);
    }
  }
  if (event.message) event.message = scrubText(event.message);
  if (event.exception?.values) {
    for (const v of event.exception.values) v.value = scrubText(v.value);
  }
  if (event.transaction) event.transaction = stripQuery(event.transaction);
  // `extra` and `contexts.state` are free-form: nothing of ours is set there; drop whatever integrations add.
  delete event.extra;
  if (event.contexts && "state" in event.contexts) delete event.contexts.state;
  return event;
}
