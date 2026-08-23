/**
 * What happens when one read fails, and what that is allowed to cost.
 *
 * <b>Why this file exists.</b> On 2026-08-23 a seller asked the Operator to prioritise their unanswered
 * inquiries. INQUIRY_OPS read the inbox successfully, then called `search_customer_memory` with no
 * anchor — no product, no inquiry, no topic — and the backend correctly answered `400 조회 기준이
 * 필요합니다`. That one exception unwound the whole specialist, taking the successful inbox read with
 * it, and the run ended **`DONE` with zero findings**: the shape the v2 contract calls worse than a
 * failure, because a seller cannot tell it apart from "I looked and there was nothing".
 * Record: `docs/agent_real_validation_v1.md` §3 Q5.
 *
 * <b>Three rules, and they are separable.</b>
 *
 *  1. <b>A tool call is isolated.</b> One failing read loses its own evidence and nothing else. Reads
 *     that already succeeded stay; reads that have not run yet still run. Only a DECLARED dependency
 *     may stop a later step (PRODUCT_OPS resolving a product before reading its facts is the one this
 *     repository actually has, and it already handles the unresolved case itself).
 *  2. <b>A precondition is checked before the call, not discovered from the response.</b> The backend
 *     refusing an anchorless customer-memory search is CORRECT, and loosening it would turn a
 *     support-history lookup into a whole-org trawl. So the caller stops asking, and records that it
 *     stopped and why.
 *  3. <b>A failure is data.</b> `ToolFailure` is a closed-vocabulary row — specialist, tool, category,
 *     status class, recoverable — and it reaches the answer. A swallowed exception that leaves an
 *     empty success is the defect; a recorded one that leaves an honest partial is the fix.
 *
 * <b>Nothing here carries a value.</b> No response body, no request arguments, no message text from an
 * error, no customer utterance. The HTTP status becomes a CLASS, not a number in a sentence. That is
 * deliberate: an error message is the one field on an exception most likely to quote what was sent.
 */
import type { SpecialistName } from "../state/OperatorState";

/**
 * Why a read did not produce evidence.
 *
 * `ANCHOR_UNAVAILABLE` is the only value that describes a call that was never made, and it is the most
 * important one: it is the difference between "the backend rejected us" and "we knew better than to
 * ask". A seller reading the second learns something true about their data; the first is noise.
 */
export type FailureCategory =
  | "ANCHOR_UNAVAILABLE"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "TRANSPORT"
  | "TOOL_NOT_ALLOWED"
  | "BUDGET"
  | "UNKNOWN";

/** The HTTP outcome as a class. Never the number, never the body. */
export type StatusCategory = "NONE" | "CLIENT_4XX" | "AUTH" | "SERVER_5XX" | "TRANSPORT";

export interface ToolFailure {
  readonly specialist: SpecialistName;
  readonly tool: string;
  /** Which information need was being served. Absent when the call served the specialist as a whole. */
  readonly needId?: string;
  readonly category: FailureCategory;
  readonly statusCategory: StatusCategory;
  /**
   * Whether the SAME call could plausibly succeed later without anything changing.
   *
   * A 5xx or a dropped connection: yes. A 400, a missing anchor, a tool outside the plan: no — those
   * need a different call, not a retry, and marking them recoverable would invite a loop that spends
   * the budget re-asking a question the backend has already answered.
   */
  readonly recoverable: boolean;
}

/**
 * How a specialist ended.
 *
 * `PARTIAL` is the value the graph did not have, and its absence is why Q5 looked like a success. A
 * specialist that read two things and failed one has neither succeeded nor failed, and collapsing that
 * into either loses the fact a seller needs.
 */
export type SpecialistTerminal = "OK" | "PARTIAL" | "FAILED";

/** What one attempted read produced. Never throws — that is the whole point. */
export type ToolAttempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ToolFailure };

interface StatusCarrier { readonly status?: unknown; readonly name?: unknown }

/**
 * Turn a thrown thing into a class, reading only its shape.
 *
 * `SpringApiError` carries `status` and a coarse code and deliberately no body; everything else is
 * treated as transport. The error's `message` is never read — not to classify, not to log.
 */
