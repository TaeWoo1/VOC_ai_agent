import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins how an opaque actionRef is put on the wire — the one thing about this call that
// cannot be checked by reading the component: the ref is a server-minted token
// interpolated into a URL PATH, and the request either carries it in a form the backend
// decodes back to the original string, or the call fails on every row.
//
// axios is stubbed at the module boundary so the assertion is on the URL the client
// builds, not on a network round trip. This is the only apiClient test of its kind; it
// exists because the encoding is a silent, total failure mode.

const post = vi.fn();

vi.mock("axios", () => {
  const instance = {
    post,
    get: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { default: { create: () => instance } };
});

const ACTION_REF = "review:6f1c8b1e-0000-4000-8000-000000000001";

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({
    data: { actionRef: ACTION_REF, disposition: "MONITOR", replayed: false },
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("recordVocItemTriage — actionRef on the wire", () => {
  it("percent-encodes the ref exactly once", async () => {
    const { api } = await import("./apiClient");

    await api.recordVocItemTriage("acct-1", ACTION_REF, {
      commandId: "cmd-1",
      disposition: "MONITOR",
    });

    const [url] = post.mock.calls[0];
    // Encoded once: the colon is escaped, so the ref survives a path segment...
    expect(url).toBe(
      "/api/seller-accounts/acct-1/attention/items/" +
        "review%3A6f1c8b1e-0000-4000-8000-000000000001/triage",
    );
    // ...and exactly once. A double encode (`%253A`) is the failure this pins: it looks
    // right, passes any "is it encoded?" eyeball, and reaches the backend as the literal
    // string "review%3A<uuid>" — which parses as no known source and 400s every row.
    expect(url).not.toContain("%25");
    expect(decodeURIComponent(url.split("/items/")[1].replace("/triage", ""))).toBe(ACTION_REF);
  });

  it("round-trips the ref through the path without reshaping it", async () => {
    const { api } = await import("./apiClient");

    await api.recordVocItemTriage("acct-1", ACTION_REF, {
      commandId: "cmd-1",
      disposition: "RESPONSE_NEEDED",
    });

    const [url, body] = post.mock.calls[0];
    // The raw ref must not appear unescaped anywhere in the path — that is what "encoded"
    // means, and asserting it separately catches an interpolation that skipped the encode.
    expect(url).not.toContain(ACTION_REF);
    // The ref is an ADDRESS: it belongs in the path and has no business in the body,
    // which carries only the decision and its idempotency key.
    expect(body).toEqual({ commandId: "cmd-1", disposition: "RESPONSE_NEEDED" });
  });

  it("does not smuggle the account id into anything but its own path segment", async () => {
    const { api } = await import("./apiClient");

    await api.recordVocItemTriage("acct-42", ACTION_REF, {
      commandId: "cmd-1",
      disposition: "NO_ACTION",
    });

    const [url, body] = post.mock.calls[0];
    expect(url).toContain("/api/seller-accounts/acct-42/attention/items/");
    // The account is authorization the backend re-derives from the path; the client never
    // restates it as data, where it would look like something the caller gets to choose.
    expect(JSON.stringify(body)).not.toContain("acct-42");
  });
});
