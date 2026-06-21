/**
 * Live EXPORT-CLICK DIAGNOSTIC — observe-only, exactly one click, never collects.
 *
 * Reached ONLY past the existing `decideCaptureGate` (the same single-control sync
 * gate the real capture uses), this performs the SAME one export click and then
 * watches — slowly, for a bounded window — what it produced: a native dialog, a
 * confirmation / date-range modal, a toast, an async-job notice, a popup, a delayed
 * download, or nothing. It answers WHY the live capture click yielded no download,
 * from observed structure (per `CLAUDE.md §6`), instead of guess-tuning a timeout.
 *
 * HARD INVARIANTS:
 *   - Exactly ONE `page.click` (the gate-approved single trigger). No fallback
 *     selector, no second click.
 *   - It NEVER persists, uploads, or records status: no `saveAs`, no
 *     `uploadReviewFile`, no `writeStatus`, no `runExport`, no navigation. A download
 *     that fires is observed (sanitized) and discarded with the context.
 *   - All output is sanitized via `export-click-signals` — enums / booleans / coarse
 *     buckets / salted 16-hex hashes. No raw dialog/toast text, filename, URL,
 *     selector, id, or token ever leaves this module.
 *   - A native dialog is handled to keep observing: alerts are accepted, everything
 *     else is dismissed (the safe non-action). Only its sanitized fields are kept.
 */
import { log } from "../log";
import {
  deriveExportClickOutcome,
  diagnosePreClickSignals,
  emptyPostClick,
  lengthBucket,
  classifyDialogMessage,
  mergePostClick,
  messageFingerprint,
  summarizePostClick,
  type DialogRecord,
  type ExportClickOutcome,
  type MessageLengthBucket,
  type PostClickSignals,
  type PreClickSignals,
} from "./export-click-signals";
import { buildTriggerSelectors, extensionCategory, type ExtensionCategory } from "./review-export";

/** Minimal structural surface of the Playwright page the diagnostic touches. */
export interface DiagPage {
  content(): Promise<string>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  on(event: "dialog", handler: (dialog: DiagDialog) => void): void;
  waitForEvent(event: "download", opts?: { timeout?: number }): Promise<DiagDownload>;
}

/** Minimal structural surface of the browser context (for popup/new-page observation). */
export interface DiagContext {
  on(event: "page", handler: (page: unknown) => void): void;
}

