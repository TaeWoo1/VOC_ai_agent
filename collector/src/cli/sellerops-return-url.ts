/**
 * **Where `SellerOps로 돌아가기` is allowed to send the seller.** Pure — it parses and decides; it opens nothing.
 *
 * The guided walk's last step promises a return to SellerOps, and something has to navigate for that promise to
 * be true. That "something" is a navigation of the seller's own dedicated window, driven by a button on a
 * marketplace page — so the destination is screened the same way the WING landing is, and fails closed.
 *
 * The rule is deliberately narrow: **the local SellerOps UI on loopback, and nothing else.** The configured app
 * URL is operator-supplied, and an operator-supplied string that can steer a browser window is a string worth
 * bounding. Only the ORIGIN survives screening — any path, query or fragment on the configured value is
 * discarded and replaced with the connect route, so nothing can ride along in it.
 */

/** The one route the walk returns to: the Coupang connect screen, where the copied keys are entered. */
export const SELLEROPS_COUPANG_CONNECT_PATH = "/connect/coupang";

/** Why a return destination was refused. Fixed enum — it is logged, so it carries no URL and no host. */
export type SellerOpsReturnRefusal = "EMPTY" | "UNPARSEABLE" | "NOT_HTTP" | "NOT_LOOPBACK";

export type SellerOpsReturnScreen =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: SellerOpsReturnRefusal };

/**
 * The hosts that ARE this machine. The local agent's UI is served from loopback and nowhere else; a SellerOps
 * deployment on a real domain is not something a marketplace-page button should be able to navigate to, and if
 * that ever becomes a product requirement it should arrive as its own decision rather than through this list.
 */
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]", "::1"];

/**
 * Whether `url` is EXACTLY what {@link screenSellerOpsReturnUrl} produces — a loopback SellerOps origin on the
 * connect route, and nothing else.
 *
 * The screening function answers "what may this configured value become"; this answers "is this string already
 * that". They are different questions and the second one is what a process launcher needs: `os-open-url.ts`
 * builds an argv for the seller's real browser, so it re-establishes the property rather than trusting its caller
 * to have run the screening first.
 */
export function isSellerOpsReturnUrl(url: string): boolean {
  const screened = screenSellerOpsReturnUrl(url);
  return screened.ok && screened.url === url;
}

/** Screen a configured SellerOps app URL into the exact return destination, or refuse with a reason. */
export function screenSellerOpsReturnUrl(appUrl: string | undefined): SellerOpsReturnScreen {
  const raw = (appUrl ?? "").trim();
  if (raw === "") return { ok: false, reason: "EMPTY" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "UNPARSEABLE" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "NOT_HTTP" };
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) return { ok: false, reason: "NOT_LOOPBACK" };
  // ORIGIN ONLY. Everything else about the configured value is dropped rather than carried forward.
  return { ok: true, url: `${parsed.origin}${SELLEROPS_COUPANG_CONNECT_PATH}` };
}
