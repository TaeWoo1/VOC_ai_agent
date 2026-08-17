// Pre-v2 paths, kept working for one release.
//
// Declared as data rather than as a dozen inline <Route> elements for two reasons: the mapping is
// the contract (it is what stops an existing bookmark from 404-ing), and this list has a scheduled
// death — removal is decided after Slice 6, and a single array is what makes that a one-line
// change instead of an archaeology exercise.

export interface LegacyRedirect {
  /** Route pattern on the old IA. May contain `:param` segments. */
  from: string;
  /** Target on the v2 IA. `:param` segments are substituted from the matched route. */
  to: string;
  /** Carry the query string across. Needed by the `?channelId=` upload deep links. */
  keepSearch?: boolean;
}

export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  { from: "/issues", to: "/memory" },
  { from: "/operations", to: "/connect/imports" },
  { from: "/operations/current", to: "/connect/imports/current" },
  { from: "/settings/channels", to: "/connect" },
  { from: "/settings/channels/:accountId", to: "/connect/channels/:accountId" },
  { from: "/settings/upload", to: "/connect/upload", keepSearch: true },
  { from: "/settings/review-import", to: "/connect/review-history" },
  { from: "/channels", to: "/connect" },
  { from: "/channels/:accountId", to: "/connect/channels/:accountId" },
  { from: "/upload", to: "/connect/upload", keepSearch: true },
  { from: "/alerts", to: "/settings/alerts" },
  // Product assembly (2026-08-17): the review record became the 리뷰 surface.
  { from: "/connect/channels/:accountId/reviews", to: "/reviews/:accountId" },
];

/** Builds the concrete destination for a matched legacy route. */
export function resolveLegacyTarget(
  redirect: LegacyRedirect,
  params: Readonly<Record<string, string | undefined>> = {},
  search = "",
): string {
  const path = redirect.to.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => params[name] ?? "");
  return redirect.keepSearch ? `${path}${search}` : path;
}
