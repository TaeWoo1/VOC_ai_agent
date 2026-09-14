import { describe, expect, it } from "vitest";
import { reviewCardOf } from "./coupangCapabilities";
import {
  collectedSentence,
  lastScreenRead,
  reviewCollectionStateOf,
  type ReviewCollectionInput,
} from "./reviewCollection";
import type { ActionWindowRunView } from "../actionWindow/contract";
import type { SyncRunView } from "../types";


function run(partial: Partial<ActionWindowRunView>): ActionWindowRunView {
  return {
    protocolVersion: 1,
    runId: "run-1",
    revision: 1,
    channelCode: "coupang",
    runCopyKey: "actionWindow.reviewAcquisition.run",
    status: "WAITING_FOR_HUMAN",
    executionMode: "ACTION_WINDOW",
    guidanceEnabled: true,
    allowedCommands: ["REQUEST_STEP_RECHECK"],
    progress: { completedSteps: 1, totalSteps: 3 },
    updatedAt: "2026-09-14T00:00:00Z",
    ...partial,
  } as ActionWindowRunView;
}

function input(over: Partial<ReviewCollectionInput> = {}): ReviewCollectionInput {
  return {
    readiness: { state: "READY", channelCode: "COUPANG" },
    helperKey: "CONNECTED",
    run: null,
    unavailable: null,
    bootstrap: null,
    startFailed: false,
    arrival: "PRESSED",
    ...over,
  };
}

