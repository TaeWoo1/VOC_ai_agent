/**
 * Live-run approval gate — pure, no I/O and no Playwright import, so it can be
 * unit-tested offline. The discover CLI refuses EVERY live action unless the
 * operator passes the explicit approval flag: opening or navigating a live NAVER
 * seller-center session must be a deliberate, per-run decision.
 */
export const APPROVAL_FLAG = "--i-understand-this-opens-live-naver";

/**
 * Classify-only (a.k.a. no-upload) mode: discover/classify the export mechanism
 * WITHOUT ingesting a real seller-center export into SellerOps. This is the
 * milestone-1 discovery mode — no SellerOps login, no channel resolve, no upload,
 * and LAST_SUCCESS stays structurally impossible (capture without upload is only
 * COLLECTING). `--no-upload` is an accepted alias.
 */
export const CLASSIFY_ONLY_FLAGS = ["--classify-only", "--no-upload"] as const;

/** Did the operator pass the explicit live-run approval flag? */
export function hasLiveRunApproval(args: string[]): boolean {
  return args.includes(APPROVAL_FLAG);
}

/** Is this a classify-only / no-upload run (discovery, never ingestion)? */
export function isClassifyOnly(args: string[]): boolean {
  return CLASSIFY_ONLY_FLAGS.some((flag) => args.includes(flag));
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
