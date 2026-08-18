import { describe, expect, it } from "vitest";
import { buildIssueAttention, hintFor, summarizeConnections } from "./homeSignals";
import type { ChannelResponse, ConnectorAlertView } from "./types";

describe("signal hints", () => {
  it("carries the right hint for each non-ready state", () => {
    expect(hintFor({ kind: "NOT_CONNECTED" })).toBe("자료를 연결하면 표시됩니다");
    expect(hintFor({ kind: "UNAVAILABLE" })).toBe("지금은 확인할 수 없습니다");
    expect(hintFor({ kind: "READY", count: 3 })).toBeNull();
  });
});

describe("recurring-issue signal", () => {
  it("counts only issues the operator has not set aside", () => {
    expect(buildIssueAttention(2, true).signal).toEqual({ kind: "READY", count: 2 });
  });

  it("is UNAVAILABLE before it has loaded", () => {
    expect(buildIssueAttention(null, false).signal).toEqual({ kind: "UNAVAILABLE" });
  });

  it("is UNAVAILABLE when the strict read failed — it never invents issues", () => {
    expect(buildIssueAttention(null, true).signal).toEqual({ kind: "UNAVAILABLE" });
  });

  it("sends the operator to the memory surface", () => {
    expect(buildIssueAttention(1, true).to).toBe("/memory");
  });
});

describe("connection summary — action-needed only", () => {
  function channel(over: Partial<ChannelResponse>): ChannelResponse {
    return {
      id: "c1",
      code: "X",
      nameKo: "채널",
      status: "CONNECTED",
      dataBadges: [],
      lastSyncedAt: null,
      actionLabel: "관리",
      support: {} as ChannelResponse["support"],
      ...over,
    };
  }

  const alert = (over: Partial<ConnectorAlertView>): ConnectorAlertView => ({
    id: "a1",
    sellerAccountId: "s1",
    channelId: null,
    channelNameKo: null,
    accountAlias: null,
    type: "AUTH_EXPIRED",
    severity: "WARNING",
    message: "연결을 다시 확인해 주세요",
    createdAt: "2026-08-01T00:00:00Z",
    acknowledgedAt: null,
    ...over,
  });

  it("surfaces only channels a person must act on", () => {
    const summary = summarizeConnections(
      [
        channel({ id: "ok", status: "CONNECTED" }),
        channel({ id: "avail", status: "AVAILABLE" }),
        channel({ id: "broken", status: "RECONNECT_REQUIRED" }),
      ],
      [],
    );
    expect(summary.needsAttention.map((c) => c.id)).toEqual(["broken"]);
  });

  it("does not treat 'available to connect' as a problem", () => {
    const summary = summarizeConnections([channel({ status: "AVAILABLE" })], []);
    expect(summary.needsAttention).toHaveLength(0);
    expect(summary.nothingConnected).toBe(false);
  });

  it("keeps only unacknowledged alerts", () => {
    const summary = summarizeConnections(
      [],
      [alert({ id: "open" }), alert({ id: "seen", acknowledgedAt: "2026-08-02T00:00:00Z" })],
    );
    expect(summary.openAlerts.map((a) => a.id)).toEqual(["open"]);
  });

  it("distinguishes 'nothing connected' from 'could not read'", () => {
    expect(summarizeConnections([], []).nothingConnected).toBe(true);
    expect(summarizeConnections(null, null).nothingConnected).toBe(false);
  });
});
