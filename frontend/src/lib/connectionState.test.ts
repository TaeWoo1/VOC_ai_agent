import { describe, expect, it } from "vitest";
import { CONNECTION_ACTION_LABEL, connectionState } from "./connectionState";
import type { ConnectionStatusView, SellerAccountResponse } from "./types";

function account(status: SellerAccountResponse["connectionStatus"]): SellerAccountResponse {
  return { id: "a", channelId: "c", channelNameKo: "", alias: null, connectionStatus: status, lastSyncedAt: null, fileUpload: false };
}
function health(over: Partial<ConnectionStatusView>): ConnectionStatusView {
  return { state: "CONNECTED", consecutiveFailures: 0, lastError: null, lastSyncedAt: null, ...over } as ConnectionStatusView;
}

describe("connectionState — one word per channel row", () => {
  it("no account → 연결 필요; a started connect → 연결 중", () => {
    expect(connectionState(null, null).label).toBe("연결 필요");
    expect(connectionState(account("PENDING"), null).label).toBe("연결 중");
  });

  it("재연결 필요 when the account says so, or when the credential no longer works", () => {
    expect(connectionState(account("RECONNECT_REQUIRED"), null).label).toBe("재연결 필요");
    for (const state of ["EXPIRED", "NEEDS_REAUTH", "DISCONNECTED"]) {
      expect(connectionState(account("CONNECTED"), health({ state })).label).toBe("재연결 필요");
    }
  });

  it("오류 when collection is failing on a connected account; 연결됨 otherwise", () => {
    expect(connectionState(account("CONNECTED"), health({ consecutiveFailures: 2 })).label).toBe("오류");
    expect(connectionState(account("CONNECTED"), health({ lastError: "timeout" })).label).toBe("오류");
    expect(connectionState(account("CONNECTED"), health({ state: "DEGRADED" })).label).toBe("오류");
    expect(connectionState(account("CONNECTED"), health({})).label).toBe("연결됨");
    expect(connectionState(account("CONNECTED"), null).label).toBe("연결됨");
  });

  it("names one verb per state", () => {
    expect(CONNECTION_ACTION_LABEL).toEqual({
      CONNECTED: "연결 관리",
      NEEDS_CONNECT: "연결하기",
      PENDING: "연결 계속하기",
      RECONNECT: "다시 연결하기",
      ERROR: "확인하기",
    });
  });
});
