/**
 * Cohen's κ, in its own module because two scripts need it and importing a CLI to borrow a function
 * runs the CLI.
 */

/** RUBRIC v2 §7.4 — decisive on the binary partition, fixed before any label existed. */
export const MIN_BINARY_KAPPA = 0.6;

/**
 * κ with the usual large-sample standard error.
 *
 * <p>Returns `kappa: null` when expected agreement is total — two labelers who agree on everything
 * because everything is one class. That is expected agreement, not agreement, and `pe = 1` leaves κ
 * undefined; reporting 1.0 there would be the most flattering possible lie, and it is exactly the
 * degenerate case an enriched overlap (§7.3) exists to avoid. It has to be visible when it happens.
 */
export function cohenKappa(pairs) {
  const n = pairs.length;
  if (n === 0) {
    return null;
  }
  const classes = [...new Set(pairs.flatMap(([a, b]) => [a, b]))];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  let pe = 0;
  for (const c of classes) {
    pe += (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n);
  }
  if (pe >= 1) {
    return { kappa: null, po, pe, n, se: null, reason: "one class only — κ is undefined here" };
  }
  const kappa = (po - pe) / (1 - pe);
  return {
    kappa,
    po,
    pe,
    n,
    se: Math.sqrt((po * (1 - po)) / (n * (1 - pe) * (1 - pe))),
    reason: null,
  };
}