export function classifyToolError(error: unknown): {
  category: FailureCategory;
  statusCategory: StatusCategory;
  recoverable: boolean;
} {
  const name = (error as StatusCarrier | null)?.name;
  if (name === "ToolNotInPlanError" || name === "UnknownToolError") {
    return { category: "TOOL_NOT_ALLOWED", statusCategory: "NONE", recoverable: false };
  }
  const status = (error as StatusCarrier | null)?.status;
  if (typeof status !== "number") {
    return { category: "TRANSPORT", statusCategory: "TRANSPORT", recoverable: true };
  }
  if (status === 401 || status === 403) {
    return { category: "UNAUTHORIZED", statusCategory: "AUTH", recoverable: false };
  }
  if (status === 404) {
    return { category: "NOT_FOUND", statusCategory: "CLIENT_4XX", recoverable: false };
  }
  if (status === 429) {
    return { category: "RATE_LIMITED", statusCategory: "CLIENT_4XX", recoverable: true };
  }
  if (status >= 400 && status < 500) {
    return { category: "BAD_REQUEST", statusCategory: "CLIENT_4XX", recoverable: false };
  }
  if (status >= 500) {
    return { category: "UPSTREAM_ERROR", statusCategory: "SERVER_5XX", recoverable: true };
  }
  return { category: "UNKNOWN", statusCategory: "NONE", recoverable: false };
}

/** A failure for a call that was deliberately NOT made. */
export function skippedTool(input: {
  specialist: SpecialistName;
  tool: string;
  needId?: string;
  category?: FailureCategory;
}): ToolFailure {
  return {
    specialist: input.specialist,
    tool: input.tool,
    ...(input.needId ? { needId: input.needId } : {}),
    category: input.category ?? "ANCHOR_UNAVAILABLE",
    statusCategory: "NONE",
    recoverable: false,
  };
}

/**
 * Invoke one tool and come back either way.
 *
 * The `invoke` callback rather than the registry itself, so a caller passes the exact typed call it
 * already writes and this function adds only the isolation.
 */
export async function attemptTool<T>(
  input: { specialist: SpecialistName; tool: string; needId?: string },
  invoke: () => Promise<T>,
): Promise<ToolAttempt<T>> {
  try {
    return { ok: true, value: await invoke() };
  } catch (error) {
    const classified = classifyToolError(error);
    return {
      ok: false,
      failure: {
        specialist: input.specialist,
        tool: input.tool,
        ...(input.needId ? { needId: input.needId } : {}),
        ...classified,
      },
    };
  }
}

/**
 * How a specialist ended, from what it actually did.
 *
 * Deliberately counts SUCCESSFUL READS rather than satisfied needs: a read that succeeded and found
 * nothing is a fact about the seller's data, and calling that specialist FAILED would report a working
 * system as broken.
 */
export function terminalOf(input: {
  readonly succeeded: number;
  readonly failures: readonly ToolFailure[];
}): SpecialistTerminal {
  if (input.failures.length === 0) return "OK";
  return input.succeeded > 0 ? "PARTIAL" : "FAILED";
}

/** The seller-facing sentence for a failure. Closed vocabulary in, plain Korean out — no ids, no values. */
export function failureSentence(failure: ToolFailure): string {
  switch (failure.category) {
    case "ANCHOR_UNAVAILABLE":
      return "비슷한 과거 대응 사례는 대상 상품이나 문의를 먼저 특정해야 찾을 수 있어 이번에는 조회하지 않았습니다.";
    case "BAD_REQUEST":
    case "TOOL_NOT_ALLOWED":
      return "일부 조회는 지금 조건으로는 할 수 없어 그 부분은 답에 포함하지 않았습니다.";
    case "NOT_FOUND":
      return "일부 조회 대상을 찾지 못해 그 부분은 답에 포함하지 않았습니다.";
    case "UNAUTHORIZED":
      return "일부 조회에 대한 권한이 확인되지 않아 그 부분은 답에 포함하지 않았습니다.";
    case "RATE_LIMITED":
    case "UPSTREAM_ERROR":
    case "TRANSPORT":
      return "일부 조회가 일시적으로 실패해 그 부분은 답에 포함하지 않았습니다. 잠시 후 다시 시도할 수 있습니다.";
    case "BUDGET":
      return "조회 예산에 도달해 일부는 확인하지 못했습니다.";
    case "UNKNOWN":
      return "일부 조회를 마치지 못해 그 부분은 답에 포함하지 않았습니다.";
  }
}