describe("리뷰 수집 — 한 번에 한 걸음", () => {
  it("아직 읽지 못한 사실 위에서는 걸음을 주장하지 않는다", () => {
    const s = reviewCollectionStateOf(input({ readiness: null, helperKey: null }));
    expect(s.step).toBe("HELPER");
    expect(s.busy).toBe(true);
    expect(s.primary).toBeNull();
  });

  it("도우미가 준비되지 않았으면 그 걸음에 서고, 그 카드가 컨트롤을 소유한다", () => {
    const s = reviewCollectionStateOf(input({ helperKey: "LINK" }));
    expect(s.step).toBe("HELPER");
    // 이 모듈은 도우미의 문장을 다시 쓰지 않는다 — 카드가 자기 말과 자기 버튼을 갖고 있다.
    expect(s.primary).toEqual({ kind: "HELPER" });
    expect(s.failure).toBeNull();
  });

  it("장벽의 press는 기술 동작이 아니라 판매자가 한 일의 이름을 단다", () => {
    const s = reviewCollectionStateOf(input({ run: run({}) }));
    expect(s.step).toBe("SURFACE");
    expect(s.primary).toEqual({ kind: "RECHECK", label: "상품평 목록을 열었습니다" });
    // 정상 상태에는 복구 UI가 없다.
    expect(s.failure).toBeNull();
  });

  it("로그인이 필요하면 같은 걸음에서 문장과 라벨만 바뀐다", () => {
    const s = reviewCollectionStateOf(input({ run: run({ blocker: { code: "LOGIN_REQUIRED", recoverable: true } }) }));
    expect(s.step).toBe("SURFACE");
    expect(s.primary).toEqual({ kind: "RECHECK", label: "로그인했습니다" });
    expect(s.failure).toBeNull();
  });

  it("스토어를 읽었으면 판매자가 답하는 질문은 그 하나뿐이다", () => {
    const s = reviewCollectionStateOf(
      input({
        readiness: { state: "STORE_IDENTITY_UNKNOWN", channelCode: "COUPANG" },
        run: run({ blocker: { code: "STORE_UNRESOLVED", recoverable: true } as never }),
        bootstrap: { state: "CANDIDATE", value: "A00000000" },
      }),
    );
    expect(s.step).toBe("STORE");
    expect(s.confirmStore).toBe("A00000000");
    expect(s.primary).toEqual({ kind: "CONFIRM_STORE", label: "이 스토어를 연결하고 가져오기" });
    // 실패로 표현하지 않는다: 스토어를 「확인하지 못했다」가 아니라 「이것이 맞나요」다.
    expect(s.failure).toBeNull();
  });

  it("스토어를 하나로 확정하지 못하면 고르게 하지 않고 직접 받는다", () => {
    const s = reviewCollectionStateOf(
      input({
        readiness: { state: "STORE_IDENTITY_UNKNOWN", channelCode: "COUPANG" },
        run: run({ blocker: { code: "STORE_UNRESOLVED", recoverable: true } as never }),
        bootstrap: { state: "AMBIGUOUS" },
      }),
    );
    expect(s.step).toBe("STORE");
    expect(s.askIdentity).toBe(true);
    expect(s.confirmStore).toBeNull();
  });

  it("이미 아는 계정에서는 스토어 걸음이 아예 일어나지 않는다", () => {
    const s = reviewCollectionStateOf(input({ run: run({}), bootstrap: { state: "CANDIDATE", value: "A0" } }));
    expect(s.step).toBe("SURFACE");
    expect(s.confirmStore).toBeNull();
  });

  it("다른 계정으로 로그인된 것은 스토어 걸음의 실패다", () => {
    const s = reviewCollectionStateOf(input({ run: run({ blocker: { code: "STORE_MISMATCH", recoverable: true } as never }) }));
    expect(s.step).toBe("STORE");
    expect(s.failure?.title).toBe("다른 판매자 계정으로 로그인되어 있습니다");
    expect(s.primary?.kind).toBe("RECHECK");
  });

  it("일하는 중에는 컨트롤이 없다", () => {
    expect(reviewCollectionStateOf(input({ run: run({ status: "RUNNING" }) })).step).toBe("COLLECTING");
    const s = reviewCollectionStateOf(input({ run: run({ status: "PROCESSING" }) }));
    expect(s.busy).toBe(true);
    expect(s.primary).toBeNull();
  });

  it("붙지 못한 것과 준비된 것은 다르다", () => {
    expect(reviewCollectionStateOf(input({ unavailable: "ready" })).step).toBe("SURFACE");
    expect(reviewCollectionStateOf(input({ unavailable: "ready" })).failure).toBeNull();
    expect(reviewCollectionStateOf(input({ unavailable: "not_running" })).failure).not.toBeNull();
  });

  it("주소로 들어온 방문은 아무것도 시작하지 않고, 시작을 판매자에게 돌려준다", () => {
    // 이 화면은 스스로 읽는다. 도착이 곧 수집이면 새로고침 한 번이 요청하지 않은 마켓플레이스 읽기가 된다.
    const s = reviewCollectionStateOf(input({ arrival: "VISITED", run: null }));
    expect(s.step).toBe("SURFACE");
    expect(s.primary).toEqual({ kind: "START", label: "지금 가져오기" });
    expect(s.busy).toBe(false);
  });

  it("눌러서 들어온 방문은 묻지 않는다", () => {
    const s = reviewCollectionStateOf(input({ arrival: "PRESSED", run: null }));
    expect(s.step).toBe("SURFACE");
    expect(s.busy).toBe(true);
    expect(s.primary).toBeNull();
  });

  it("읽는 중에는 판매자에게 아무것도 묻지 않는다 — 정상 흐름의 press는 0회다", () => {
    for (const status of ["PREPARING", "RUNNING", "PROCESSING"] as const) {
      const s = reviewCollectionStateOf(input({ run: run({ status }) }));
      expect(s.primary).toBeNull();
      expect(s.failure).toBeNull();
    }
  });

  it("끝난 run은 완료 걸음이다", () => {
    expect(reviewCollectionStateOf(input({ run: run({ status: "COMPLETED" }) })).step).toBe("DONE");
  });
});

function sync(over: Partial<SyncRunView>): SyncRunView {
  return {
    id: "r1",
    sellerAccountId: "acc",
    channelId: "ch",
    dataType: "REVIEW",
    trigger: "ACTION_WINDOW",
    attempt: 1,
    rateLimited: false,
    nextRetryAt: null,
    jobType: "AGENT_HANDOFF",
    uploadType: "REVIEW",
    status: "SUCCESS",
    totalRows: 0,
    successRows: 0,
    skippedRows: 0,
    failedRows: 0,
    errorMessage: null,
    startedAt: "2026-09-14T00:00:00Z",
    finishedAt: "2026-09-14T00:00:00Z",
    method: "SELLER_CENTER_READ",
    coverage: null,
    ...over,
  } as SyncRunView;
}

describe("화면 수집의 마지막 기록", () => {
  it("API로 가져온 기록은 이 카드의 사실이 아니다", () => {
    const runs = [sync({ id: "api", method: "API", finishedAt: "2026-09-14T10:00:00Z" })];
    expect(lastScreenRead(runs)).toBeNull();
  });

  it("실패한 실행은 마지막 수집이 아니다", () => {
    expect(lastScreenRead([sync({ status: "FAILED" })])).toBeNull();
  });

  it("저장 0으로 끝난 성공도 수집이다", () => {
    expect(lastScreenRead([sync({ successRows: 0 })])?.id).toBe("r1");
  });

  it("가장 최근 것을 고른다", () => {
    const runs = [
      sync({ id: "old", finishedAt: "2026-09-10T00:00:00Z" }),
      sync({ id: "new", finishedAt: "2026-09-13T00:00:00Z" }),
    ];
    expect(lastScreenRead(runs)?.id).toBe("new");
  });
});

