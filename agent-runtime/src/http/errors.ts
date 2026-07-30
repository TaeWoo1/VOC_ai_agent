/**
 * HTTP error mapping — turn internal failures into a status + coarse code, never leaking a
 * response body, a token, or seller content.
 *
 * The service and server both throw/catch {@link HttpError}. Everything else — a
 * {@link SpringApiError} from the backend hop, a goal-parse failure, a fail-closed
 * execution-enabled refusal, a validation error — is normalized here into an HttpError whose
 * `message` is a fixed, content-free label. Raw error text (which could echo a backend body)
 * never reaches the client.
 */
import { SpringApiError } from "../spring/SpringClient";
import { UnrecognizedGoalError } from "../goal/parseGoal";
import { ExecutionEnabledError } from "../runtime";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The sanitized JSON body for an error response. */
export interface HttpErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

export function errorBody(err: HttpError): HttpErrorBody {
  return { error: { code: err.code, message: err.message } };
}

/**
 * Normalize any thrown value into an HttpError. Backend 4xx statuses pass through (so a
 * forwarded-token 401 stays a 401 and a foreign-scope 403/404 stays that); any 5xx (or a
 * non-HTTP failure) collapses to a coarse 502/500 so an internal message never leaks.
 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;

  if (err instanceof SpringApiError) {
    // The backend is the system of record; its client-error statuses are meaningful to the
    // operator (unauthorized / forbidden / not found / conflict), so surface them — but only
    // the status + a coarse code, never the (already-suppressed) body.
    if (err.status >= 400 && err.status < 500) {
      return new HttpError(err.status, err.code, "backend rejected the request");
    }
    return new HttpError(502, "BACKEND_UNAVAILABLE", "backend request failed");
  }

  if (err instanceof UnrecognizedGoalError) {
    return new HttpError(400, "UNRECOGNIZED_GOAL", "could not resolve a supported intent from the request");
  }

  if (err instanceof ExecutionEnabledError) {
    return new HttpError(409, "EXECUTION_ENABLED", "refusing to run: the backend external-send path is enabled");
  }

  // Fallback: never surface the raw message (it could carry content). A coarse 500.
  return new HttpError(500, "INTERNAL", "internal error");
}
