/**
 * Live-run approval gate — pure, no I/O and no Playwright import, so it can be
 * unit-tested offline. The discover CLI refuses EVERY live action unless the
 * operator passes the explicit approval flag: opening or navigating a live NAVER
 * seller-center session must be a deliberate, per-run decision.
 */
export const APPROVAL_FLAG = "--i-understand-this-opens-live-naver";

/**
 * Classify-only (a.k.a. no-upload) mode **of the DISCOVERY CLIs**: discover/classify the export
 * mechanism WITHOUT ingesting a real seller-center export into SellerOps. This is the milestone-1
 * discovery mode — no SellerOps login, no channel resolve, no upload, and LAST_SUCCESS stays
 * structurally impossible (capture without upload is only COLLECTING). `--no-upload` is an accepted
 * alias. Crucially these paths are also **no-click**: nothing is triggered and no file is captured.
 *
 * This flag is scoped to discovery and does not transfer. The Action Window runtime has no classify
 * step — its whole purpose is a supervised human click on a real export control — so it refuses this
 * flag rather than redefining it (see {@link classifyOnlyMisuseMessage} / {@link NO_INGEST_FLAG}).
 */
export const CLASSIFY_ONLY_FLAGS = ["--classify-only", "--no-upload"] as const;

/**
 * Action Window runtime only: perform the run but DECLINE the ingest handoff — detect the download
 * and validate the artifact, then stop without uploading. The run ends CANCELLED with the downstream
 * step SKIPPED.
 *
 * ⚠ This is NOT a safety flag and is NOT `--classify-only`. It still opens live NAVER, a human still
 * performs a real export action, and a real file still lands in quarantine (validated, then dropped).
 * It is strictly MORE mutating than simply not acting. Its one purpose is exercising
 * detect + quarantine-validate against a real artifact without a database write.
 */
export const NO_INGEST_FLAG = "--no-ingest";

/** Did the operator pass the explicit live-run approval flag? */
export function hasLiveRunApproval(args: string[]): boolean {
  return args.includes(APPROVAL_FLAG);
}

/** Is this a classify-only / no-upload run (discovery, never ingestion)? */
export function isClassifyOnly(args: string[]): boolean {
  return CLASSIFY_ONLY_FLAGS.some((flag) => args.includes(flag));
}

/** Did the operator ask the Action Window runtime to decline the ingest handoff? */
export function hasNoIngest(args: string[]): boolean {
  return args.includes(NO_INGEST_FLAG);
}

/**
 * Refusal shown when a discovery classify-only flag is passed to the Action Window runtime. It must
 * CORRECT the operator's model, not merely redirect: someone reaching for `--classify-only` expects
 * "nothing happens", and `--no-ingest` is not that.
 */
export function classifyOnlyMisuseMessage(): string {
  return [
    `Refusing: ${CLASSIFY_ONLY_FLAGS.join(" / ")} is the DISCOVERY no-click mode.`,
    "",
    "  - The Action Window has no classify step. Its purpose is a supervised human",
    "    export action, so this flag has no honest meaning here and is NOT ignored.",
    "",
    `Did you mean ${NO_INGEST_FLAG}? It declines the ingest handoff — the artifact is`,
    "detected and validated, then dropped, and the run ends CANCELLED. But note it is",
    `NOT a no-click mode, and ${NO_INGEST_FLAG} is not a safety flag:`,
    "  - it still opens a live NAVER session;",
    "  - a human still performs a REAL export action on a real control;",
    "  - a real file still lands in quarantine before it is validated and dropped.",
    "",
    "For a run that is non-mutating BY CONSTRUCTION, do not act: let the download",
    "window lapse. No download means no artifact, and nothing is written anywhere.",
  ].join("\n");
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