describe("완료 문장 — 수를 지어내지 않는다", () => {
  it("저장된 수가 있으면 그 수를 말한다", () => {
    expect(collectedSentence({ kind: "STORED", run: sync({ successRows: 9 }) })).toContain("9개");
  });

  it("저장 0이면 「가져왔습니다」라고 말하지 않는다", () => {
    expect(collectedSentence({ kind: "STORED", run: sync({ successRows: 0 }) })).toBe(
      "새로 가져올 상품평이 없었습니다.",
    );
  });

  it("기록을 읽었고 새로 생긴 것이 없으면, 없었던 것이다", () => {
    expect(collectedSentence({ kind: "NONE" })).toBe("새로 가져올 상품평이 없었습니다.");
  });

  it("기록을 읽지 못한 것은 「없었다」가 아니다", () => {
    const said = collectedSentence({ kind: "UNKNOWN" });
    expect(said).not.toMatch(/\d/);
    expect(said).not.toContain("없었습니다");
  });
});

/**
 * <b>두 종류의 판매자, 두 개의 첫 걸음</b>(product-owner 확인, 2026-09-14).
 *
 * 이 화면의 첫 CTA가 판매자의 의도와 맞는지는 두 상태에서만 물으면 된다 — 아직 아무것도 연결하지 않은
 * 사람과, 계정은 연결돼 있는데 <b>이 브라우저</b>가 처음인 사람. 둘은 같은 화면에서 다른 문장을 받아야 하고,
 * 그 차이는 문구가 아니라 backend가 보내는 readiness 하나에서 나온다.
 *
 * 마켓플레이스 호출 없이 고정한다: 여기서 단언하는 것은 전부 순수 함수의 답이다.
 */
describe("첫 화면의 첫 걸음 — 두 종류의 판매자", () => {
  it("아무것도 연결하지 않은 판매자에게는 「연결」이 첫 걸음이다", () => {
    // 완전 신규: 도우미도 기기도 없고, 어느 스토어인지도 모르고, 가져온 상품평도 0이다.
    const card = reviewCardOf({ state: "HELPER_NOT_LINKED", channelCode: "COUPANG" });
    expect(card).toMatchObject({ kind: "SETUP", primaryLabel: "리뷰 수집 연결하기" });
    expect(card?.status.label).toBe("연결 필요");

    const first = reviewCollectionStateOf(
      input({ readiness: { state: "HELPER_NOT_LINKED", channelCode: "COUPANG" }, helperKey: "INSTALL", run: null }),
    );
    expect(first.step).toBe("HELPER");
    expect(first.primary).toEqual({ kind: "HELPER" });
  });

  it("계정은 연결됐고 이 브라우저만 처음인 판매자에게는 「가져오기」가 첫 걸음이고, 준비는 그 뒤에서 스스로 붙는다", () => {
    // 카드는 계정의 사실을 말한다 — 이 계정은 연결돼 있다. 브라우저가 처음이라는 것은 카드가 아는 일이
    // 아니고(그것은 이 PC의 사실이다), 눌렀을 때 흐름의 첫 걸음이 스스로 밝힌다.
    const card = reviewCardOf({ state: "READY", channelCode: "COUPANG" });
    expect(card).toMatchObject({ kind: "READY", primaryLabel: "지금 가져오기" });

    const afterPress = reviewCollectionStateOf(
      input({ readiness: { state: "READY", channelCode: "COUPANG" }, helperKey: "INSTALL", run: null }),
    );
    // 복구는 처음부터 다시 하는 것이 아니라, 막힌 그 걸음에서 시작한다.
    expect(afterPress.step).toBe("HELPER");
    expect(afterPress.primary).toEqual({ kind: "HELPER" });
    expect(afterPress.failure).toBeNull();
  });

  it("도우미가 준비된 뒤에는 두 판매자가 같은 자리에 선다", () => {
    const ready = reviewCollectionStateOf(input({ helperKey: "CONNECTED", run: null }));
    expect(ready.step).toBe("SURFACE");
    expect(ready.busy).toBe(true);
  });
});
