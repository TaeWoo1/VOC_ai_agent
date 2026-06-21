/**
 * Live REVIEW-USAGE CONSENT CONFIRM — exactly one modal-scoped `확인` click, observe-only after.
 *
 * Reached ONLY when the supervised diagnostic export click already produced
 * `outcome: REVIEW_USAGE_CONFIRMATION` AND the operator passed
 * `--diagnose-confirm-review-usage` (gated upstream by `decideReviewUsageConfirm`). It presses the
 * legal review-usage consent modal's affirmative `확인` button — the only remaining export gate —
 * and then watches, for a bounded window, whether a real download fires.
 *
 * HARD INVARIANTS:
 *   - Exactly ONE `.click(`, on a control bound by a read-only in-page scan that stamps the SINGLE
 *     affirmative button inside the VISIBLE consent modal and is re-checked with `count() === 1`.
 *     Never a global `확인`. No fallback selector, no retry. Zero-or-multiple candidates → halt.
 *   - It NEVER persists, uploads, or records status: no `saveAs`, no `uploadReviewFile`, no
 *     `writeStatus`, no `runExport`, no navigation. A download that fires is observed (sanitized)
 *     and discarded with the context.
 *   - The foreground modal is re-confirmed to still be review-usage consent before any click; a
 *     non-consent modal halts with `CONFIRM_NOT_CONSENT`, no click.
 *   - All output is sanitized via `export-click-signals` — enums / booleans / coarse buckets /
 *     salted 16-hex hashes. No raw modal/dialog/toast text, filename, URL, selector, id, or token.
 */
import { log } from "../log";
import {
  AFFIRMATIVE_MARKERS,
  CANCEL_MARKERS,
  classifyDialogMessage,
  classifyModalCategory,
  deriveConfirmOutcome,
  emptyPostClick,
  lengthBucket,
  mergePostClick,
  messageFingerprint,
  summarizePostClick,
  type ConfirmOutcome,
  type DialogMessageCategory,
  type DialogRecord,
  type MessageLengthBucket,
  type ModalCategory,
} from "./export-click-signals";
import { extensionCategory, type ExtensionCategory } from "./review-export";

/** Internal index attribute stamped on the single bound affirmative control (read-identity only). */
const STAMP_ATTR = "data-sellerops-confirm";

/** Per-`확인`-click actionability budget (matches the export safe-confirm timeout). */
const CONFIRM_CLICK_TIMEOUT_MS = 4_000;

/**
 * Visible-modal container scopes, in priority order (role/aria first, then the NAVER seller-center
 * modal classes). Plain CSS — visibility is tested in JS inside the scan (NOT a `:visible` pseudo).
 */
const MODAL_SCOPES: readonly string[] = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  ".modal-dialog",
  ".modal-content",
  ".modal-footer",
  ".seller-btn-area",
];

/** Minimal structural surface of a Playwright locator the confirm step touches. */
export interface ConfirmLocator {
  count(): Promise<number>;
  click(opts?: { timeout?: number }): Promise<void>;
}

/** Minimal structural surface of the Playwright page the confirm step touches. */
export interface ConfirmPage {
  content(): Promise<string>;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  locator(selector: string): ConfirmLocator;
  on(event: "dialog", handler: (dialog: ConfirmDialog) => void): void;
  waitForEvent(event: "download", opts?: { timeout?: number }): Promise<ConfirmDownload>;
}

/** Minimal structural surface of the browser context (popup/new-page observation). */
export interface ConfirmContext {
  on(event: "page", handler: (page: unknown) => void): void;
}

