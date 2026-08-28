import { describe, expect, it } from "vitest";
describe("Acceptance Closure §5 — completion is THIS step's run, not any review sync on the channel", () => {
  it("matches the requested account's run, or an upload-shaped run on its channel; never another account's", async () => {
    const { runsOfThisStep } = await import("./ConversationProvider");
    const pending = { accountId: "acc-nv", channelId: "chan-nv", dataType: "REVIEW" };
    const mine = { sellerAccountId: "acc-nv", channelId: "chan-nv", dataType: "REVIEW", uploadType: null, finishedAt: "2026-08-28T01:00:00Z", status: "SUCCESS" };
    const upload = { sellerAccountId: null, channelId: "chan-nv", dataType: null, uploadType: "REVIEW", finishedAt: "2026-08-28T01:00:00Z", status: "SUCCESS" };
    const other = { sellerAccountId: "acc-other", channelId: "chan-nv", dataType: "REVIEW", uploadType: null, finishedAt: "2026-08-28T01:00:00Z", status: "SUCCESS" };
    const wrongType = { sellerAccountId: null, channelId: "chan-nv", dataType: null, uploadType: "INQUIRY", finishedAt: "2026-08-28T01:00:00Z", status: "SUCCESS" };
    expect(runsOfThisStep([mine, upload, other, wrongType], pending)).toEqual([mine, upload]);
    expect(runsOfThisStep([upload], { ...pending, channelId: null })).toEqual([]);
  });
});
