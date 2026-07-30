/**
 * Operator authentication against the backend.
 *
 * The runtime acts on behalf of a seated operator; obtaining that operator's JWT is a
 * login, done here. The org is derived from the token on the backend — the runtime never
 * carries or stores a channel credential, only this short-lived bearer token. Nothing
 * here is logged.
 */
import { SpringApiError } from "./SpringClient";

export interface LoginResult {
  readonly token: string;
}

/** POST /api/auth/login {email,password} -> { token }. Throws SpringApiError on failure. */
export async function login(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LoginResult> {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new SpringApiError(res.status, `HTTP_${res.status}`, "login failed");
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new SpringApiError(500, "NO_TOKEN", "login response had no token");
  return { token: body.token };
}