/** Minimal structural surface of a native dialog. */
export interface DiagDialog {
  type(): string;
  message(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

/** Minimal structural surface of a download event — we read only the suggested name. */
export interface DiagDownload {
  suggestedFilename(): string;
}

export interface DiagnoseDeps {
  /** Total observe window after the click (e.g. 30–60s). */
  observeWindowMs: number;
  /** Re-read cadence within the window. */
  pollIntervalMs: number;
  /** Per-click actionability budget. */
  clickTimeoutMs: number;
  /** Salt for the sanitized message/filename hashes (shared `STORAGE_PROBE_SALT`). */
  salt?: string;
  /** Bounded SPA settle before each read (e.g. `waitForSpaHydration`). */
  settleFn: (page: DiagPage) => Promise<unknown>;
  /** Injectable sleep so tests run without real timers. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Sanitized observation of a download that fired — filename is hashed, never echoed. */
export interface DiagDownloadRecord {
  fired: true;
  extensionCategory: ExtensionCategory;
  filenameLengthBucket: MessageLengthBucket;
  filenameHash: string;
}

/** The ONLY shape ever printed by the diagnostic. Every leaf is non-sensitive. */
export interface ExportClickDiagnosis {
  clicked: boolean;
  clickedCount: 0 | 1;
  preClick: PreClickSignals;
  outcome: ExportClickOutcome;
  download?: DiagDownloadRecord;
  dialog?: DialogRecord;
  modalCategory: PostClickSignals["modalCategory"];
  toastPresent: boolean;
  asyncJobMarkerPresent: boolean;
  dateRangeRequired: boolean;
  popupOpened: boolean;
  observeChecks: number;
  detail: string;
}

/** Exact top-level key allow-list — used by the offline no-leak test. */
export const EXPORT_CLICK_DIAGNOSIS_KEYS: ReadonlyArray<keyof ExportClickDiagnosis> = [
  "clicked",
  "clickedCount",
  "preClick",
  "outcome",
  "download",
  "dialog",
  "modalCategory",
  "toastPresent",
  "asyncJobMarkerPresent",
  "dateRangeRequired",
  "popupOpened",
  "observeChecks",
  "detail",
];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Live: click the single gate-approved export trigger ONCE, then observe (sanitized)
 * what it produced for a bounded window. See the module doc for the invariants. The
 * caller must already have confirmed `decideCaptureGate(...).proceed === true`.
 */
export async function diagnoseExportClickOnce(
  page: DiagPage,
  ctx: DiagContext,
  deps: DiagnoseDeps,
): Promise<ExportClickDiagnosis> {
  const { observeWindowMs, pollIntervalMs, clickTimeoutMs, salt, settleFn, sleepFn = defaultSleep } = deps;

  const preHtml = await page.content();
  const preClick = diagnosePreClickSignals(preHtml);

  // The gate already proved a single unambiguous control; re-derive it here and refuse
  // to click on anything but exactly one (mirrors runExport's strictSingleCandidate).
  const selectors = buildTriggerSelectors(preHtml);
  if (selectors.length !== 1) {
    return {
      clicked: false,
      clickedCount: 0,
      preClick,
      outcome: "NO_OP",
      modalCategory: null,
      toastPresent: false,
      asyncJobMarkerPresent: false,
      dateRangeRequired: false,
      popupOpened: false,
      observeChecks: 0,
      detail: "diagnose: not a single unambiguous control; no click",
    };
  }
  const selector = selectors[0] as string;

  // Observer 1: native dialogs. Record only sanitized fields, then handle to keep
  // observing — alerts accepted (only an OK), confirm/prompt/beforeunload dismissed
  // (the safe non-action). First dialog wins; later ones are still safely handled.
  let dialog: DialogRecord | undefined;
  page.on("dialog", (d: DiagDialog): void => {
    const type = d.type();
    const message = d.message();
    if (!dialog) {
      dialog = {
        type,
        messageCategory: classifyDialogMessage(message),
        messageLengthBucket: lengthBucket(message.length),
        messageHash: messageFingerprint(salt, message),
        action: type === "alert" ? "accepted" : "dismissed",
      };
    }
    void (type === "alert" ? d.accept() : d.dismiss()).catch(() => undefined);
  });

  // Observer 2: popups / new pages.
  let popupOpened = false;
  ctx.on("page", (): void => {
    popupOpened = true;
  });

  // Observer 3: a download (possibly delayed). Bound to the observe window; we read
  // ONLY the suggested filename (hashed) and never saveAs — the temp artifact is
  // discarded with the context.
  let downloadFired = false;
  let download: DiagDownloadRecord | undefined;
  const downloadPromise = page
    .waitForEvent("download", { timeout: observeWindowMs })
    .then((d) => {
      downloadFired = true;
      const name = d.suggestedFilename();
      download = {
        fired: true,
        extensionCategory: extensionCategory(name),
        filenameLengthBucket: lengthBucket(name.length),
        filenameHash: messageFingerprint(salt, name),
      };
    })
    .catch(() => undefined);

  // The single click.
  let clicked = false;
  try {
    await page.click(selector, { timeout: clickTimeoutMs });
    clicked = true;
  } catch {
    // The single trigger did not resolve to an actionable control; we still observe.
  }

  // Slow, repeated read of the post-click structure for the bounded window.
  let post = emptyPostClick();
  let checks = 0;
  const maxChecks = Math.max(1, Math.ceil(observeWindowMs / pollIntervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    checks += 1;
    try {
      await settleFn(page);
    } catch {
      // Mid-navigation settle failure — keep observing.
    }
    let html = "";
    try {
      html = await page.content();
    } catch {
      // Transient read during a re-render — skip this snapshot.
    }
    if (html) post = mergePostClick(post, summarizePostClick(html));
    if (downloadFired) break; // got the definitive answer
    if (i + 1 < maxChecks) await sleepFn(pollIntervalMs);
  }
  await downloadPromise; // ensure the download wait has settled before returning

  const outcome = deriveExportClickOutcome({
    downloadFired,
    dialogPresent: dialog !== undefined,
    post,
    popupOpened,
  });

  log("diagnose.export-click", {
    outcome,
    clicked: clicked ? 1 : 0,
    checks,
    modalCategory: post.modalCategory ?? "none",
    toastPresent: post.toastPresent,
    asyncJobMarkerPresent: post.asyncJobMarkerPresent,
    dateRangeRequired: post.dateRangeRequired,
    popupOpened,
    dialogType: dialog?.type ?? "none",
    downloadFired,
  });

  return {
    clicked,
    clickedCount: clicked ? 1 : 0,
    preClick,
    outcome,
    download,
    dialog,
    modalCategory: post.modalCategory,
    toastPresent: post.toastPresent,
    asyncJobMarkerPresent: post.asyncJobMarkerPresent,
    dateRangeRequired: post.dateRangeRequired,
    popupOpened,
    observeChecks: checks,
    detail: `diagnose: clicked=${clicked ? 1 : 0} outcome=${outcome}`,
  };
}
