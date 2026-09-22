import { describe, expect, it } from "vitest";
import { DECISION_ACTION_WORD, DECISION_DONE_LABEL, decisionLogSentence } from "./reviewDecision";
import { TRIAGE_OPTIONS } from "./vocItems";
import type { ReviewDecisionLogEntry } from "./types";

function entry(over: Partial<ReviewDecisionLogEntry>): ReviewDecisionLogEntry {
  return { kind: "ACTION_CHOSEN", from: null, to: null, at: "2026-09-10T00:00:00Z", ...over };
}

/**
 * The workspace's words for decisions the product already records.
 *
 * The thing worth pinning is the refusals: an entry this build cannot name renders as NOTHING rather
 * than as its own raw token, because a `SOMETHING_NEW` on a seller's screen is the internal-word leak
 * this product removes everywhere else — and the server's vocabulary can always grow ahead of a
 * deployed bundle.
 */
describe("decisionLogSentence", () => {
  it("says what the seller decided, naming the value they left when there was one", () => {
    expect(decisionLogSentence(entry({ kind: "SELLER_JUDGMENT_SET", to: "NEEDS_ATTENTION" })))
      .toBe("판매자 판단을 확인 필요(으)로 기록");
    expect(decisionLogSentence(entry({ kind: "SELLER_JUDGMENT_SET", from: "FYI", to: "NEEDS_ATTENTION" })))
      .toBe("판매자 판단을 참고에서 확인 필요로 바꿈");
    expect(decisionLogSentence(entry({ kind: "SELLER_JUDGMENT_WITHDRAWN", from: "FYI" })))
      .toBe("판매자 판단을 되돌림");
    expect(decisionLogSentence(entry({ kind: "ACTION_CHOSEN", to: "MONITOR" })))
      .toBe("조치를 두고 보기(으)로 정함");
    expect(decisionLogSentence(entry({ kind: "ACTION_RECORDED", to: "ACTION_COMPLETED" })))
      .toBe("조치를 완료했다고 기록");
    expect(decisionLogSentence(entry({ kind: "REPLY_APPROVAL", to: "APPROVED" })))
      .toBe("답변을 승인");
    expect(decisionLogSentence(entry({ kind: "REPLY_OUTCOME", to: "OPERATOR_REPORTED_SUBMITTED" })))
      .toBe("판매자센터에 올렸다고 기록");
  });

  it("renders nothing for a value it cannot name — never the raw token", () => {
    expect(decisionLogSentence(entry({ kind: "ACTION_RECORDED", to: "SOMETHING_NEW" }))).toBeNull();
    expect(decisionLogSentence(entry({ kind: "ACTION_CHOSEN", to: "SOMETHING_NEW" }))).toBeNull();
    expect(decisionLogSentence(entry({ kind: "REPLY_APPROVAL", to: null }))).toBeNull();
    expect(decisionLogSentence(entry({ kind: "SELLER_JUDGMENT_SET", to: "UNKNOWN_TIER" }))).toBeNull();
  });

  /**
   * The workspace does not rename the three decisions. A second set of words for one enum would leave
   * the worklist, the record and the audit trail describing the same values differently.
   */
  it("uses the product's existing words for the decision, not new ones", () => {
    for (const option of TRIAGE_OPTIONS) {
      expect(DECISION_ACTION_WORD[option.value]).toBe(option.label);
    }
  });

  /**
   * 조치 불필요 is `TriageDisposition.NO_ACTION`'s statement and it is made in the decision spine, with
   * its own trail. Offering it here as well would put one press into two spines at two evidential
   * strengths — the thing the triage contract §5-C says must not happen.
   */
  it("offers no 조치 불필요 in the 완료 기록 controls", () => {
    expect(Object.keys(DECISION_DONE_LABEL)).toEqual(["ACTION_STARTED", "ACTION_COMPLETED"]);
    expect(Object.keys(DECISION_DONE_LABEL)).not.toContain("ACTION_NOT_NEEDED");
  });
});
