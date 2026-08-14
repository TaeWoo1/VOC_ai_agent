/**
 * **The 고객문의 list driver.** One method that matters, and a deliberately short list of what it can do.
 *
 * It exists as its own driver rather than a method on `CoupangWingCredentialDriver` because the two are
 * governed by opposite promises. That driver's whole design is "a value read exists, behind a barrier"; this
 * one's is "no value read exists at all". Putting the inquiry census on the credential driver would put a
 * text-returning terminal one method away from a rows-of-buyer-text page, and the separation is what makes
 * that unreachable rather than merely unused.
 *
 * Nothing here clicks, types, navigates, highlights, tags, or mounts anything. The only thing it does is count.
 */
import type { BrowserContext, Page } from "playwright";
import { log } from "../log";
import { buildInquiryListCensusScript } from "./api-issuance-calibration/inquiry-list-inpage";
import {
  sanitizeInquiryListCensus,
  type InquiryDigitExpectation,
  type InquiryFrameCensus,
  type InquiryLabelExpectation,
  type InquiryListCensus,
} from "./coupang-wing-inquiry-list";

/**
 * Coupang's own words for the two states, as fixed literals. Ours to supply, never read off the page.
 *
 * **Several spellings of each state are supplied at once, deliberately.** The first calibration supplied one
 * spelling per state and came back with zero of both on a screen the seller could see two answered inquiries
 * on — which left "the wording differs" and "the scan never reached the list" indistinguishable, at the cost of
 * a live sitting. Candidate spellings are free: each is one more `indexOf` inside the page, and the counts come
 * back separately, so one run tells us which wording the screen actually uses.
 */
export const WING_INQUIRY_STATUS_LABELS: readonly InquiryLabelExpectation[] = Object.freeze([
  { id: "answeredTight", exactText: "답변완료" },
  { id: "answeredSpaced", exactText: "답변 완료" },
  { id: "unansweredTight", exactText: "미답변" },
  { id: "unansweredSpaced", exactText: "미 답변" },
  { id: "pendingTight", exactText: "답변대기" },
  { id: "pendingSpaced", exactText: "답변 대기" },
  { id: "done", exactText: "완료" },
  { id: "waiting", exactText: "대기" },
]);

/**
 * **The column header that names where the 접수번호 is printed.**
 *
 * The seller reads an inquiry's identity off the screen as `주문문의 (158846709)`, in the column headed
 * `문의유형(접수번호)` — and that number is the same 9-digit `inquiryId` the API hands SellerOps. The attribute
 * calibration measured why it was never going to be found the other way: that screen carries no 9- or 11-digit
 * run in any `href` / `id` / `data-*` at all.
 *
 * Spacing around the parenthesis has never been measured, so both spellings are supplied at once, together with
 * the bare `접수번호` as a last resort. Supplying candidates costs one in-page comparison each; guessing one and
 * re-running live costs a seated sitting.
 */
export const WING_INQUIRY_COLUMN_HEADERS: readonly InquiryLabelExpectation[] = Object.freeze([
  { id: "typeWithNo", exactText: "문의유형(접수번호)" },
  { id: "typeWithNoSpaced", exactText: "문의유형 (접수번호)" },
  { id: "receiptNo", exactText: "접수번호" },
]);

export interface CoupangWingInquiryDriverOptions {
  readonly context?: BrowserContext;
}

const SETTLE_TIMEOUT_MS = 4000;
/** Enough for a seller-center page's embedded applications; bounded so a frame-bomb cannot make this unbounded. */
const MAX_FRAMES = 12;

/** The minimum a frame must expose for this driver. Playwright's `Frame` satisfies it; so does a test double. */
interface FrameLike {
  evaluate<T>(script: string): Promise<T>;
}

export class CoupangWingInquiryDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingInquiryDriverOptions;

  constructor(page: Page, opts: CoupangWingInquiryDriverOptions = {}) {
    this.page = page;
    this.opts = opts;
  }

  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      await p.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      /* a timeout is fine — the census fails closed on a page it cannot read */
    }
  }

  /**
   * **The value-free anchor probe.** Finds where each identifier we already hold lands in the page's
   * structural attributes, measures the repeating structure around it, and counts each fixed platform literal.
   * Safe to run at any point: there is no terminal here that returns text, so there is nothing for a
   * confirmation to gate beyond the run grant itself.
   */
  async censusInquiryList(
    digits: readonly InquiryDigitExpectation[],
    labels: readonly InquiryLabelExpectation[] = WING_INQUIRY_STATUS_LABELS,
    headers: readonly InquiryLabelExpectation[] = WING_INQUIRY_COLUMN_HEADERS,
  ): Promise<InquiryListCensus> {
    const page = this.activePage();
    await this.settle(page);
    const raw = await (page as unknown as { evaluate<T>(s: string): Promise<T> })
      .evaluate<unknown>(buildInquiryListCensusScript(digits, labels, headers))
      .catch(() => null);
    return this.record(sanitizeInquiryListCensus(raw, digits, labels, headers));
  }

  /**
   * **The same probe, once per frame.** A seller center embeds sub-applications, and a document-wide scan of
   * the TOP document is still a scan of the wrong document when the list lives in a child frame — the same
   * class of mistake as assuming the row tag, one level up.
   *
   * Frames are identified by INDEX only. A frame URL carries the seller's own account path, and a sanitized
   * record has no business holding one. A frame that cannot be evaluated (cross-origin, detached mid-scan) is
   * skipped rather than reported as an empty reading, which would read as "the list is not there".
   */
  async censusAllFrames(
    digits: readonly InquiryDigitExpectation[],
    labels: readonly InquiryLabelExpectation[] = WING_INQUIRY_STATUS_LABELS,
    headers: readonly InquiryLabelExpectation[] = WING_INQUIRY_COLUMN_HEADERS,
  ): Promise<InquiryFrameCensus[]> {
    const page = this.activePage();
    await this.settle(page);
    const framesOf = (page as unknown as { frames?: () => FrameLike[] }).frames;
    const frames = typeof framesOf === "function" ? framesOf.call(page).slice(0, MAX_FRAMES) : [];
    const script = buildInquiryListCensusScript(digits, labels, headers);
    const out: InquiryFrameCensus[] = [];
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const raw = await frames[frameIndex]!.evaluate<unknown>(script).catch(() => null);
      if (raw === null) continue;
      out.push({
        frameIndex,
        census: this.record(sanitizeInquiryListCensus(raw, digits, labels, headers), frameIndex),
      });
    }
    return out;
  }

  /** The one log line. Its alphabet is the census's own — if this could print a row, so could the census. */
  private record(census: InquiryListCensus, frameIndex?: number): InquiryListCensus {
    log("aw_coupang_inquiry_census", {
      ...(frameIndex === undefined ? {} : { frameIndex }),
      reason: census.reason,
      elementsScanned: census.elementsScanned,
      elementsWithAnchorAttributes: census.elementsWithAnchorAttributes,
      digitLengths: census.anchorDigitRunLengths.join("/"),
      matches: census.anchors.map((m) => `${m.id}=${m.matchCount}`),
      labels: census.labelCounts.map((l) => `${l.id}=${l.elementCount}`),
      column: `${census.columnProbe.reason}/${census.columnProbe.cellsInColumn}`,
      columnMatches: census.columnProbe.matches.map((m) => `${m.id}=${m.matchCount}`),
    });
    return census;
  }
}
