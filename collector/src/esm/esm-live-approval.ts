/**
 * ESM+ live-run approval gate — pure, no I/O and no Playwright import, so it can be
 * unit-tested offline. The ESM review-discovery CLI refuses EVERY live action unless
 * the operator passes the explicit approval flag: opening or navigating a live ESM+
 * (Gmarket / Auction) seller-center session must be a deliberate, per-run decision.
 *
 * This mirrors the NAVER `live-run-approval.ts` gate but with a DISTINCT flag, so an
 * approval for one platform can never silently authorize the other. ESM live work is
 * gated exactly like NAVER: a human performs all login / 2FA / CAPTCHA, the collector
 * never types credentials and never bypasses auth, and only a user-owned TEST seller
 * account is used.
 */
export const ESM_APPROVAL_FLAG = "--i-understand-this-opens-live-esm";

/** Did the operator pass the explicit ESM live-run approval flag? */
export function hasEsmLiveApproval(args: string[]): boolean {
  return args.includes(ESM_APPROVAL_FLAG);
}

/** Operator-facing refusal message shown when the ESM approval flag is missing. */
export function esmApprovalRequiredMessage(): string {
  return [
    "Refusing to start a LIVE ESM+ run without explicit per-run approval.",
    "",
    "  - This opens or navigates a live ESM+ (Gmarket / Auction) seller-center session.",
    "  - A human must handle login / 2FA / CAPTCHA.",
    "  - No CAPTCHA/2FA bypass is allowed.",
    "  - Use only a user-owned test seller account.",
    "  - This is a no-click classifier: it never clicks an export control, never",
    "    downloads, never uploads, and writes no status record.",
    "  - This requires explicit per-run approval.",
    "",
    "Re-run with the approval flag:",
    `  npm run classify-esm-review -- ${ESM_APPROVAL_FLAG}`,
  ].join("\n");
}
