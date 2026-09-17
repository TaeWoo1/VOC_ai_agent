/**
 * **The helper's side of the unattended NAVER Seller Center 리뷰 read: read the screen's period, hand the rows to
 * the backend for the job this helper holds, report a closed token.**
 *
 * The loopback runner (`fixture-observe-runner.ts`) states what an unattended loop must not be able to do, and this
 * file inherits all of it:
 *
 *  - **it cannot be told where to go.** The recipe NAME resolves here to `NAVER_REVIEW_READ_WORKFLOW`, whose one
 *    route is screened by parsing before a tab opens. No field on the wire can name another.
 *  - **it cannot be told what to do.** No prompt, script or step list is on the wire. The program is built here
 *    from the frozen runtime and this repository's own page scripts: no click, no keystroke, no download, no reply.
 *  - **it cannot prove its own store.** The store is judged by the backend at delivery, against the organisation's
 *    own catalogue. The helper is never handed what it would be compared with.
 *  - **it cannot invent an empty store.** A signed-out browser, a page that did not settle, a period that is not
 *    current, a row this file does not understand, or a delivery that did not land all report a failure token with
 *    no count. The count it does report is the rows it read AND the backend accepted.
 *
 * **Coverage is stated, not assumed.** The range census (live-proven on the reply lane) reduces the screen's period
 * to day offsets. The read is accepted only when the period ends today and every row sits inside it; the period's
 * length travels to the backend as the bound this read covered.
 */
import { createHash } from "node:crypto";
import {
  NAVER_REVIEW_MAX_ROWS,
  type NaverReviewReadReason,
} from "../naver/review-list-observe-inpage";
import { parseRangeCensus } from "../action-window/reply-submission/review-list-range-inpage";
import { log } from "../log";
import { AsideNaverReviewExecutor, kstCivilDate } from "./naver-review-executor";
import { NAVER_REVIEW_READ_WORKFLOW, validateNaverReviewWorkflow } from "./naver-review-workflow";

export const NAVER_REVIEW_OBSERVE_RECIPE_ID = "NAVER_REVIEW_OBSERVE_V1" as const;

export type NaverObserveOutcome =
  | "OBSERVED"
  | "SURFACE_UNREADABLE"
  | "EXECUTOR_UNAVAILABLE"
  | "REFUSED"
  | "AUTH_REQUIRED"
  | "STORE_UNRESOLVED";

export interface NaverObserveResult {
  readonly outcome: NaverObserveOutcome;
  readonly observedCount: number | null;
  readonly contentDigest: string | null;
}

/** One row exactly as the backend accepts it. Eight named fields; there is no field for the buyer. */
export interface NaverObservedReview {
  readonly reviewId: string;
  readonly createdAt: string;
  readonly rating: number;
  readonly body: string;
  readonly productNo: string;
  readonly productName: string | null;
  readonly answered: boolean;
  readonly attachCount: number;
}

export interface NaverDeliveryRequest {
  readonly reviews: readonly NaverObservedReview[];
  readonly windowDays: number;
}

export interface NaverDeliveryResponse {
  readonly identityVerdict: string;
  readonly received: number;
  readonly inserted: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failed: number;
}

export interface NaverObserveDeps {
  /** Hand the reading in for the job this helper holds. `null` = the delivery did not land. */
  readonly deliver: (request: NaverDeliveryRequest) => Promise<NaverDeliveryResponse | null>;
  readonly executor?: Pick<AsideNaverReviewExecutor, "execute" | "asOf">;
  readonly asideCli?: string;
  readonly asideAccount?: string;
}

const REVIEW_ID = /^\d{10}$/;
const PRODUCT_NO = /^\d{1,20}$/;
const MAX_BODY = 5000;

/** SHA-256 of the review ids read, sorted. Ids only — never a body, a product or a date. */
export function digestOfReviewIds(reviews: readonly NaverObservedReview[]): string {
  return createHash("sha256").update(reviews.map((r) => r.reviewId).sort().join("\n"), "utf8").digest("hex");
}

/** Whole days between a row's KST calendar date and the run's KST calendar date, or null if unparseable. */
export function kstDaysBefore(createdAt: string, asOf: Date): number | null {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  const row = kstCivilDate(new Date(t));
  const today = kstCivilDate(asOf);
  return Math.round(
    (Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(row.year, row.month - 1, row.day)) / 86_400_000,
  );
}

/**
 * The page is untrusted input. Every row must be one this file fully understands, or none is kept: half a page
 * delivered is indistinguishable from a whole one once it is stored.
 */
