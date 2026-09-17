/**
 * **The helper's side of the unattended NAVER Seller Center 상품 문의 read: read the newest page, hand the rows to the
 * backend for the job this helper holds, report a closed token.**
 *
 * It inherits every rule the review runner (`naver-review-observe-runner.ts`) states:
 *
 *  - **it cannot be told where to go.** The recipe NAME resolves here to `NAVER_PRODUCT_INQUIRY_READ_WORKFLOW`, whose
 *    one route is screened by parsing before a tab opens.
 *  - **it cannot be told what to do.** The program is the frozen NAVER runtime plus this repository's own page
 *    scripts: no click, no keystroke, no scroll, no download, no reply, no model call.
 *  - **it cannot prove its own store, or its own coverage.** Both are judged by the backend at delivery — the store
 *    against the organisation's catalogue, the coverage against what was already stored. The helper is handed
 *    neither.
 *  - **it cannot invent an empty store.** A sign-in wall, a list that did not settle, a period that does not end
 *    today, a row outside the period, a row this file does not understand, or a delivery that did not land all
 *    report a failure token with no count.
 */
import { createHash } from "node:crypto";
import {
  NAVER_PRODUCT_INQUIRY_MAX_ROWS,
  type NaverProductInquiryReadReason,
} from "../naver/product-inquiry-list-observe-inpage";
import { log } from "../log";
import { AsideNaverProductInquiryExecutor } from "./naver-product-inquiry-executor";
import { kstCivilDate } from "./naver-review-executor";
import type { NaverObserveResult } from "./naver-review-observe-runner";
import {
  NAVER_PRODUCT_INQUIRY_READ_WORKFLOW,
  validateNaverProductInquiryWorkflow,
} from "./naver-product-inquiry-workflow";

export const NAVER_PRODUCT_INQUIRY_OBSERVE_RECIPE_ID = "NAVER_PRODUCT_INQUIRY_OBSERVE_V1" as const;

/** One inquiry exactly as the backend accepts it. Six named fields; there is no field for the buyer. */
export interface NaverObservedInquiry {
  readonly questionId: string;
  readonly createdAt: string;
  readonly body: string;
  readonly answered: boolean;
  readonly secret: boolean;
  readonly channelProductNo: string;
}

export interface NaverInquiryDeliveryRequest {
  readonly inquiries: readonly NaverObservedInquiry[];
  readonly pageSize: number;
  readonly totalCount: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface NaverInquiryDeliveryResponse {
  readonly identityVerdict: string;
  readonly coverage: string | null;
  readonly received: number;
  readonly inserted: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failed: number;
}

export interface NaverInquiryObserveDeps {
  /** Hand the reading in for the job this helper holds. `null` = the delivery did not land. */
  readonly deliver: (request: NaverInquiryDeliveryRequest) => Promise<NaverInquiryDeliveryResponse | null>;
  readonly executor?: Pick<AsideNaverProductInquiryExecutor, "execute" | "asOf">;
  readonly asideCli?: string;
  readonly asideAccount?: string;
}

const QUESTION_ID = /^[1-9]\d{0,18}$/;
const PRODUCT_NO = /^\d{1,20}$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 5000;

/** SHA-256 of the question ids read, sorted. Ids only — never a body, a product or a date. */
export function digestOfQuestionIds(inquiries: readonly NaverObservedInquiry[]): string {
  return createHash("sha256").update(inquiries.map((r) => r.questionId).sort().join("\n"), "utf8").digest("hex");
}

function civil(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

type Sanitized =
  | {
      ok: true;
      inquiries: NaverObservedInquiry[];
      pageSize: number;
      totalCount: number;
      windowStart: string;
      windowEnd: string;
    }
  | { ok: false; reason: string };

/**
 * The page is untrusted input. Every row must be one this file fully understands, or none is kept — and the page's
 * own size, total and period must describe it.
 */
export function sanitizeNaverInquiryReading(raw: unknown): Sanitized {
  if (raw === null || typeof raw !== "object") return { ok: false, reason: "READING_SHAPE" };
  const r = raw as Record<string, unknown>;
  const reason = r["reason"] as NaverProductInquiryReadReason | undefined;
  if (reason !== "OK") return { ok: false, reason: typeof reason === "string" ? reason : "READING_SHAPE" };
  const rows = r["rows"];
  if (!Array.isArray(rows) || rows.length > NAVER_PRODUCT_INQUIRY_MAX_ROWS) return { ok: false, reason: "READING_SHAPE" };
  if (r["rowCount"] !== rows.length || r["loaded"] !== rows.length) return { ok: false, reason: "ROW_COUNT_DISAGREES" };
  const pageIndex = r["pageIndex"];
  const pageSize = r["pageSize"];
  const totalCount = r["totalCount"];
  const windowStart = r["windowStart"];
  const windowEnd = r["windowEnd"];
  if (pageIndex !== 0) return { ok: false, reason: "PAGE_NOT_FIRST" };
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1
      || pageSize > NAVER_PRODUCT_INQUIRY_MAX_ROWS || rows.length > pageSize) {
    return { ok: false, reason: "PAGE_SIZE" };
  }
  if (typeof totalCount !== "number" || !Number.isInteger(totalCount) || totalCount < rows.length) {
    return { ok: false, reason: "PAGE_TOTAL" };
  }
  if (rows.length < pageSize && rows.length !== totalCount) return { ok: false, reason: "PAGE_SHORT" };
  if (typeof windowStart !== "string" || !CIVIL_DATE.test(windowStart)
      || typeof windowEnd !== "string" || !CIVIL_DATE.test(windowEnd) || windowStart > windowEnd) {
    return { ok: false, reason: "WINDOW_SHAPE" };
  }
  if (r["linkChecked"] !== rows.length) return { ok: false, reason: "LINK_CHECK" };
  const seen = new Set<string>();
  const out: NaverObservedInquiry[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row === null || typeof row !== "object") return { ok: false, reason: "ROW_SHAPE" };
    const x = row as Record<string, unknown>;
    const questionId = x["questionId"];
    const createdAt = x["createdAt"];
    const body = x["body"];
    const answered = x["answered"];
    const secret = x["secret"];
    const channelProductNo = x["channelProductNo"];
    if (typeof questionId !== "string" || !QUESTION_ID.test(questionId) || seen.has(questionId)) return { ok: false, reason: "ROW_ID" };
    const at = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
    if (typeof createdAt !== "string" || !Number.isFinite(at)) return { ok: false, reason: "ROW_DATE" };
    if (at > previous) return { ok: false, reason: "ROW_ORDER" };
    previous = at;
    if (typeof body !== "string" || body.length > MAX_BODY) return { ok: false, reason: "ROW_BODY" };
    if (typeof answered !== "boolean") return { ok: false, reason: "ROW_ANSWERED" };
    if (typeof secret !== "boolean") return { ok: false, reason: "ROW_SECRET" };
    if (typeof channelProductNo !== "string" || !PRODUCT_NO.test(channelProductNo)) return { ok: false, reason: "ROW_PRODUCT" };
    seen.add(questionId);
    out.push({ questionId, createdAt, body, answered, secret, channelProductNo });
  }
  return { ok: true, inquiries: out, pageSize, totalCount, windowStart, windowEnd };
}

