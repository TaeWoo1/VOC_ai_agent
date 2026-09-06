/**
 * <b>A turn that stopped for a person survives the process that started it.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §9. The completion criterion is «process
 * restart 후 checkpoint resume», and this file is the honest test of the design that answers it (§5):
 * the durable state of a waiting turn is the CONVERSATION — its transcript, its pending human actions,
 * its working set — and {@link ConversationStore} has owned that since before the migration. The graph's
 * own state is one turn's execution cursor, and a turn does not outlive the request that started it.
 *
 * So a restart is reproduced the way it actually happens: a <b>second `ConversationService`</b>, built
 * over the same store, with the first one's graph and every in-memory turn gone. If resume needed
 * anything the first process held, it fails here.
 */
import { describe, expect, it } from "vitest";
import { ConversationService } from "../../src/conversation/ConversationService";
import { TOKEN, artifact, coverageRow, freshReviews, harness, say } from "./support";

describe("restart — the waiting turn is the conversation's, not the process's", () => {
  it("a WAITING_HUMAN turn resumes in a second service and answers the ORIGINAL request", async () => {
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
    const { conversationId: id } = await h.service.create(TOKEN);

    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(first.turn.status).toBe("WAITING_HUMAN");
    const waitingTurnId = first.turn.turnId;

    // ── the process ends here. Everything the first service held in memory is gone. ──
    const restarted = new ConversationService({ storeProvider: h.stores, clientFactory: h.clientFactory });

    h.inquiry.syncRuns.push({
      id: "up-1", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 3, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z",
    });
    h.recentReviews["false:ALL"] = freshReviews(staleNaver());

    const turn = await restarted.turn(TOKEN, id, { text: "", resumeOfTurnId: waitingTurnId } as never, () => {});
    expect(turn.status).toBe("DONE");
    // The ORIGINAL request is what was answered — the resumed turn points at the turn it continues.
    expect(turn.resumedFrom).toBe(waitingTurnId);
    expect(artifact(turn, "REVIEW_LIST").items).toHaveLength(3);
    expect(turn.continuation.pendingHumanAction).toBeNull();
  });

  it("resuming twice performs the work once — the second resume has nothing left to continue", async () => {
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
    const { conversationId: id } = await h.service.create(TOKEN);
    const first = await say(h, id, "오늘 새로 달린 리뷰 보여줘");
    expect(first.turn.status).toBe("WAITING_HUMAN");

    h.inquiry.syncRuns.push({
      id: "up-1", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "SUCCESS", successRows: 3, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z",
    });
    h.recentReviews["false:ALL"] = freshReviews(staleNaver());

    const once = await say(h, id, "", { resumeOfTurnId: first.turn.turnId });
    expect(once.turn.status).toBe("DONE");
    const runsAfterFirst = h.inquiry.syncRuns.length;

    // §6: a resume is not a second execution. Whatever the second one answers, it must not have
    // STARTED anything — the collection this turn was waiting on is the seller's own, it already
    // happened, and a resume that launched another would be the duplicate side effect this criterion
    // is about.
    await h.service.turn(TOKEN, id, { text: "", resumeOfTurnId: first.turn.turnId } as never, () => {})
      .catch(() => undefined);
    expect(h.inquiry.syncRuns.length).toBe(runsAfterFirst);
  });
});
