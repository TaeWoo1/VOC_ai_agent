import { describe, expect, it } from "vitest";
import { acquisitionReadinessOf, type AcquisitionReadinessView } from "./acquisitionReadiness";
import type { HelperState } from "./helper/helperStatus";

const CONNECTED: HelperState = { key: "CONNECTED", label: "연결됨", tone: "good", note: null, action: null };
const STOPPED: HelperState = {
  key: "START",
  label: "실행 필요",
  tone: "warn",
  note: "도우미가 실행되고 있지 않습니다.",
  action: { kind: "retry", label: "다시 찾기" },
};

const ready = (state: AcquisitionReadinessView["state"]): AcquisitionReadinessView => ({
  state,
  channelCode: "COUPANG",
});

describe("지금 동기화 — can it be pressed, and if not, the one thing to do", () => {
  it("permits the press only when the account and the machine are both ready", () => {
    const gate = acquisitionReadinessOf(ready("READY"), CONNECTED);
    expect(gate.canStart).toBe(true);
    expect(gate.blockedKo).toBeNull();
  });

  it("asks the account before the machine — a channel that cannot do this is not told to install a 도우미", () => {
    const gate = acquisitionReadinessOf(ready("CHANNEL_NOT_SUPPORTED"), STOPPED);
    expect(gate.canStart).toBe(false);
    expect(gate.blockedKo).toContain("이 채널은 화면에서");
    // The helper would change nothing here, so no next step is offered for it.
    expect(gate.action).toBeNull();
  });

  it("sends an unlinked account to the 도우미, which is the one blocker the seller can act on here", () => {
    const gate = acquisitionReadinessOf(ready("HELPER_NOT_LINKED"), CONNECTED);
    expect(gate.canStart).toBe(false);
    expect(gate.action).toEqual({ to: "/connect/helper", label: "도우미 연결하기" });
  });

  it("does not repeat the 도우미 card's diagnosis — it says only what the press is waiting on", () => {
    const gate = acquisitionReadinessOf(ready("READY"), STOPPED);
    expect(gate.canStart).toBe(false);
    expect(gate.blockedKo).not.toBe(STOPPED.note);
    expect(gate.blockedKo).toContain("도우미가 준비되면");
    // The card directly above owns the next step; a second button to the same page is not a choice.
    expect(gate.action).toBeNull();
  });

  it("blocks, silently, until both reads have answered — an unanswered read is not a permission", () => {
    expect(acquisitionReadinessOf(null, CONNECTED)).toEqual({ canStart: false, blockedKo: null, action: null });
    expect(acquisitionReadinessOf(ready("READY"), null)).toEqual({ canStart: false, blockedKo: null, action: null });
  });

  it("names the missing FACT when the store cannot be matched — not the seller's window, and not an API wizard", () => {
    const gate = acquisitionReadinessOf(ready("STORE_IDENTITY_UNKNOWN"), CONNECTED);
    expect(gate.canStart).toBe(false);
    expect(gate.blockedKo).toContain("어느 스토어인지 아직 알려주지");
    // Explicitly NOT 「판매자 화면이 정상적으로 열려 있는지 확인」 — the screen was fine when this fired.
    expect(gate.blockedKo).not.toMatch(/화면이 정상|다시 시도/);
    // And no trip to the OpenAPI wizard: the field that answers this is under the sentence, and browser
    // collection needs no API key.
    expect(gate.action).toBeNull();
    expect(gate.blockedKo).not.toMatch(/연결 정보|API|키/);
  });

  it("never claims the run will succeed — nothing here is about the marketplace login", () => {
    const sentences = (["CHANNEL_NOT_SUPPORTED", "FILE_UPLOAD_ACCOUNT", "HELPER_NOT_LINKED", "STORE_IDENTITY_UNKNOWN"] as const).map(
      (s) => acquisitionReadinessOf(ready(s), CONNECTED).blockedKo ?? "",
    );
    for (const line of sentences) {
      expect(line).not.toMatch(/로그인|성공|완료/);
    }
  });
});