/**
 * Run one unattended NAVER 상품 문의 observation. Never throws — an unattended loop that can throw is one that stops.
 */
export async function runNaverProductInquiryObservation(deps: NaverInquiryObserveDeps): Promise<NaverObserveResult> {
  const none = (outcome: NaverObserveResult["outcome"]): NaverObserveResult => ({ outcome, observedCount: null, contentDigest: null });
  if (validateNaverProductInquiryWorkflow(NAVER_PRODUCT_INQUIRY_READ_WORKFLOW).length > 0) {
    log("aside_naver_inquiry_refused", { reason: "WORKFLOW_INVALID" }, "warn");
    return none("REFUSED");
  }
  let executor: Pick<AsideNaverProductInquiryExecutor, "execute" | "asOf">;
  try {
    executor = deps.executor
      ?? new AsideNaverProductInquiryExecutor({
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
    log("aside_naver_inquiry_read", { ok: false, code: "EXECUTOR_UNAVAILABLE", llmCalls: 0 });
    return none("EXECUTOR_UNAVAILABLE");
  }
  const result = execution.result;
  if (!result.ok) {
    const outcome = result.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "SURFACE_UNREADABLE";
    log("aside_naver_inquiry_read", { ok: false, code: result.code, stage: result.stage, reason: result.reason, llmCalls: 0, outcome });
    return none(outcome);
  }

  const reading = sanitizeNaverInquiryReading(result.reading);
  if (!reading.ok) {
    log("aside_naver_inquiry_read", { ok: false, code: "READING_REFUSED", reason: reading.reason, llmCalls: 0 });
    return none("SURFACE_UNREADABLE");
  }
  // The period must be current and read twice alike: a stale or moving period is a bound nobody could state.
  const range = result.range as { windowStart?: unknown; windowEnd?: unknown } | null;
  const today = civil(kstCivilDate(executor.asOf()));
  if (!range || range.windowStart !== reading.windowStart || range.windowEnd !== reading.windowEnd
      || reading.windowEnd !== today) {
    log("aside_naver_inquiry_read", { ok: false, code: "RANGE_NOT_CURRENT", llmCalls: 0 });
    return none("SURFACE_UNREADABLE");
  }
  const outside = reading.inquiries.filter((q) => {
    const day = civil(kstCivilDate(new Date(Date.parse(q.createdAt))));
    return day < reading.windowStart || day > reading.windowEnd;
  }).length;
  if (outside > 0) {
    log("aside_naver_inquiry_read", { ok: false, code: "ROWS_OUTSIDE_PERIOD", outside, llmCalls: 0 });
    return none("SURFACE_UNREADABLE");
  }

  let delivered: NaverInquiryDeliveryResponse | null;
  try {
    delivered = await deps.deliver({
      inquiries: reading.inquiries,
      pageSize: reading.pageSize,
      totalCount: reading.totalCount,
      windowStart: reading.windowStart,
      windowEnd: reading.windowEnd,
    });
  } catch {
    delivered = null;
  }
  if (delivered === null) {
    log("aside_naver_inquiry_delivery", { ok: false, reason: "NOT_DELIVERED" }, "warn");
    return none("EXECUTOR_UNAVAILABLE");
  }
  if (delivered.identityVerdict !== "MATCH") {
    log("aside_naver_inquiry_delivery", { ok: false, identity: delivered.identityVerdict, received: delivered.received });
    return none("STORE_UNRESOLVED");
  }
  log("aside_naver_inquiry_read", {
    ok: true,
    rows: reading.inquiries.length,
    total: reading.totalCount,
    identity: delivered.identityVerdict,
    coverage: delivered.coverage,
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
    observedCount: reading.inquiries.length,
    contentDigest: digestOfQuestionIds(reading.inquiries),
  };
}
