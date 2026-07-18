import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins how the opaque actionRef reaches the wire on the three reply routes — the same
// silent, total failure mode apiClient.triage.test.ts exists for, now on three more calls:
// the ref is a server-minted token interpolated into a URL PATH, and the request either
// carries it in a form the backend decodes back to the original string, or every row fails.
//
// axios is stubbed at the module boundary so the assertions are on the URLs the client
// builds, not on a network round trip. Hermetic: no network, no backend.

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();

vi.mock("axios", () => {
  const instance = {
    get,
    put,
    post,
    interceptors: { request: { use: vi.fn() } },
  };
  return { default: { create: () => instance } };
});

const ACTION_REF = "review:6f1c8b1e-0000-4000-8000-000000000001";
const ENCODED = "review%3A6f1c8b1e-0000-4000-8000-000000000001";
const BASE = `/api/seller-accounts/acct-1/attention/items/${ENCODED}/reply`;

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  post.mockReset();
  get.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: { actionRef: ACTION_REF, state: "APPROVED", replayed: false } });
});

afterEach(() => {
  vi.resetModules();
});

describe("review reply routes — actionRef on the wire", () => {
  it("encodes the ref exactly once on the prep read", async () => {
    const { api } = await import("./apiClient");
    await api.getReviewReplyPrep("acct-1", ACTION_REF);

    const [url] = get.mock.calls[0];
    expect(url).toBe(BASE);
    // A double encode (`%253A`) looks right, passes any "is it encoded?" eyeball, and
    // reaches the backend as the literal string "review%3A<uuid>" — no known source, 400.
    expect(url).not.toContain("%25");
    expect(decodeURIComponent(url.split("/items/")[1].replace("/reply", ""))).toBe(ACTION_REF);
  });

  it("encodes the ref exactly once on the draft save, and sends the base version", async () => {
    const { api } = await import("./apiClient");
    await api.saveReviewReplyDraft("acct-1", ACTION_REF, { body: "합성-답변", baseVersion: 2 });

    const [url, body] = put.mock.calls[0];
    expect(url).toBe(`${BASE}/draft`);
    expect(url).not.toContain("%25");
    expect(body).toEqual({ body: "합성-답변", baseVersion: 2 });
  });

  it("encodes the ref exactly once on the approval, and sends the command id", async () => {
    const { api } = await import("./apiClient");
    await api.decideReviewReplyApproval("acct-1", ACTION_REF, {
      commandId: "cmd-1",
      state: "APPROVED",
      baseVersion: 1,
    });

    const [url, body] = post.mock.calls[0];
    expect(url).toBe(`${BASE}/approval`);
    expect(url).not.toContain("%25");
    expect(body).toEqual({ commandId: "cmd-1", state: "APPROVED", baseVersion: 1 });
  });

  it("sends a null baseVersion on a withdrawal — a withdrawal binds nothing", async () => {
    const { api } = await import("./apiClient");
    await api.decideReviewReplyApproval("acct-1", ACTION_REF, {
      commandId: "cmd-2",
      state: "WITHDRAWN",
      baseVersion: null,
    });

    const [, body] = post.mock.calls[0];
    expect(body.state).toBe("WITHDRAWN");
    expect(body.baseVersion).toBeNull();
  });

  it("encodes the ref on the guided submission-run mint, with no body", async () => {
    post.mockResolvedValue({ data: { actionRef: ACTION_REF, submissionRef: "a1b2c3d4e5f60718", approvedVersion: 1 } });
    const { api } = await import("./apiClient");
    await api.startReviewReplySubmissionRun("acct-1", ACTION_REF);

    const [url, body] = post.mock.calls[0];
    expect(url).toBe(`${BASE}/submission-run`);
    expect(url).not.toContain("%25");
    expect(body).toEqual({});
  });

  it("encodes the ref on the outcome record, and sends the report + binding + run id", async () => {
    post.mockResolvedValue({ data: { actionRef: ACTION_REF, recorded: true, replayed: false } });
    const { api } = await import("./apiClient");
    await api.recordReviewReplyOutcome("acct-1", ACTION_REF, {
      commandId: "cmd-3",
      submissionRef: "a1b2c3d4e5f60718",
      operatorOutcome: "OPERATOR_REPORTED_SUBMITTED",
      awRunRef: "aw-run-xyz",
    });

    const [url, body] = post.mock.calls[0];
    expect(url).toBe(`${BASE}/outcome`);
    expect(url).not.toContain("%25");
    expect(body).toEqual({
      commandId: "cmd-3",
      submissionRef: "a1b2c3d4e5f60718",
      operatorOutcome: "OPERATOR_REPORTED_SUBMITTED",
      awRunRef: "aw-run-xyz",
    });
  });

  /**
   * Fail-closed, like both attention reads: a thrown read must reach the caller so the
   * panel can say "불러오지 못했습니다", rather than resolve to seeded data. A silent
   * fallback here would show a suggested reply and a copy button belonging to a review that
   * is not the one in front of the operator.
   */
  it("propagates a failed prep read instead of falling back to mocks", async () => {
    get.mockRejectedValue(new Error("boom"));
    const { api } = await import("./apiClient");
    await expect(api.getReviewReplyPrep("acct-1", ACTION_REF)).rejects.toThrow();
  });

  it("propagates a failed write", async () => {
    put.mockRejectedValue(new Error("409"));
    post.mockRejectedValue(new Error("409"));
    const { api } = await import("./apiClient");
    await expect(
      api.saveReviewReplyDraft("acct-1", ACTION_REF, { body: "합성", baseVersion: 0 }),
    ).rejects.toThrow();
    await expect(
      api.decideReviewReplyApproval("acct-1", ACTION_REF, {
        commandId: "c",
        state: "APPROVED",
        baseVersion: 1,
      }),
    ).rejects.toThrow();
  });
});
