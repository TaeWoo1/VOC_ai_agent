/**
 * ESM+ REVIEW upload-consent gate — pure, no I/O and no Playwright import, so it can be
 * unit-tested offline. This is a SECOND, DISTINCT approval from `esm-live-approval.ts`
 * (`--i-understand-this-opens-live-esm`): opening a live ESM+ session and UPLOADING a
 * captured export to the backend are separate decisions, so uploading requires its own
 * explicit per-run flag on top of the live-session flag.
 *
 * The upload leg is materially higher-consequence than the observe-only capture: it INGESTS
 * the captured review rows into the SellerOps backend DB (via the existing `/api/uploads`
 * path, idempotent through the content-hash dedup). It is therefore gated behind this
 * dedicated flag so that a live-session approval can never silently authorize a backend
 * write. The collector still never types credentials and never bypasses login / 2FA / CAPTCHA.
 */
export const ESM_UPLOAD_FLAG = "--i-understand-this-uploads-esm-review-to-backend";

/** Did the operator pass the explicit ESM upload-consent flag (on top of the live flag)? */
export function hasEsmUploadApproval(args: string[]): boolean {
  return args.includes(ESM_UPLOAD_FLAG);
}

/** Operator-facing refusal message shown when the ESM upload-consent flag is missing. */
export function esmUploadApprovalRequiredMessage(): string {
  return [
    "Refusing to UPLOAD a captured ESM+ REVIEW export without explicit per-run consent.",
    "",
    "  - This is separate from opening a live ESM+ session; it INGESTS the captured review",
    "    rows into the SellerOps backend DB via the existing /api/uploads path.",
    "  - The backend ingest is idempotent (content-hash dedup), but it is a real DB write.",
    "  - It runs ONLY after a supervised single-click capture produces a structurally-valid",
    "    .xlsx, and the raw file is deleted after upload (delete-after-validate).",
    "  - Both the live-session flag AND this upload-consent flag are required per run.",
    "",
    "Re-run with BOTH approval flags:",
    "  npm run capture-esm-review-upload -- \\",
    "    --i-understand-this-opens-live-esm \\",
    `    ${ESM_UPLOAD_FLAG} --approved-index <N>`,
  ].join("\n");
}
