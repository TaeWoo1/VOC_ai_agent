/**
 * **The one unattended recipe this product has: observe a surface Reviewnary owns.**
 *
 * Scheduled Aside runs with no human present. The question that decides whether that is safe is not «what does
 * the recipe do» but «what can it be pointed at», and this file is the whole answer: an entry URL is accepted
 * only when it is loopback. Every marketplace host fails — not because a blacklist names it, but because it is
 * not `127.0.0.1`. A blacklist is a list someone has to keep correct forever; this is a property.
 *
 * That single rule carries three items of the unattended security contract at once: no arbitrary URL, a target
 * allow-list, and no marketplace target. A seller's real store cannot be read by a job nobody is watching,
 * because the recipe that runs unattended cannot name it.
 *
 * <b>v1 is exactly one recipe.</b> Not a recipe format, not a registry a caller can extend at runtime: a frozen
 * constant and a validator. Adding a second one is a deliberate edit to this file, which is the point.
 */

/** The closed recipe vocabulary. One entry — see the file docblock on why that is a design decision. */
export const FIXTURE_OBSERVE_RECIPE_ID = "CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1" as const;
export type FixtureObserveRecipeId = typeof FIXTURE_OBSERVE_RECIPE_ID;

export interface FixtureObserveWorkflow {
  readonly id: FixtureObserveRecipeId;
  readonly version: number;
  /** The owned surface this recipe opens. Loopback only — the validator refuses anything else. */
  readonly entryUrl: string;
  readonly settleTimeoutMs: number;
}

/** The hosts an unattended recipe may open. Not «hosts we trust» — hosts that are this machine. */
const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]", "::1"];

export const FIXTURE_OBSERVE_PATH = "/fixture/customer-operations" as const;

/** Built against the helper's own bridge port, which is why the URL is a parameter rather than a constant. */
export function fixtureObserveWorkflow(bridgePort: number): FixtureObserveWorkflow {
  return Object.freeze({
    id: FIXTURE_OBSERVE_RECIPE_ID,
    version: 1,
    entryUrl: `http://127.0.0.1:${bridgePort}${FIXTURE_OBSERVE_PATH}`,
    settleTimeoutMs: 15_000,
  });
}

export type FixtureObserveWorkflowError =
  | "RECIPE_UNKNOWN"
  | "VERSION_INVALID"
  | "ENTRY_URL_INVALID"
  /** The entry names a host that is not this machine — a marketplace, or anything else off-box. */
  | "ENTRY_NOT_LOOPBACK"
  | "TIMEOUT_INVALID";

/**
 * Empty means this workflow may run with nobody watching. Every other return is a refusal, and the caller
 * must treat it as one: an unattended run that «mostly» validated its target is the failure this file exists
 * to make impossible.
 */
export function validateFixtureObserveWorkflow(w: FixtureObserveWorkflow): readonly FixtureObserveWorkflowError[] {
  const errors: FixtureObserveWorkflowError[] = [];
  if (w.id !== FIXTURE_OBSERVE_RECIPE_ID) errors.push("RECIPE_UNKNOWN");
  if (!Number.isInteger(w.version) || w.version < 1) errors.push("VERSION_INVALID");
  const screened = screenLoopbackUrl(w.entryUrl);
  if (screened === "MALFORMED") errors.push("ENTRY_URL_INVALID");
  if (screened === "OFF_BOX") errors.push("ENTRY_NOT_LOOPBACK");
  if (!Number.isInteger(w.settleTimeoutMs) || w.settleTimeoutMs < 1_000 || w.settleTimeoutMs > 120_000) {
    errors.push("TIMEOUT_INVALID");
  }
  return errors;
}

export type LoopbackScreen = "LOOPBACK" | "OFF_BOX" | "MALFORMED";

/**
 * Parsed, not pattern-matched. A string test would admit `http://127.0.0.1.example.com/` and
 * `http://user@127.0.0.1@evil.example/`; the URL parser resolves both to the host they actually reach.
 * Only plain http/https are considered at all, so no `file:`, `data:` or `javascript:` entry survives.
 */
export function screenLoopbackUrl(raw: string): LoopbackScreen {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "MALFORMED";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "MALFORMED";
  // Credentials in a URL are never part of an owned-surface address, and they are how an off-box host hides
  // behind a loopback-looking prefix. Detected through the authority portion rather than by naming the
  // credential fields: no file in this package may name them, and that fence is worth more than a shorter
  // expression here (`aside-guard.test.ts`). `username` is the non-secret half and is safe to read.
  const authority = raw.slice(url.protocol.length).replace(/^\/+/, "");
  if (url.username !== "" || authority.slice(0, authority.search(/[/?#]|$/)).includes("@")) return "MALFORMED";
  return LOOPBACK_HOSTS.includes(url.hostname) ? "LOOPBACK" : "OFF_BOX";
}
