/**
 * Outcome Artifact + Visual Final Closure v1 — §2, the sentinel window.
 *
 * A claim about an unbounded read used to be handed `{from:"0000-00-00", to:"9999-99-99"}` so its filter
 * would pass everything, and `windowWord` then printed that range into the seller's paragraph:
 * 「이번에 확인한 네이버 리뷰 중 0000-00-00~9999-99-99에 작성된 리뷰는 50건입니다」, observed live on
 * 2026-09-02. The sentinel is internal; what a seller may read is a real period or no period at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { TODAY, TOKEN, coverageRow, freshReviews, harness, say } from "./support";
import { claimsFor } from "../../src/conversation/reviewClaim";
import { withoutSettledCollectionSteps } from "../../src/conversation/ConversationService";
import type { AcquisitionResultArtifact, Artifact, ReviewItem } from "../../src/conversation/contract";

const SENTINELS = ["0000-00-00", "9999-99-99"];

function row(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    reviewId: "r-1", channelCode: "NAVER", channelNameKo: "네이버", productId: null, productName: null,
    rating: 5, negative: false, preview: null, writtenOn: TODAY, to: "/reviews", ...over,
  } as ReviewItem;
}

describe("§2 — an unbounded read names no period", () => {
  it("drops the date clause instead of printing a placeholder range, and counts the same rows", () => {
    const rows = [row({ reviewId: "r-1" }), row({ reviewId: "r-2", writtenOn: "2020-01-01" }), row({ reviewId: "r-3", writtenOn: null })];
    const names = new Map([["NAVER", "네이버"]]);
    const collected = [{ channelCode: "NAVER", successRows: 3 }];

    const unbounded = claimsFor(rows, null, collected, names);
    expect(unbounded).toHaveLength(1);
    // The same two dated rows a sentinel range would have passed — the count did not move.
    expect(unbounded[0]!.count).toBe(2);
    expect(unbounded[0]!.sentence).toBe("이번에 확인한 네이버 리뷰는 2건입니다.");
    for (const s of SENTINELS) expect(unbounded[0]!.sentence).not.toContain(s);

    // A real window still names itself, exactly as before.
    const bounded = claimsFor(rows, { from: TODAY, to: TODAY, token: "TODAY" }, collected, names);
    expect(bounded[0]!.sentence).toContain("오늘 작성된");
  });
});

describe("§2 — the placeholder cannot come back", () => {
  it("no source under src/ holds a sentinel date literal", () => {
    const root = resolve(__dirname, "../../src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) {
          const text = readFileSync(path, "utf8");
          // The comment that explains the removal names it; a literal in code is the defect itself.
          const code = text.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")).join("\n");
          if (SENTINELS.some((sentinel) => code.includes(sentinel))) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

/**
 * Presentation Closure v1 §1 — the completion turn owns its own freshness rendering.
 *
 * The resumed turn re-plans the original question, so the read it makes is newer than the sync it just
 * consumed and the freshness rule asks for the next collection. Live on 2026-09-02 that arrived as
 * 「오늘 12:43 이후 아직 확인하지 못했어요 · 최신 상태 확인」 directly under the receipt: the step the
 * seller had just completed, beside the proof that they completed it. The persisted turn carried
 * ACQUISITION_RESULT and HUMAN_ACTION_REQUIRED/REVIEW_IMPORT together, and waited on it.
 */