export function sanitizeNaverReading(raw: unknown): { ok: true; reviews: NaverObservedReview[] } | { ok: false; reason: string } {
  if (raw === null || typeof raw !== "object") return { ok: false, reason: "READING_SHAPE" };
  const r = raw as Record<string, unknown>;
  const reason = r["reason"] as NaverReviewReadReason | undefined;
  if (reason !== "OK") return { ok: false, reason: typeof reason === "string" ? reason : "READING_SHAPE" };
  const rows = r["rows"];
  if (!Array.isArray(rows) || rows.length > NAVER_REVIEW_MAX_ROWS) return { ok: false, reason: "READING_SHAPE" };
  if (typeof r["rowCount"] !== "number" || r["rowCount"] !== rows.length) return { ok: false, reason: "ROW_COUNT_DISAGREES" };
  const seen = new Set<string>();
  const out: NaverObservedReview[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") return { ok: false, reason: "ROW_SHAPE" };
    const x = row as Record<string, unknown>;
    const reviewId = x["reviewId"];
    const createdAt = x["createdAt"];
    const rating = x["rating"];
    const body = x["body"];
    const productNo = x["productNo"];
    const productName = x["productName"];
    const answered = x["answered"];
    const attachCount = x["attachCount"];
    if (typeof reviewId !== "string" || !REVIEW_ID.test(reviewId) || seen.has(reviewId)) return { ok: false, reason: "ROW_ID" };
    if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) return { ok: false, reason: "ROW_DATE" };
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, reason: "ROW_RATING" };
    if (typeof body !== "string" || body.length > MAX_BODY) return { ok: false, reason: "ROW_BODY" };
    if (typeof productNo !== "string" || !PRODUCT_NO.test(productNo)) return { ok: false, reason: "ROW_PRODUCT" };
    if (productName !== null && typeof productName !== "string") return { ok: false, reason: "ROW_PRODUCT" };
    if (typeof answered !== "boolean") return { ok: false, reason: "ROW_ANSWERED" };
    if (typeof attachCount !== "number" || !Number.isInteger(attachCount) || attachCount < 0 || attachCount > 50) {
      return { ok: false, reason: "ROW_ATTACH" };
    }
    seen.add(reviewId);
    out.push({
      reviewId,
      createdAt,
      rating,
      body,
      productNo,
      productName: typeof productName === "string" ? productName.slice(0, 255) : null,
      answered,
      attachCount,
    });
  }
  return { ok: true, reviews: out };
}

/**
 * Run one unattended NAVER review observation. Never throws — an unattended loop that can throw is one that stops.
 */
export async function runNaverReviewObservation(deps: NaverObserveDeps): Promise<NaverObserveResult> {
  const none = (outcome: NaverObserveOutcome): NaverObserveResult => ({ outcome, observedCount: null, contentDigest: null });
  if (validateNaverReviewWorkflow(NAVER_REVIEW_READ_WORKFLOW).length > 0) {
    log("aside_naver_review_refused", { reason: "WORKFLOW_INVALID" }, "warn");
    return none("REFUSED");
  }
  let executor: Pick<AsideNaverReviewExecutor, "execute" | "asOf">;
  try {
    executor = deps.executor
      ?? new AsideNaverReviewExecutor({
        cli: {
          ...(deps.asideCli ? { command: deps.asideCli } : {}),
          ...(deps.asideAccount ? { account: deps.asideAccount } : {}),
        },
      });
  } catch {
    return none("REFUSED");
  }

  let execution;
  try {
    execution = await executor.execute();
  } catch {
    return none("EXECUTOR_UNAVAILABLE");
  }
  if (execution.kind === "UNAVAILABLE") {
    log("aside_naver_review_read", { ok: false, code: "EXECUTOR_UNAVAILABLE", llmCalls: 0 });
    return none("EXECUTOR_UNAVAILABLE");
  }
  const result = execution.result;
  if (!result.ok) {
    const outcome: NaverObserveOutcome = result.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "SURFACE_UNREADABLE";
    log("aside_naver_review_read", { ok: false, code: result.code, stage: result.stage, reason: result.reason, llmCalls: 0, outcome });
    return none(outcome);
  }

  const reading = sanitizeNaverReading(result.reading);
  if (!reading.ok) {
    log("aside_naver_review_read", { ok: false, code: "READING_REFUSED", reason: reading.reason, llmCalls: 0 });
    return none("SURFACE_UNREADABLE");
  }
  // The period. Accepted only when it ends today and both ends were read — a stale or unread period is a bound
  // nobody could state, and a count under it would claim a coverage it does not have.
  const range = parseRangeCensus(result.range);
  if (range.valuesParsed < 2 || range.endDaysBefore !== 0 || range.startDaysBefore < 0 || range.startDaysBefore > 365) {
    log("aside_naver_review_read", {
      ok: false, code: "RANGE_NOT_CURRENT", valuesParsed: range.valuesParsed,
      startDaysBefore: range.startDaysBefore, endDaysBefore: range.endDaysBefore, llmCalls: 0,
    });
    return none("SURFACE_UNREADABLE");
  }
  const asOf = executor.asOf();
  const outside = reading.reviews.filter((r) => {
    const d = kstDaysBefore(r.createdAt, asOf);
    return d === null || d < 0 || d > range.startDaysBefore;
  }).length;
  if (outside > 0) {
    log("aside_naver_review_read", { ok: false, code: "ROWS_OUTSIDE_PERIOD", outside, llmCalls: 0 });
    return none("SURFACE_UNREADABLE");
  }
  const windowDays = range.startDaysBefore + 1;

  let delivered: NaverDeliveryResponse | null;
  try {
    delivered = await deps.deliver({ reviews: reading.reviews, windowDays });
  } catch {
    delivered = null;
  }
  if (delivered === null) {
    log("aside_naver_review_delivery", { ok: false, reason: "NOT_DELIVERED" }, "warn");
    return none("EXECUTOR_UNAVAILABLE");
  }
  if (delivered.identityVerdict !== "MATCH") {
    log("aside_naver_review_delivery", { ok: false, identity: delivered.identityVerdict, received: delivered.received });
    return none("STORE_UNRESOLVED");
  }
  log("aside_naver_review_read", {
    ok: true,
    rows: reading.reviews.length,
    windowDays,
    identity: delivered.identityVerdict,
    received: delivered.received,
    inserted: delivered.inserted,
    changed: delivered.changed,
    skipped: delivered.skipped,
    failed: delivered.failed,
    llmCalls: 0,
    durationMs: result.elapsedMs,
  });
  return {
    outcome: "OBSERVED",
    observedCount: reading.reviews.length,
    contentDigest: digestOfReviewIds(reading.reviews),
  };
}
