import { describe, expect, it } from "vitest";
import type { SellerAccountResponse } from "./types";
import { accountLabel, resolveWorklistAccounts } from "./worklistAccounts";

function account(over: Partial<SellerAccountResponse> = {}): SellerAccountResponse {
  return {
    id: "acct-1",
    channelId: "ch-1",
    channelNameKo: "네이버 스마트스토어",
    alias: null,
    connectionStatus: "CONNECTED",
    lastSyncedAt: null,
    fileUpload: true,
    ...over,
  };
}

describe("resolveWorklistAccounts", () => {
  it("says there is nothing to show when no channel is connected", () => {
    expect(resolveWorklistAccounts([])).toEqual({ kind: "none" });
  });

  it("resolves a lone account without asking — there is nothing to choose between", () => {
    const result = resolveWorklistAccounts([account({ id: "a" })]);

    expect(result).toEqual({ kind: "single", account: { id: "a", label: "네이버 스마트스토어" } });
  });

  it("NEVER picks one when several exist, and carries no selection at all", () => {
    // The load-bearing case. `reviews` has no seller_account_id, so the backend refuses to
    // attribute reviews per-account when an org holds several on a channel — it returns an empty
    // snapshot rather than guessing. Choosing here would render one account's view as the seller's
    // whole worklist: the same inference, made on the surface they trust most.
    const result = resolveWorklistAccounts([
      account({ id: "a", alias: "본점" }),
      account({ id: "b", alias: "2호점" }),
    ]);

    expect(result.kind).toBe("choose");
    // No `account` field anywhere in the result — not null, not first, not most-recent. Absent.
    expect(result).not.toHaveProperty("account");
    expect(Object.keys(result)).toEqual(["kind", "accounts"]);
  });

  it("orders the chooser stably so it does not reshuffle between reads", () => {
    // A chooser whose buttons move is one a seller cannot build a habit around, and this list is
    // rendered on every visit to the operations home.
    const forwards = resolveWorklistAccounts([
      account({ id: "b", alias: "가게" }),
      account({ id: "a", alias: "나게" }),
    ]);
    const backwards = resolveWorklistAccounts([
      account({ id: "a", alias: "나게" }),
      account({ id: "b", alias: "가게" }),
    ]);

    expect(forwards).toEqual(backwards);
  });

  it("breaks a label tie on id so the order is total", () => {
    const result = resolveWorklistAccounts([
      account({ id: "z", alias: "같은이름" }),
      account({ id: "a", alias: "같은이름" }),
    ]);

    expect(result.kind === "choose" && result.accounts.map((a) => a.id)).toEqual(["a", "z"]);
  });

  it("does not filter by channel — that answer is the server's", () => {
    // Encoding "which channels have a worklist" here would duplicate a product decision the
    // frontend has no business holding, and would silently exclude any channel added later. A
    // channel with no source already resolves to an honest empty state server-side.
    const result = resolveWorklistAccounts([
      account({ id: "a", channelNameKo: "쿠팡", alias: null }),
    ]);

    expect(result).toEqual({ kind: "single", account: { id: "a", label: "쿠팡" } });
  });
});

describe("accountLabel", () => {
  it("prefers the seller's own alias — they named it to tell two accounts apart", () => {
    expect(accountLabel(account({ alias: "본점" }))).toBe("본점");
  });

  it("falls back to the channel name rather than rendering an empty button", () => {
    expect(accountLabel(account({ alias: null }))).toBe("네이버 스마트스토어");
    expect(accountLabel(account({ alias: "   " }))).toBe("네이버 스마트스토어");
  });

  it("never renders the raw id, which names nothing a seller recognises", () => {
    expect(accountLabel(account({ id: "3f1c-uuid", alias: null }))).not.toContain("3f1c");
  });
});
