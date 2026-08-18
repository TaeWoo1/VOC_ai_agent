/**
 * Why a sign-up failed, in the seller's words. Same discipline as `loginError.ts`: an HTTP response that
 * came back is the server's answer (409 = the email is taken, 400 = a field the backend refused, both with a
 * message written for the seller); no response at all is a connection problem and must never read as "check
 * what you typed". No status code, URL, or raw error text reaches the screen.
 */

export interface SignupFailure {
  message: string;
  /** True when the server answered and the seller can fix it by changing what they typed. */
  input: boolean;
}

const UNREACHABLE = "SellerOps 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
const SERVER = "SellerOps 서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
const EMAIL_TAKEN = "이미 가입된 이메일입니다. 로그인해 주세요.";
const INVALID = "입력한 내용을 다시 확인해 주세요.";

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;
  const status = (response as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** The backend's own seller-facing sentence, when it sent one (`GlobalExceptionHandler` body.message). */
function backendMessage(error: unknown): string | null {
  const response = (error as { response?: { data?: { message?: unknown } } } | null)?.response;
  const message = response?.data?.message;
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}

export function signupFailure(error: unknown): SignupFailure {
  const status = statusOf(error);
  if (status === null) return { message: UNREACHABLE, input: false };
  if (status === 409) return { message: EMAIL_TAKEN, input: true };
  if (status === 400) return { message: backendMessage(error) ?? INVALID, input: true };
  if (status >= 500) return { message: SERVER, input: false };
  return { message: backendMessage(error) ?? INVALID, input: true };
}

export const SIGNUP_FAILURE_COPY = { UNREACHABLE, SERVER, EMAIL_TAKEN, INVALID } as const;
