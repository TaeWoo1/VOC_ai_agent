/**
 * **The resident helper's half of the credential handoff — its own module, on purpose.**
 *
 * It lives here rather than in `cli/local-agent.ts` because of what that costs: the boundary sweep in
 * `test/credential/credential-value-boundary-guard.test.ts` holds every module that can touch a credential to a
 * much tighter rule than ordinary source — no filesystem, no clipboard, no storage, no direct stdout. The agent
 * entrypoint legitimately writes files (status sentinels, plists), so putting this seam inside it would have
 * meant loosening that sweep for a 2,000-line module to admit forty lines. The forty lines moved instead.
 */
import type { BrowserContext } from "playwright";
import { loadConfig } from "../config";
import { CoupangWingCredentialDriver } from "../action-window/coupang-wing-credential-driver";
import { handOffCoupangCredential } from "./coupang-credential-handoff";
import { postCoupangCredentialHandoff } from "./credential-handoff-client";
import type { CredentialHandoffSeamResult } from "../action-window/coupang-issuance/coupang-issuance-session";

/** The part of the walk's carrier this needs: the context its window lives in, or `null` when there is none. */
export interface ResidentHandoffSurface {
  activeContext: () => BrowserContext | null;
}

/**
 * **The resident helper's half of the credential handoff.**
 *
 * It is deliberately thin, and every piece of it already existed and is live-proven (2026-08-13): the WING
 * credential driver reads the three values from the page ONCE, `handOffCoupangCredential` orders the barrier and
 * the read, and the client puts them on one request. Nothing about how a credential is read, sent, stored or
 * verified is re-implemented here — this is the wiring that was missing, and only the wiring.
 *
 * **What this function does NOT do:**
 *  - it never opens a window. `activeContext()` answers `null` when there is no screen, and no screen means no
 *    read. A handoff must happen on the page the seller is looking at, or not at all;
 *  - it never holds a seller identity. The capability it is handed is a one-shot bearer for one write, bound
 *    server-side to the org, seller, account, channel and run — the helper could not act as this seller anywhere
 *    else if it tried;
 *  - it never names the account. The capability already does, and the backend refuses a request that tries.
 *
 * **The barrier is the seller's press in SellerOps**, which is what minted the capability in the first place —
 * so `confirm` is already satisfied by the time this is called, and the session refuses to call it at all unless
 * the run is resting on the credential step. The confirmation is not skipped; it happened one layer up, in the
 * only place a seller can give it.
 */
export async function runResidentCredentialHandoff(
  live: ResidentHandoffSurface,
  runId: string,
  capability: string,
): Promise<CredentialHandoffSeamResult> {
  const context = live.activeContext();
  const page = context?.pages().at(-1) ?? null;
  if (!page) {
    // Fail closed, and say which fact was missing: there is no screen to read.
    return { stored: false, reason: "HANDOFF_NO_SURFACE" };
  }
  const cfg = loadConfig();
  const driver = new CoupangWingCredentialDriver(page, { context: { pages: () => context!.pages() } });
  const record = await handOffCoupangCredential({
    // Already given, in SellerOps, by the press that minted this capability. The session will not reach here on
    // any other path — see its four refusals — so this is the confirmation being carried, not bypassed.
    confirm: async () => true,
    read: () => driver.readCredentialValues(),
    post: (secrets) =>
      postCoupangCredentialHandoff(
        cfg.baseUrl,
        { kind: "capability", id: capability },
        { kind: "seller", runId },
        "COUPANG",
        secrets,
      ),
  });
  // The record is value-free by construction; this narrows it further to what the session may know.
  return {
    stored: record.outcome === "STORED_AND_VERIFIED" || record.outcome === "STORED_NOT_VERIFIED",
    ...(record.connectionStatus ? { connectionStatus: record.connectionStatus } : {}),
    ...(record.outcome !== "STORED_AND_VERIFIED" ? { reason: record.outcome } : {}),
  };
}

