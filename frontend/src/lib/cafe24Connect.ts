// Pure helpers for the Cafe24 OAuth connect flow. Kept free of React/DOM so the
// logic is unit-testable in the repo's node-environment Vitest setup. The components
// (Cafe24Connect / Cafe24ConnectResult) hold only the thin UI + redirect glue.

/** Route where the seller starts the Cafe24 connect flow. */
export const CAFE24_CONNECT_ROUTE = "/connect/cafe24";
/** Route the backend OAuth callback redirects the browser back to. */
export const CAFE24_RESULT_ROUTE = "/connect/cafe24/result";

// Mirrors the backend mall_id shape (hostname label): a-z 0-9 and hyphens, 1–63
// chars, no leading/trailing hyphen. Conservative — reject anything else client-side
// before a request is ever made.
const MALL_ID_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Trim + lowercase a seller-entered mall id and validate it conservatively.
 * Returns the normalized value, or {@code null} when it is empty or malformed.
 */
export function normalizeMallId(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const value = raw.trim().toLowerCase();
  return MALL_ID_SHAPE.test(value) ? value : null;
}

export type Cafe24ResultStatus = "connected" | "reconnect_required" | "invalid" | "unknown";

export interface Cafe24Result {
  status: Cafe24ResultStatus;
  accountId: string | null;
}

/**
 * Read ONLY the sanitized callback result params ({@code status}, {@code accountId}).
 * Any unrecognized or missing status collapses to {@code "unknown"}. Deliberately
 * never reads {@code code}/{@code state}/{@code token}/secret params — they are not
 * part of the trusted result contract and must never be surfaced.
 */
export function parseCafe24Result(params: URLSearchParams): Cafe24Result {
  const raw = params.get("status");
  const status: Cafe24ResultStatus =
    raw === "connected" || raw === "reconnect_required" || raw === "invalid" ? raw : "unknown";
  const accountId = params.get("accountId");
  return { status, accountId: accountId && accountId.length > 0 ? accountId : null };
}

/**
 * Map a failed start request to safe Korean copy. Classifies by HTTP status without
 * echoing any provider body beyond the backend's own 400 validation message (which
 * carries no secret). Network/unknown failures fall through to a generic message.
 */
export function classifyStartError(err: unknown): string {
  const response = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
  const status = response?.status;
  if (status === 400) {
    return response?.data?.message ?? "몰 ID를 확인해 주세요.";
  }
  if (status === 401) {
    return "로그인이 필요합니다. 다시 로그인해 주세요.";
  }
  if (status === 404) {
    return "카페24 연결을 사용할 수 없습니다. 관리자에게 문의해 주세요.";
  }
  return "카페24 연결 시작에 실패했습니다. 백엔드가 실행 중인지 확인해 주세요.";
}
