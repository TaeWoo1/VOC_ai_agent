/**
 * **Why a login failed, in the seller's words — and why this needed its own module.**
 *
 * The login form used to report every failure as "이메일 또는 비밀번호를 확인해 주세요". On 2026-07-25 that
 * sentence cost a live run most of an hour: the credentials were correct and the request never reached the
 * backend. Two causes stacked up — a `VITE_API_BASE_URL` passed in a shell that vite never read, and then a
 * backend allowing exactly one CORS origin (`http://localhost:5173`) while the browser was on
 * `127.0.0.1:5173` — and the form said "check your password" for both.
 *
 * A message that blames the seller for a problem on our side is worse than a vague one: it sends them to change
 * something that was never wrong. So the two cases are separated by the only signal that distinguishes them
 * reliably — whether an HTTP RESPONSE came back at all.
 *
 *  - a response with a status ⇒ the server answered, so 401/403 really is the credentials;
 *  - no response ⇒ nothing answered: the API is down, the base URL is wrong, or the origin is not allowed. From
 *    the browser these are indistinguishable by design (a CORS rejection is deliberately opaque to scripts), so
 *    the copy names the class of problem instead of guessing which member of it.
 *
 * Deliberately NOT a diagnostics surface: no status code, no URL, no origin, nothing from the error object
 * reaches the screen. The distinction is the whole point; the details belong in the console.
 */

/** What the seller reads, and whether the answer lies with them or with the connection. */
export interface LoginFailure {
  message: string;
  /** True when the server answered and rejected the credentials. */
  credentials: boolean;
}

const CREDENTIALS = "이메일 또는 비밀번호를 확인해 주세요.";
const UNREACHABLE = "SellerOps 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
const SERVER = "SellerOps 서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";

/** The HTTP status an error carries, or null when nothing answered. Shape-based: axios is not imported here. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;
  const status = (response as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export function loginFailure(error: unknown): LoginFailure {
  const status = statusOf(error);
  // Nothing answered. Blaming the password here is the bug this function exists to fix.
  if (status === null) return { message: UNREACHABLE, credentials: false };
  if (status === 401 || status === 403) return { message: CREDENTIALS, credentials: true };
  // The server answered with something else — a 500, a 502, a validation error. Still not the seller's password.
  if (status >= 500) return { message: SERVER, credentials: false };
  return { message: CREDENTIALS, credentials: true };
}

export const LOGIN_FAILURE_COPY = { CREDENTIALS, UNREACHABLE, SERVER } as const;
