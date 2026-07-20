/**
 * The single wall-clock read allowed in the CLI layer, isolated in its own module so a CLI that needs today's
 * KST date does not have to import another CLI's whole module graph to get it.
 *
 * Library code must never read a clock (see the recency-chain rules): everything downstream takes an explicit
 * `referenceTimeMs` / as-of date. This boundary helper is where that explicit value comes from.
 */

/** Today's KST calendar date (`YYYY-MM-DD`). KST is UTC+9 with no DST. */
export function currentKstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
