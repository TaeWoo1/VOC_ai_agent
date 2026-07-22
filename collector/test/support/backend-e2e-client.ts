/**
 * **Minimal backend client for the gated spine E2E.** Test scope on purpose: `collector/src/**` gains
 * no signup or attention-read capability for a diagnostic that only a gated test runs.
 *
 * It uses the endpoints the product already exposes — signup, channel list, file-channel seller
 * account, attention summary — so the E2E bootstraps a **fresh org** per run and never depends on,
 * or disturbs, whatever else is in the target database. A fresh org also guarantees exactly one
 * seller account on the channel, which `IngestedReviewVocItemSource`'s ambiguity guard requires.
 *
 * Sanitization: the caller receives ids it needs in-process (account id) and signal metadata. Nothing
 * here logs, and no test built on it prints a token, an email, or an account id.
 */

export interface E2ECredentials {
  email: string;
  password: string;
  token: string;
  orgName: string;
}

export interface AttentionSignalPayload {
  type: string;
  severity: string;
  count: number;
  sourceType: string;
  label: string;
  description: string;
  channel: string | null;
}

export interface AttentionSummaryPayload {
  sellerAccountId: string;
  channel: string | null;
  fromDate: string;
  toDate: string;
  items: AttentionSignalPayload[];
}

async function jsonOrThrow(res: Response, what: string): Promise<unknown> {
  if (!res.ok) {
    // The status is enough to diagnose; the body may echo request content, so it is not surfaced.
    throw new Error(`${what} failed: HTTP ${res.status}`);
  }
  return res.json();
}

/** Create a throwaway org + user and return its bearer token. */
export async function signup(baseUrl: string, email: string, password: string, orgName: string): Promise<E2ECredentials> {
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "spine-e2e", orgName }),
  });
  const data = (await jsonOrThrow(res, "signup")) as { token?: string };
  if (!data.token) throw new Error("signup returned no token");
  return { email, password, token: data.token, orgName };
}

/** Resolve a channel code (e.g. "NAVER") to its id. */
export async function channelIdFor(baseUrl: string, token: string, code: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/channels`, { headers: { authorization: `Bearer ${token}` } });
  const channels = (await jsonOrThrow(res, "channels")) as Array<{ id: string; code: string }>;
  const match = channels.find((c) => c.code === code);
  if (!match) throw new Error(`channel not found: ${code}`);
  return match.id;
}

/**
 * Register the org's file-upload seller account on a channel — the product's own onboarding endpoint
 * for a channel whose reviews arrive as exports.
 */
export async function registerFileChannel(baseUrl: string, token: string, channelId: string, alias: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/seller-accounts/file-channel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ channelId, alias }),
  });
  const account = (await jsonOrThrow(res, "file-channel registration")) as { id?: string };
  if (!account.id) throw new Error("file-channel registration returned no account id");
  return account.id;
}

/** Read the operator attention summary over an explicit window — the surface the seller center shows. */
export async function attentionSummary(
  baseUrl: string,
  token: string,
  accountId: string,
  range: { from: string; to: string },
): Promise<AttentionSummaryPayload> {
  const search = new URLSearchParams({ from: range.from, to: range.to });
  const res = await fetch(`${baseUrl}/api/seller-accounts/${accountId}/attention?${search.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await jsonOrThrow(res, "attention")) as AttentionSummaryPayload;
}