describe("§1 — a finished collection is not asked for again in the turn that reports it", () => {
  const receipt = (channelCode: string): AcquisitionResultArtifact => ({
    artifactId: `a-acquisition-${channelCode.toLowerCase()}`, type: "ACQUISITION_RESULT",
    title: `${channelCode} 리뷰 가져오기 결과`, titleSaid: true,
    channelCode, channelNameKo: channelCode,
    periodStart: "2026-08-20", periodEnd: "2026-09-02", rowsNew: 115, rowsDuplicate: 33, rowsFailed: 0,
  });
  const step = (channelCode: string, actionType = "REVIEW_IMPORT"): Artifact => ({
    artifactId: `a-step-${channelCode}`, type: "HUMAN_ACTION_REQUIRED", title: `${channelCode} 리뷰 최신 상태 확인`,
    actionType, reason: "FRESHNESS_UNPROVEN", path: "EXPORT_ACTION_WINDOW",
    channelCode, channelNameKo: channelCode, accountId: "acct", dataType: "REVIEW",
    to: "/connect", requestedAt: `${TODAY}T00:00:00Z`, resumable: true, optional: false,
  } as Artifact);
  const types = (a: readonly Artifact[]) => a.map((x) => `${x.type}:${"channelCode" in x ? x.channelCode : ""}`);

  it("drops that channel's step, and only that one", () => {
    const kept = withoutSettledCollectionSteps(
      [step("NAVER"), step("COUPANG"), { artifactId: "a-l", type: "LIST", title: "목록", items: [] } as Artifact],
      [receipt("NAVER")],
    );
    // The channel the receipt names loses its second rendering; another channel's step is untouched,
    // because nothing in this turn reports ITS collection.
    expect(types(kept)).toEqual(["HUMAN_ACTION_REQUIRED:COUPANG", "LIST:"]);
  });

  it("keeps everything when there is no receipt — a turn with nothing to show needs the card", () => {
    const artifacts = [step("NAVER")];
    expect(withoutSettledCollectionSteps(artifacts, [])).toEqual(artifacts);
  });

  it("is scoped to the collection step, not to human actions in general", () => {
    const other = step("NAVER", "KNOWLEDGE_ENTRY");
    expect(withoutSettledCollectionSteps([other], [receipt("NAVER")])).toEqual([other]);
    // Case is not a way past it: the receipt's code and the artifact's are compared as one.
    expect(withoutSettledCollectionSteps([step("naver")], [receipt("NAVER")])).toEqual([]);
  });
});

/**
 * §2 — the failure path, from a fixture. A run that FAILED must leave the seller with the fact and a
 * next action; this asserts what is already there rather than changing it.
 */
describe("§2 — a failed collection says so, and says what to do", () => {
  it("keeps the failure sentence, the step card and the way to retry", async () => {
    const h = harness();
    h.inquiry.sellerAccounts.push({ id: "acct-naver", channelId: "chan-naver", channelNameKo: "네이버", alias: null,
      connectionStatus: "CONNECTED", lastSyncedAt: null, fileUpload: true });
    const stale = () => [
      coverageRow({ channelCode: "NAVER", channelNameKo: "네이버", state: "NOT_SUPPORTED", supported: false, connected: true,
        rows: 40, openRows: 2, lastSuccessfulSyncAt: "2026-08-10T00:00:00Z", newestObservedAt: "2026-08-09T00:00:00Z" }),
    ];
    h.recentReviews["false:ALL"] = { ...freshReviews(stale()), items: [], total: 0 };
    const view = await h.service.create(TOKEN);
    const first = await say(h, view.conversationId, "오늘 새로 달린 리뷰 보여줘");

    h.inquiry.syncRuns.push({
      id: "up-8", sellerAccountId: null, channelId: "chan-naver", dataType: null, uploadType: "REVIEW", trigger: "UPLOAD",
      status: "FAILED", successRows: 0, startedAt: "2099-01-01T00:00:00Z", finishedAt: "2099-01-01T00:02:00Z",
    });

    const { turn } = await say(h, view.conversationId, "", { resumeOfTurnId: first.turn.turnId });
    // The fact, in the seller's words and with no mechanism in it.
    expect(turn.message).toContain("수집이 실패했습니다");
    expect(turn.message).toMatch(/채널 연결 화면/);
    expect(turn.message.toLowerCase()).not.toMatch(/sync|run|job|segment/);
    // The step card is still there, so the way forward and the manual fallback are both reachable…
    expect(turn.artifacts.some((a) => a.type === "HUMAN_ACTION_REQUIRED" && a.actionType === "REVIEW_IMPORT")).toBe(true);
    // …the turn still waits on the seller, and 「계속 확인하기」 is offered.
    expect(turn.status).toBe("WAITING_HUMAN");
    expect(turn.suggestedActions.some((s) => s.kind === "RESUME")).toBe(true);
    // Nothing claims a result: a failed run has no receipt.
    expect(turn.artifacts.some((a) => a.type === "ACQUISITION_RESULT")).toBe(false);
  });
});
