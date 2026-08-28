/** The three runtime changes from the live resume proof (2026-08-27), one test each. */
import { describe, expect, it } from "vitest";
import { freshnessVerdict } from "../../src/operator/graph/reviewRows";
import { TODAY, TOKEN, artifact, coverageRow, freshReviews, harness, say } from "./support";

const WINDOW = { from: "2026-08-21", to: TODAY, token: "LAST_7_DAYS" as const };

describe("1 — a connected NAVER/Coupang NOT_SUPPORTED row is judged by the window rule", () => {
  it("connected seller-run channels are FRESH or NOT_COLLECTED; everything else keeps its verdict", () => {
    const naver = (over: Partial<Parameters<typeof coverageRow>[0]>) =>
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, ...over });
    expect(freshnessVerdict(naver({ connected: true, lastSuccessfulSyncAt: "2026-08-22T00:00:00Z" }), WINDOW)).toBe("FRESH");
    expect(freshnessVerdict(naver({ connected: true, lastSuccessfulSyncAt: "2026-08-10T00:00:00Z" }), WINDOW)).toBe("NOT_COLLECTED");
    expect(freshnessVerdict(naver({ connected: true, lastSuccessfulSyncAt: null }), WINDOW)).toBe("NOT_COLLECTED");
    expect(freshnessVerdict(naver({ connected: false, lastSuccessfulSyncAt: "2026-08-22T00:00:00Z" }), WINDOW)).toBe("NOT_SUPPORTED");
    expect(freshnessVerdict(coverageRow({ channelCode: "COUPANG", state: "NOT_SUPPORTED", supported: false, connected: true,
      lastSuccessfulSyncAt: "2026-08-25T00:00:00Z" }), WINDOW)).toBe("FRESH");
    // A channel with no seller-run path stays NOT_SUPPORTED however connected it is.
    expect(freshnessVerdict(coverageRow({ channelCode: "CAFE24", state: "NOT_SUPPORTED", supported: false, connected: true,
      lastSuccessfulSyncAt: "2026-08-25T00:00:00Z" }), WINDOW)).toBe("NOT_SUPPORTED");
    expect(freshnessVerdict(coverageRow({ channelCode: "NAVER", state: "NOT_CONNECTED", connected: false }), WINDOW)).toBe("NOT_CONNECTED");
    expect(freshnessVerdict(coverageRow({ channelCode: "NAVER", state: "BLOCKED", connected: true }), WINDOW)).toBe("NOT_CONNECTED");
  });
});

describe("2+3 — a file-upload run completes a REVIEW_IMPORT step and the channel reads FRESH on resume", () => {
  it("stale NAVER → WAITING_HUMAN → upload-shaped SUCCESS run → resume DONE with the rows", async () => {
    const h = harness();
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: true });
    const staleNaver = () => [
      coverageRow({}),
      coverageRow({ channelCode: "COUPANG", channelNameKo: "쿠팡", state: "ZERO", rows: 0, openRows: 0, newestObservedAt: null }),
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: "2026-08-10T00:00:00Z", newestObservedAt: "2026-08-09T00:00:00Z" }),
    ];
    h.recentReviews["false:ALL"] = { ...freshReviews(staleNaver()), items: [], total: 0 };
    const view = await h.service.create(TOKEN);
    const id = view.conversationId;

    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(first.turn.status).toBe("WAITING_HUMAN");
    const human = artifact(first.turn, "HUMAN_ACTION_REQUIRED");
    // The guided export is the path; the file upload is the explicit fallback, never the default.
    expect(human).toMatchObject({
      channelCode: "NAVER", path: "EXPORT_ACTION_WINDOW", reason: "NOT_COLLECTED", accountId: "acct-naver",
      requiresLocalAgent: true, fallback: { path: "FILE_UPLOAD", to: "/connect/upload" },
    });
    expect(artifact(first.turn, "REVIEW_LIST").freshness.find((f) => f.channelCode === "NAVER")?.verdict).toBe("NOT_COLLECTED");

    // The seller uploads the export: the run carries no account and no dataType — only the channel and uploadType.
    h.inquiry.syncRuns.push({
      id: "up-1", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 3, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z",
    });
    // The coverage row still cannot say an upload happened; the rows now exist.
    h.recentReviews["false:ALL"] = freshReviews(staleNaver());

    const { turn } = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(turn.status).toBe("DONE");
    expect(turn.resumedFrom).toBe(first.turn.turnId);
    expect(turn.message.startsWith("새 리뷰 가져오기가 끝났습니다")).toBe(true);
    const list = artifact(turn, "REVIEW_LIST");
    expect(list.items).toHaveLength(3);
    const naver = list.freshness.find((f) => f.channelCode === "NAVER");
    expect(naver).toMatchObject({ verdict: "FRESH", lastSuccessfulSyncAt: "2099-01-01T00:02:00Z" });
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    expect(turn.continuation.pendingHumanAction).toBeNull();
  });
});
