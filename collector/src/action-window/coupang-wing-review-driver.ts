/**
 * **The 상품평 structure-discovery driver.** It counts, and that is the entire list of what it can do.
 *
 * It is its own driver for the reason the 고객문의 one is: the credential driver's design is "a value read
 * exists, behind a barrier", and this screen's design is "no value read exists at all". Putting a review census
 * on a driver that can return text would leave a text-returning terminal one method away from a page of
 * customers' reviews, and the separation is what makes that unreachable rather than merely unused.
 *
 * Nothing here clicks, types, navigates, highlights, tags, mounts, or fetches.
 */
import type { BrowserContext, Page } from "playwright";
import { log } from "../log";
import { buildReviewListCensusScript } from "./api-issuance-calibration/review-list-inpage";
import {
  sanitizeReviewListCensus,
  type ReviewDigitExpectation,
  type ReviewFrameCensus,
  type ReviewLabelExpectation,
  type ReviewListCensus,
  type ReviewTextShape,
} from "./coupang-wing-review-list";

/**
 * **The reply words — the ones this run exists to decide about.**
 *
 * Every plausible spelling is supplied at once, deliberately. The first 고객문의 calibration supplied one
 * spelling per state, came back with zero of both, and left "the wording differs" and "the scan never reached
 * the list" indistinguishable at the cost of a seated sitting. Candidates are nearly free — one more `indexOf`
 * inside the page each — and the counts come back separately, so a single run says which wording the screen
 * uses.
 *
 * `답변` is included even though it is the 고객문의 word: if Coupang runs reviews through the same vocabulary,
 * not asking would produce a false "no reply control" on a screen that has one.
 */
export const WING_REVIEW_REPLY_LABELS: readonly ReviewLabelExpectation[] = Object.freeze([
  { id: "replyTight", exactText: "답글" },
  { id: "replyWrite", exactText: "답글쓰기" },
  { id: "replyWriteSpaced", exactText: "답글 쓰기" },
  { id: "replyRegister", exactText: "답글 등록" },
  { id: "replySeller", exactText: "판매자 답글" },
  { id: "comment", exactText: "댓글" },
  { id: "answerDo", exactText: "답변하기" },
  { id: "answerRegister", exactText: "답변 등록" },
  { id: "answer", exactText: "답변" },
]);

/**
 * The field words that identify a review row. They are the anchors — with no review id to hand the page,
 * Coupang's own vocabulary is the only string we can legitimately supply.
 *
 * `구매자` / `작성자` are HEADER words we state and count. No name is ever read: what comes back is how many
 * leaves carried the word we supplied and what repeats around them.
 */
export const WING_REVIEW_FIELD_LABELS: readonly ReviewLabelExpectation[] = Object.freeze([
  { id: "rating", exactText: "평점" },
  { id: "starRating", exactText: "별점" },
  { id: "writtenAt", exactText: "작성일" },
  { id: "registeredAt", exactText: "등록일" },
  { id: "reviewWord", exactText: "상품평" },
  { id: "reviewLoan", exactText: "리뷰" },
  { id: "buyerHeader", exactText: "구매자" },
  { id: "authorHeader", exactText: "작성자" },
  { id: "productName", exactText: "상품명" },
  { id: "optionHeader", exactText: "옵션" },
  { id: "replyStateHeader", exactText: "답글여부" },
  { id: "answerStateHeader", exactText: "답변여부" },
  { id: "photoWord", exactText: "사진" },
  { id: "videoWord", exactText: "동영상" },
]);

/**
 * Text SHAPES, so a column can be identified as dates or ratings without a date or a rating crossing the
 * boundary. Patterns are ours; what comes back is which id matched and how many leaves matched it.
 */
export const WING_REVIEW_TEXT_SHAPES: readonly ReviewTextShape[] = Object.freeze([
  { id: "dateDotted", pattern: "^[0-9]{4}\\.[0-9]{1,2}\\.[0-9]{1,2}\\.?$" },
  { id: "dateDashed", pattern: "^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$" },
  { id: "dateSlashed", pattern: "^[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}$" },
  { id: "dateTime", pattern: "^[0-9]{4}[-./][0-9]{1,2}[-./][0-9]{1,2}[ T][0-9]{1,2}:[0-9]{2}" },
  { id: "ratingNumber", pattern: "^[1-5](\\.[0-9])?$" },
  { id: "ratingStars", pattern: "^[★☆]{1,5}$" },
]);

