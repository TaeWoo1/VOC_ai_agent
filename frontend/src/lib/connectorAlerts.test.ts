import { describe, expect, it } from "vitest";
import { activeAlerts, isActiveAlert, recoveredNote } from "./connectorAlerts";
import type { ConnectorAlertView } from "./types";

function alert(over: Partial<ConnectorAlertView> = {}): ConnectorAlertView {
  return {
    id: "a-1",
    sellerAccountId: "acc-1",
    channelId: "ch-1",
    channelNameKo: "네이버 스마트스토어",
    accountAlias: null,
    type: "REPEATED_FAILURE",
    severity: "WARNING",
    message: "최근 수집이 반복해서 실패했습니다.",
    createdAt: "2026-08-18T13:52:56Z",
    acknowledgedAt: null,
    recoveredAt: null,
    ...over,
  };
}

describe("what counts as a connection problem right now", () => {
  it("counts an unacknowledged alert that has not recovered", () => {
    expect(isActiveAlert(alert())).toBe(true);
  });

  /**
   * The defect this closes. On the live org three alerts raised 2026-08-18..23 were still being
   * counted as 「연결 문제 3건」 while all three channels were CONNECTED with zero consecutive failures
   * and had collected successfully on 09-05 and 09-08 — a number a seller would act on, describing a
   * condition that had ended three weeks earlier.
   */
  it("stops counting one that collected successfully afterwards", () => {
    expect(isActiveAlert(alert({ recoveredAt: "2026-09-08T03:06:57Z" }))).toBe(false);
  });

  /**
   * Two different facts, and neither substitutes for the other: acknowledgement says a person saw it,
   * recovery says the condition ended. A channel can fix itself while nobody looked, and a seller can
   * read an alert for a channel that is still broken.
   */
  it("keeps acknowledgement and recovery as separate reasons to stop counting", () => {
    expect(isActiveAlert(alert({ acknowledgedAt: "2026-08-20T00:00:00Z" }))).toBe(false);
    expect(isActiveAlert(alert({
      acknowledgedAt: "2026-08-20T00:00:00Z",
      recoveredAt: "2026-09-08T03:06:57Z",
    }))).toBe(false);
  });

  it("counts across a list and tolerates a read that never landed", () => {
    expect(activeAlerts([alert(), alert({ id: "a-2", recoveredAt: "2026-09-08T00:00:00Z" })]))
      .toHaveLength(1);
    expect(activeAlerts(null)).toHaveLength(0);
    expect(activeAlerts(undefined)).toHaveLength(0);
  });
});

describe("what the history screen says about a recovered alert", () => {
  /**
   * History is the point of an alert log — a recovered alert is not deleted and not hidden, it is
   * labelled. Silence there would leave a resolved failure looking unresolved, which is the same
   * defect one screen further along.
   */
  it("says when collection worked again", () => {
    expect(recoveredNote(alert({ recoveredAt: "2026-09-08T03:06:57Z" })))
      .toBe("2026-09-08에 수집이 다시 성공했습니다.");
  });

  it("says nothing while the alert is still current", () => {
    expect(recoveredNote(alert())).toBeNull();
  });
});