/** Minimal structural surface of a native dialog. */
export interface ConfirmDialog {
  type(): string;
  message(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

/** Minimal structural surface of a download event — we read only the suggested name. */
export interface ConfirmDownload {
  suggestedFilename(): string;
}

export interface ConfirmDeps {
  /** Total observe window after the click. */
  observeWindowMs: number;
  /** Re-read cadence within the window. */
  pollIntervalMs: number;
  /** Salt for the sanitized message/filename hashes (shared `STORAGE_PROBE_SALT`). */
  salt?: string;
  /** Bounded SPA settle before each read (e.g. `waitForSpaHydration`). */
  settleFn: (page: ConfirmPage) => Promise<unknown>;
  /** Injectable sleep so tests run without real timers. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Sanitized observation of a download that fired — filename is hashed, never echoed. */
export interface ConfirmDownloadRecord {
  fired: true;
  extensionCategory: ExtensionCategory;
  filenameLengthBucket: MessageLengthBucket;
  filenameHash: string;
}

/** How the single affirmative control was (or wasn't) bound before any click. */
export type ConfirmBind = "BOUND" | "CONFIRM_NOT_CONSENT" | "CONFIRM_NOT_FOUND" | "CONFIRM_NOT_UNIQUE";

/** The ONLY shape the confirm step contributes to the report. Every leaf is non-sensitive. */
export interface ReviewUsageConfirmResult {
  confirmBind: ConfirmBind;
  confirmClicked: boolean;
  confirmClickedCount: 0 | 1;
  confirmOutcome: ConfirmOutcome;
  modalDisappeared: boolean;
  followUpModalCategory: ModalCategory | null;
  postConfirmDownloadFired: boolean;
  postConfirmAsyncJob: boolean;
  postConfirmToastPresent: boolean;
  postConfirmDialogCategory: DialogMessageCategory | "none";
  postConfirmPopupOpened: boolean;
  postConfirmChecks: number;
  download?: ConfirmDownloadRecord;
  detail: string;
}

/** Exact top-level key allow-list — used by the offline no-leak test. */
export const REVIEW_USAGE_CONFIRM_KEYS: ReadonlyArray<keyof ReviewUsageConfirmResult> = [
  "confirmBind",
  "confirmClicked",
  "confirmClickedCount",
  "confirmOutcome",
  "modalDisappeared",
  "followUpModalCategory",
  "postConfirmDownloadFired",
  "postConfirmAsyncJob",
  "postConfirmToastPresent",
  "postConfirmDialogCategory",
  "postConfirmPopupOpened",
  "postConfirmChecks",
  "download",
  "detail",
];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ScanArg {
  affirmative: { source: string; flags: string }[];
  cancel: { source: string; flags: string }[];
  scopes: string[];
  stampAttr: string;
}

/**
 * READ-ONLY in-page scan (runs in the browser): find the FIRST visible modal container among the
 * scopes, enumerate its visible+enabled buttons, and select the AFFIRMATIVE one (accessible name
 * matches an affirmative marker and NOT a cancel marker). If EXACTLY ONE matches, stamp it with the
 * index attribute. Returns the match count only — never text, selectors, or nodes. Cancel exclusion
 * wins. Scoped to the modal container; never the whole document.
 */
function scanForAffirmative(arg: ScanArg): number {
  const aff = arg.affirmative.map((m) => new RegExp(m.source, m.flags));
  const can = arg.cancel.map((m) => new RegExp(m.source, m.flags));
  const visible = (el: Element): boolean => {
    const he = el as HTMLElement;
    return he.offsetParent !== null || he.getClientRects().length > 0;
  };
  let container: Element | null = null;
  for (const sel of arg.scopes) {
    const nodes = Array.from(document.querySelectorAll(sel));
    for (const n of nodes) {
      if (visible(n)) {
        container = n;
        break;
      }
    }
    if (container) break;
  }
  if (!container) return 0;
  const buttons = Array.from(
    container.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]'),
  );
  const matches: Element[] = [];
  for (const el of buttons) {
    if (!visible(el)) continue;
    const ariaDisabled = el.getAttribute("aria-disabled") === "true";
    if ((el as HTMLButtonElement).disabled || ariaDisabled) continue;
    const label = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${
      (el as HTMLInputElement).value ?? ""
    }`;
    if (can.some((re) => re.test(label))) continue; // cancel/close exclusion wins
    if (!aff.some((re) => re.test(label))) continue;
    matches.push(el);
  }
  const only = matches[0];
  if (matches.length === 1 && only) only.setAttribute(arg.stampAttr, "0");
  return matches.length;
}

/** Bind the single affirmative control inside the visible consent modal, or report why not. */
async function bindAffirmative(page: ConfirmPage): Promise<ConfirmBind> {
  const arg: ScanArg = {
    affirmative: AFFIRMATIVE_MARKERS.map((m) => ({ source: m.source, flags: m.flags })),
    cancel: CANCEL_MARKERS.map((m) => ({ source: m.source, flags: m.flags })),
    scopes: [...MODAL_SCOPES],
    stampAttr: STAMP_ATTR,
  };
  const scanned = await page.evaluate(scanForAffirmative, arg);
  if (scanned === 0) return "CONFIRM_NOT_FOUND";
  if (scanned > 1) return "CONFIRM_NOT_UNIQUE";
  // Re-confirm the stamp resolves to exactly one element before trusting it for the click.
  const resolved = await page.locator(`[${STAMP_ATTR}="0"]`).count();
  if (resolved === 0) return "CONFIRM_NOT_FOUND";
  if (resolved > 1) return "CONFIRM_NOT_UNIQUE";
  return "BOUND";
}

/** A no-click result (bind failed / not consent) — every observation field is its inert default. */
function haltResult(bind: ConfirmBind): ReviewUsageConfirmResult {
  return {
    confirmBind: bind,
    confirmClicked: false,
    confirmClickedCount: 0,
    confirmOutcome: "NO_CHANGE",
    modalDisappeared: false,
    followUpModalCategory: null,
    postConfirmDownloadFired: false,
    postConfirmAsyncJob: false,
    postConfirmToastPresent: false,
    postConfirmDialogCategory: "none",
    postConfirmPopupOpened: false,
    postConfirmChecks: 0,
    detail: `confirm: bind=${bind}; no click`,
  };
}

/**
 * Live: re-confirm the consent modal, bind its single affirmative `확인`, click it ONCE, then
 * observe (sanitized) whether a download / follow-up modal / dialog / toast / popup results. See the
 * module doc for the invariants. The caller must already have `decideReviewUsageConfirm === ATTEMPT`.
 */
export async function confirmReviewUsageOnce(
  page: ConfirmPage,
  ctx: ConfirmContext,
  deps: ConfirmDeps,
): Promise<ReviewUsageConfirmResult> {
  const { observeWindowMs, pollIntervalMs, salt, settleFn, sleepFn = defaultSleep } = deps;

  // 1) Re-confirm the FOREGROUND modal is still the review-usage consent — never confirm anything else.
  const preHtml = await page.content();
  if (classifyModalCategory(preHtml) !== "review_usage_confirmation") {
    return haltResult("CONFIRM_NOT_CONSENT");
  }

  // 2) Bind exactly one modal-scoped affirmative control, or halt without clicking.
  const bind = await bindAffirmative(page);
  if (bind !== "BOUND") return haltResult(bind);

  // 3) Observers set up BEFORE the click (the export-click observers are already released).
  let dialog: DialogRecord | undefined;
  page.on("dialog", (d: ConfirmDialog): void => {
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

  let popupOpened = false;
  ctx.on("page", (): void => {
    popupOpened = true;
  });

  let downloadFired = false;
  let download: ConfirmDownloadRecord | undefined;
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

  // 4) The single 확인 click — exactly once, no fallback, no retry.
  let clicked = false;
  try {
    await page.locator(`[${STAMP_ATTR}="0"]`).click({ timeout: CONFIRM_CLICK_TIMEOUT_MS });
    clicked = true;
  } catch {
    // The bound control did not resolve to an actionable click; we still observe.
  }

  // 5) Slow, repeated read of the post-confirm structure for the bounded window.
  let post = emptyPostClick();
  let lastModalCategory: ModalCategory | null = "review_usage_confirmation";
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
    if (html) {
      post = mergePostClick(post, summarizePostClick(html));
      lastModalCategory = classifyModalCategory(html);
    }
    if (downloadFired) break; // got the definitive answer
    if (i + 1 < maxChecks) await sleepFn(pollIntervalMs);
  }
  await downloadPromise; // ensure the download wait has settled before returning

  // 6) Derive the single outcome. The consent modal is "gone" if the latest read is not consent;
  //    a NEW non-consent modal is the actionable follow-up.
  const modalDisappeared = lastModalCategory !== "review_usage_confirmation";
  const followUpModalCategory =
    lastModalCategory !== null && lastModalCategory !== "review_usage_confirmation" ? lastModalCategory : null;
  const confirmOutcome = deriveConfirmOutcome({
    downloadFired,
    dialogPresent: dialog !== undefined,
    modalDisappeared,
    followUpModalCategory,
    asyncJobMarkerPresent: post.asyncJobMarkerPresent,
  });

  log("confirm.review-usage", {
    bind,
    clicked: clicked ? 1 : 0,
    checks,
    confirmOutcome,
    modalDisappeared,
    followUpModalCategory: followUpModalCategory ?? "none",
    downloadFired,
    asyncJobMarkerPresent: post.asyncJobMarkerPresent,
    popupOpened,
    dialogType: dialog?.type ?? "none",
  });

  return {
    confirmBind: bind,
    confirmClicked: clicked,
    confirmClickedCount: clicked ? 1 : 0,
    confirmOutcome,
    modalDisappeared,
    followUpModalCategory,
    postConfirmDownloadFired: downloadFired,
    postConfirmAsyncJob: post.asyncJobMarkerPresent,
    postConfirmToastPresent: post.toastPresent,
    postConfirmDialogCategory: dialog?.messageCategory ?? "none",
    postConfirmPopupOpened: popupOpened,
    postConfirmChecks: checks,
    download,
    detail: `confirm: clicked=${clicked ? 1 : 0} outcome=${confirmOutcome}`,
  };
}