/**
 * Class-name TOKENS a star widget usually carries. Compared in-page against the class SHAPE; the class string
 * never leaves the page and only a per-unit boolean is counted.
 */
export const WING_REVIEW_CLASS_TOKENS: readonly string[] = Object.freeze([
  "star",
  "rating",
  "grade",
  "score",
]);

export interface CoupangWingReviewDriverOptions {
  readonly context?: BrowserContext;
}

const SETTLE_TIMEOUT_MS = 4000;
/** Enough for a seller-center page's embedded applications; bounded so a frame-bomb cannot make this unbounded. */
const MAX_FRAMES = 12;

/** The minimum a frame must expose for this driver. Playwright's `Frame` satisfies it; so does a test double. */
interface FrameLike {
  evaluate<T>(script: string): Promise<T>;
}

export class CoupangWingReviewDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingReviewDriverOptions;

  constructor(page: Page, opts: CoupangWingReviewDriverOptions = {}) {
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

  /** One document's reading. Safe at any point: there is no terminal here that returns text. */
  async censusReviewList(
    digits: readonly ReviewDigitExpectation[] = [],
    labels: readonly ReviewLabelExpectation[] = WING_REVIEW_FIELD_LABELS,
    replies: readonly ReviewLabelExpectation[] = WING_REVIEW_REPLY_LABELS,
    shapes: readonly ReviewTextShape[] = WING_REVIEW_TEXT_SHAPES,
  ): Promise<ReviewListCensus> {
    const page = this.activePage();
    await this.settle(page);
    const raw = await (page as unknown as { evaluate<T>(s: string): Promise<T> })
      .evaluate<unknown>(buildReviewListCensusScript(labels, replies, shapes, digits, WING_REVIEW_CLASS_TOKENS))
      .catch(() => null);
    return this.record(sanitizeReviewListCensus(raw, labels, replies, shapes));
  }

  /**
   * **The same probe, once per frame.** A seller center embeds sub-applications, and a document-wide scan of
   * the TOP document is still a scan of the wrong document when the list lives in a child frame — the same
   * class of mistake as assuming the row tag, one level up.
   *
   * Frames are identified by INDEX only; a frame URL carries the seller's own account path. A frame that
   * cannot be evaluated is skipped rather than reported as an empty reading, which would read as "the reviews
   * are not there".
   */
  async censusAllFrames(
    digits: readonly ReviewDigitExpectation[] = [],
    labels: readonly ReviewLabelExpectation[] = WING_REVIEW_FIELD_LABELS,
    replies: readonly ReviewLabelExpectation[] = WING_REVIEW_REPLY_LABELS,
    shapes: readonly ReviewTextShape[] = WING_REVIEW_TEXT_SHAPES,
  ): Promise<ReviewFrameCensus[]> {
    const page = this.activePage();
    await this.settle(page);
    const framesOf = (page as unknown as { frames?: () => FrameLike[] }).frames;
    const frames = typeof framesOf === "function" ? framesOf.call(page).slice(0, MAX_FRAMES) : [];
    const script = buildReviewListCensusScript(labels, replies, shapes, digits, WING_REVIEW_CLASS_TOKENS);
    const out: ReviewFrameCensus[] = [];
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const raw = await frames[frameIndex]!.evaluate<unknown>(script).catch(() => null);
      if (raw === null) continue;
      out.push({
        frameIndex,
        census: this.record(sanitizeReviewListCensus(raw, labels, replies, shapes), frameIndex),
      });
    }
    return out;
  }

  /** The one log line. Its alphabet is the census's own — if this could print a review, so could the census. */
  private record(census: ReviewListCensus, frameIndex?: number): ReviewListCensus {
    log("aw_coupang_review_census", {
      ...(frameIndex === undefined ? {} : { frameIndex }),
      reason: census.reason,
      elementsScanned: census.elementsScanned,
      unit: `${census.unit.level?.tagName ?? "none"}/${census.unit.unitCount}/${census.unit.labelsAgreeing}`,
      reply: census.replyAffordances.map((a) => `${a.id}=${a.interactiveCount}/${a.staticCount}`),
      labels: census.labelCounts.map((l) => `${l.id}=${l.elementCount}`),
      shapes: census.textShapes.map((s) => `${s.id}=${s.leafCount}`),
    });
    return census;
  }
}
