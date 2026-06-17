/**
 * Live-run approval gate — pure, no I/O and no Playwright import, so it can be
 * unit-tested offline. The discover CLI refuses EVERY live action unless the
 * operator passes the explicit approval flag: opening or navigating a live NAVER
 * seller-center session must be a deliberate, per-run decision.
 */
export const APPROVAL_FLAG = "--i-understand-this-opens-live-naver";

/** Did the operator pass the explicit live-run approval flag? */
export function hasLiveRunApproval(args: string[]): boolean {
  return args.includes(APPROVAL_FLAG);
}

/** Operator-facing refusal message shown when the approval flag is missing. */
export function approvalRequiredMessage(): string {
  return [
    "Refusing to start a LIVE NAVER run without explicit per-run approval.",
    "",
    "  - This opens or navigates a live NAVER seller-center session.",
    "  - A human must handle login / 2FA / CAPTCHA.",
    "  - No CAPTCHA/2FA bypass is allowed.",
    "  - Use only a user-owned test seller account.",
    "  - This requires explicit per-run approval.",
    "",
    "Re-run with the approval flag:",
    `  npm run discover -- --login ${APPROVAL_FLAG}`,
    `  npm run discover -- --discover ${APPROVAL_FLAG}`,
  ].join("\n");
}
