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

  /**
   * The rule the case below already stated, now applied to this state too — because the state itself
   * changed meaning. It used to report «this account has no session slot», a fact about an identifier
   * minted on first use and nothing to do with a helper; live on 2026-09-14 it told a seller whose card
   * read 연결됨 to go and connect their helper, at a page that could not have fixed it. It now reports
   * what its name says, so the card above is both the diagnosis and the only place to act.
   */
  it("points at the 도우미 card rather than offering a second button to the same action", () => {
    const gate = acquisitionReadinessOf(ready("HELPER_NOT_LINKED"), CONNECTED);
    expect(gate.canStart).toBe(false);
    expect(gate.blockedKo).toContain("도우미 카드");
    expect(gate.action).toBeNull();
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

  /**
   * **An unknown store does not block the press — the press is what finds it out.** Refusing here would
   * make the bootstrap circular: identity needed to start the run that establishes identity.
   */
  it("lets the bootstrap run start, says what it will do, and names it honestly", () => {
    const gate = acquisitionReadinessOf(ready("STORE_IDENTITY_UNKNOWN"), CONNECTED);
    expect(gate.canStart).toBe(true);
    expect(gate.blockedKo).toBeNull();
    expect(gate.noteKo).toContain("어느 스토어인지 아직 모릅니다");
    // The press does not promise collection it is not going to do.
    expect(gate.startLabelKo).toBe("스토어 확인하기");
    // No trip to the OpenAPI wizard: browser collection needs no API key.
    expect(gate.action).toBeNull();
    expect(gate.noteKo).not.toMatch(/API|액세스|시크릿/);
  });

  it("still waits for the machine before a bootstrap run", () => {
    const gate = acquisitionReadinessOf(ready("STORE_IDENTITY_UNKNOWN"), STOPPED);
    expect(gate.canStart).toBe(false);
    expect(gate.blockedKo).toContain("도우미가 준비되면");
  });

  it("never claims the run will succeed — nothing here is about the marketplace login", () => {
    const sentences = (["CHANNEL_NOT_SUPPORTED", "FILE_UPLOAD_ACCOUNT", "HELPER_NOT_LINKED"] as const).map(
      (s) => acquisitionReadinessOf(ready(s), CONNECTED).blockedKo ?? "",
    );
    for (const line of sentences) {
      expect(line).not.toMatch(/로그인|성공|완료/);
    }
  });
});
