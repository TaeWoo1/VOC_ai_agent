/**
 * **How the walk hands a local SellerOps URL to the seller's OWN browser.** Pure — it decides; it spawns nothing.
 *
 * `SellerOps로 돌아가기` used to open the connect screen in the dedicated WING Chrome. That window is a fresh
 * persistent profile that has never carried a SellerOps session, so on 2026-08-12 the "return" delivered a LOGIN
 * page: the navigation happened and the promise did not. The session the seller actually has lives in the browser
 * they opened SellerOps in, which is the OS default browser, and the only way to reach it from here is to ask the
 * OS to open the URL.
 *
 * Three fences, and each is the reason a line below exists:
 *
 *  1. **The URL is re-screened HERE.** {@link screenSellerOpsReturnUrl} already fails closed, but this module is
 *     the one that builds an argv for a process launcher, so it re-establishes the property it depends on rather
 *     than trusting a caller to have done it. A string that can steer the seller's real browser — the one holding
 *     every session they have — is worth bounding twice.
 *  2. **argv, never a command line.** The plan is `{command, args}` for a direct `spawn` with no shell. There is
 *     no string concatenation anywhere in this file and no place for one to be added.
 *  3. **An unknown platform REFUSES.** A guess at how to open a URL on an unrecognized OS is a guess at what
 *     process to start on the seller's machine.
 *
 * It carries no capability of its own: on every platform the effect is "open this loopback URL", which is the
 * same thing the seller does by typing it. It cannot navigate a marketplace surface — the screening forbids any
 * non-loopback host — and it never touches the WING window, which is the point: the keys stay on screen.
 */
import { isSellerOpsReturnUrl } from "./sellerops-return-url";

/** Why a hand-off was refused. Fixed enum — it is logged, so it carries no URL, host, or path. */
export type OsOpenRefusal = "NOT_A_SELLEROPS_RETURN_URL" | "UNSUPPORTED_PLATFORM";

export type OsOpenPlan =
  | { readonly ok: true; readonly command: string; readonly args: readonly string[] }
  | { readonly ok: false; readonly reason: OsOpenRefusal };

/**
 * The per-platform launcher, as argv. Each of these is the OS's own "open this in whatever handles it" entry
 * point, so the browser that answers is the seller's default — the one their SellerOps session is in.
 *
 * `win32` goes through `cmd /c start` because `start` is a shell builtin with no executable behind it. The empty
 * `""` is `start`'s title argument: without it `start` reads the first quoted argument as a window title and
 * opens nothing. This is the one platform where an argument is parsed by something other than the target program,
 * which is why the screening above it is a hard precondition rather than a courtesy.
 */
function launcherFor(platform: NodeJS.Platform): { command: string; args: readonly string[] } | null {
  if (platform === "darwin") return { command: "open", args: [] };
  if (platform === "linux") return { command: "xdg-open", args: [] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", ""] };
  return null;
}

/**
 * Plan the hand-off of `url` to the OS default browser, or refuse with a reason.
 *
 * `platform` is a parameter rather than a read of `process.platform` so the decision is testable on every OS from
 * any OS — the same rule the recency layer follows for the clock.
 */
export function planOsOpen(url: string, platform: NodeJS.Platform): OsOpenPlan {
  if (!isSellerOpsReturnUrl(url)) return { ok: false, reason: "NOT_A_SELLEROPS_RETURN_URL" };
  const launcher = launcherFor(platform);
  if (!launcher) return { ok: false, reason: "UNSUPPORTED_PLATFORM" };
  return { ok: true, command: launcher.command, args: [...launcher.args, url] };
}
