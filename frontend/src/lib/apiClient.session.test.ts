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

vi.mock("axios", () => {
  const instance = {
    get,
    post: vi.fn(),
    put: vi.fn(),
    interceptors: { request: { use: vi.fn() } },
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
