// @vitest-environment jsdom
/**
 * **The identity read must not be able to fabricate a session.**
 *
 * `api.getMe` used the shared mock-fallback helper, so a REJECTED token returned a mock user: `AuthProvider`
 * hydrated "successfully", the app rendered as though signed in, and every real read behind it failed. On
 * 2026-07-26 that put "계정을 불러오지 못했어요" on the import screen for a seller whose actual problem was an
 * expired session — with nothing on screen suggesting they log in again, because as far as the app knew they were
 * logged in.
 *
 * A mock fallback is defensible for a channel list: a wrong list is visibly wrong. It is not defensible for
 * "who am I", where being wrong looks exactly like being right.
 *
 * axios is stubbed at the module boundary — hermetic, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
/** The response interceptor's rejection handler, captured at module load (see the expiry cases below). */
const responseUse = vi.fn();

vi.mock("axios", () => {
  const instance = {
    get,
    post: vi.fn(),
    put: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: responseUse } },
  };
  return { default: { create: () => instance } };
});

beforeEach(() => {
  get.mockReset();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function client() {
  return (await import("./apiClient")).api;
}

describe("api.getMe", () => {
  it("returns the backend's user when the read succeeds", async () => {
    get.mockResolvedValue({ data: { id: "u1", email: "seller@example.com", name: "판매자", orgName: "가게" } });
    const api = await client();
    await expect(api.getMe()).resolves.toMatchObject({ email: "seller@example.com" });
    expect(get).toHaveBeenCalledWith("/api/users/me");
  });

  /** The regression. A rejected session must REJECT, so the caller can clear the token and show the login form. */
  it("rejects when the token is refused instead of inventing a user", async () => {
    get.mockRejectedValue({ response: { status: 401 } });
    const api = await client();
    await expect(api.getMe()).rejects.toBeDefined();
  });

  it("rejects when nothing answered at all", async () => {
    get.mockRejectedValue(new Error("Network Error"));
    const api = await client();
    await expect(api.getMe()).rejects.toBeDefined();
  });

  /**
   * Explicit demo mode still works, and the distinction is the point: a flag the operator set is a choice, a
   * `catch` is a fallback taken behind the user's back.
   */
  it("still serves the demo user under the explicit mock flag, without calling the backend", async () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    const api = await client();
    await expect(api.getMe()).resolves.toBeDefined();
    expect(get).not.toHaveBeenCalled();
  });
});

/**
 * Self-Pilot Runtime v1: an EXPIRED session mid-day is a reconnect, not a broken backend. The one response
 * interceptor clears the stale token and sends the seller to `/login?expired=1`; a wrong password on the
 * login call itself, a 403, or a 401 with no token present are NOT expiry and must not redirect.
 */
describe("in-session expiry (401 → /login?expired=1)", () => {
  async function rejectionHandler() {
    await import("./apiClient");
    const calls = responseUse.mock.calls;
    const call = calls[calls.length - 1];
    if (!call) throw new Error("response interceptor was not installed");
    return call[1] as (error: unknown) => Promise<never>;
  }

  beforeEach(() => {
    responseUse.mockClear();
    localStorage.clear();
  });

  it("clears the token and redirects when an authenticated call answers 401", async () => {
    const mod = await import("./apiClient");
    localStorage.setItem("sellerops_token", "stale");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/reviews", assign });
    const onRejected = await rejectionHandler();

    await expect(onRejected({ response: { status: 401 }, config: { url: "/api/inbox" } })).rejects.toBeDefined();

    expect(localStorage.getItem("sellerops_token")).toBeNull();
    expect(assign).toHaveBeenCalledWith(mod.SESSION_EXPIRED_PATH);
    vi.unstubAllGlobals();
  });

  it("does not treat the login call, a 403, or a token-less 401 as expiry", async () => {
    const mod = await import("./apiClient");
    expect(mod.isSessionExpiry(401, "/api/auth/login", true)).toBe(false); // wrong password stays a form error
    expect(mod.isSessionExpiry(403, "/api/inbox", true)).toBe(false); // a real authorization answer
    expect(mod.isSessionExpiry(401, "/api/inbox", false)).toBe(false); // never signed in — not an expiry
    expect(mod.isSessionExpiry(401, "/api/inbox", true)).toBe(true);
    expect(mod.isSessionExpiry(500, "/api/inbox", true)).toBe(false);
  });
});
