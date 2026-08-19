/**
 * **Pure gate for the explicit bridge-only resident mode** (`--bridge-only`). No I/O.
 *
 * ## Why this mode exists
 *
 * A seller who has paired the SellerOps 도우미 once expects it to simply be *there* the next morning: the
 * frontend chip says "연결됨", a review import can be started when they get to it, and nothing has been
 * opened on any marketplace in the meantime. The connector boot (`--connections`) cannot provide that: it
 * exits right after boot when nothing runnable is held (`shouldExitAfterBoot`), and keeping it resident
 * means holding a runnable *browser* connection — a live-marketplace posture with its own approval flag and
 * env — for a job that needs neither.
 *
 * So bridge-only is its **own boot**, decided before the connections gate (the same shape as the import
 * mode's own boot): the pairing/health bridge listens on loopback, the process stays alive until SIGINT /
 * SIGTERM, and **nothing else** happens — no connections file, no `decideRun`, no browser, no marketplace
 * env, no approval flag. Because it never reaches a marketplace, it needs no live approval; because it is
 * decided *before* `decideRun`, the `--connections` path and its safety contract are untouched.
 *
 * ## What the gate refuses
 *
 *  - **`--connections` alongside** — two boots were asked for. Refuse rather than pick one: an operator who
 *    added `--bridge-only` to a connections command must not silently lose the connections, and one who
 *    added `--connections` to a resident helper must not silently start connectors.
 *  - **any carrier flag alongside** — the resident bridge hosts no FLAG-selected carrier (a flag carrier is a
 *    promise that one fixed run will be served from boot). Same exclusivity rule as the import gate. The
 *    resident helper's single carrier slot holds the on-demand host instead (`bridge/on-demand-carrier-host.ts`,
 *    2026-08-19): idle until a SellerOps tab asks for the Coupang guided walk, bridge-only again after it.
 */
import { ACTION_WINDOW_IMPORT_FLAG, OTHER_CARRIER_FLAGS } from "./import-mode-gate";

/** The mode flag. */
export const BRIDGE_ONLY_FLAG = "--bridge-only";

export type BridgeOnlyModeDecision =
  | { host: true }
  | { host: false; reason: BridgeOnlyRefusal };

export type BridgeOnlyRefusal =
  /** Not asked for — the ordinary case, and not an error. */
  | "NOT_REQUESTED"
  /** `--connections` was also given: two boots in one command line. */
  | "CONNECTIONS_CONFLICT"
  /** A carrier flag was also given: the resident bridge hosts no carrier. */
  | "CARRIER_CONFLICT";

/** Every flag that selects a carrier, including the import mode's. */
const ALL_CARRIER_FLAGS: readonly string[] = [ACTION_WINDOW_IMPORT_FLAG, ...OTHER_CARRIER_FLAGS];

/**
 * Decide whether this invocation is the bridge-only resident boot. Pure; the env is accepted for symmetry
 * with the other gates and because the decision must stay a function over inputs — today no env key
 * changes it (the mode opens nothing live, so the seated-operator and production refusals of the import
 * gate do not apply).
 */
export function resolveBridgeOnlyMode(args: readonly string[], _env: NodeJS.ProcessEnv): BridgeOnlyModeDecision {
  if (!args.includes(BRIDGE_ONLY_FLAG)) return { host: false, reason: "NOT_REQUESTED" };
  if (args.includes("--connections")) return { host: false, reason: "CONNECTIONS_CONFLICT" };
  if (ALL_CARRIER_FLAGS.some((f) => args.includes(f))) return { host: false, reason: "CARRIER_CONFLICT" };
  return { host: true };
}

/** Operator-facing refusal line (no stack trace); `null` when nothing was refused. */
export function bridgeOnlyRefusalMessage(reason: BridgeOnlyRefusal): string | null {
  switch (reason) {
    case "NOT_REQUESTED":
      return null;
    case "CONNECTIONS_CONFLICT":
      return `${BRIDGE_ONLY_FLAG} cannot be combined with --connections — run either the resident bridge or the connector boot, not both.`;
    case "CARRIER_CONFLICT":
      return `${BRIDGE_ONLY_FLAG} hosts no flag-selected carrier (the Coupang guided walk comes up on demand) — remove the Action Window carrier flag or start the agent without ${BRIDGE_ONLY_FLAG}.`;
  }
}
