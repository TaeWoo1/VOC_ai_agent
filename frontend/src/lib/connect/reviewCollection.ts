import type { ActionWindowRunView } from "../actionWindow/contract";
import type { AcquisitionReadinessView } from "../acquisitionReadiness";
import type { StoreIdentityBootstrap } from "../storeIdentityBootstrap";
import type { SyncRunView } from "../types";

/**
 * <b>브라우저 리뷰 수집 한 번을, 판매자가 읽을 수 있는 다섯 걸음으로.</b>
 *
 * <p>이 lane의 사실은 네 곳에 흩어져 있다 — 계정의 preconditions(backend readiness), 이 PC의 도우미
 * (bridge), 열려 있는 판매자 화면(run view), 그리고 그 화면이 어느 스토어인가(도우미의 bootstrap 응답).
 * 지금까지는 네 곳이 각자 자기 말로 화면에 나타났고, 그래서 하나의 질문에 세 개의 답이 동시에 서 있었다
 * (라이브 2026-09-14: 확인 카드 · 「어느 스토어인지 아직 모릅니다」 · run 패널의 「어느 판매자 계정인지
 * 확인하지 못했어요」 + [확인 완료]). 이 모듈이 그 넷을 <b>한 번에 하나의 걸음</b>으로 접는다.
 *
 * <p><b>press가 사라지는 것이 아니라 기술어가 사라진다.</b> 취득 엔진은 대상이 해석된 뒤 반드시 멈추고
 * 사람의 press를 기다린다(<code>review-acquisition-engine.ts</code>: "Rest on the seller at the per-page
 * barrier … the seller's press is what lifts the barrier — every time"). 그 장벽은 「reviewnary가 대신
 * 클릭하지 않는다」를 강제하는 장치이므로 유지하고, 대신 그 press를 판매자가 <b>실제로 한 일</b>로 부른다
 * — 「상품평 목록을 열었습니다」 · 「로그인했습니다」. 커맨드는 그대로 <code>REQUEST_STEP_RECHECK</code>이고
 * 엔진·계약은 한 글자도 바뀌지 않는다. 「확인 완료」 · 「직접 진행」 · 「안내를 준비하고 있어요」는 이 lane의
 * 화면에서 사라진다.
 *
 * <p><b>판매자가 답하는 질문은 하나뿐이다</b> — 어느 스토어인가. 그리고 그것은 우리가 이미 알고 있으면
 * (<code>readiness=READY</code>) 아예 렌더되지 않는다: 확인이 「1회」인 것이 문구가 아니라 구조다.
 *
 * <p>carrier · slot · provider · bridge · Action Window · recheck 같은 우리 쪽 낱말은 이 파일에서
 * 판매자 문장으로 나가지 않는다.
 */

export type ReviewCollectionStepId = "HELPER" | "SURFACE" | "STORE" | "COLLECTING" | "DONE";

/**
 * <b>이 방문이 수집을 시작해도 되는가.</b>
 *
 * `PRESSED`는 판매자가 방금 [지금 가져오기]를 눌러서 이 화면에 왔다는 뜻이고, `VISITED`는 주소로 왔다는
 * 뜻이다(북마크 · 새로고침 · 뒤로가기). 이 구분이 필요한 이유는 <b>이 화면이 이제 스스로 읽기 때문</b>이다 —
 * 수집이 press가 아니라 <b>도착</b>으로 시작하면, 새로고침 한 번이 판매자가 요청하지 않은 마켓플레이스
 * 읽기가 된다. 명시적 개시는 이 lane이 약화시키지 않기로 한 성질이다.
 */
export type ReviewCollectionArrival = "PRESSED" | "VISITED";

/** 화면 위의 걸음. `STORE`는 이미 아는 계정에서는 건너뛰므로 진행 표시에서도 빠진다. */
export const REVIEW_COLLECTION_STEPS: readonly { id: ReviewCollectionStepId; label: string }[] = [
  { id: "HELPER", label: "수집 준비" },
  { id: "SURFACE", label: "쿠팡 판매자 화면" },
  { id: "STORE", label: "스토어 확인" },
  { id: "COLLECTING", label: "가져오는 중" },
  { id: "DONE", label: "완료" },
];

/**
 * 이 걸음에서 판매자가 누를 수 있는 단 하나.
 *
 * `RECHECK`는 그 press가 보내는 커맨드의 이름이지 라벨이 아니다 — 라벨은 판매자가 방금 한 일을 말한다.
 */
export type ReviewCollectionControl =
  | { kind: "START"; label: string }
  | { kind: "RECHECK"; label: string }
  | { kind: "CONFIRM_STORE"; label: string }
  | { kind: "HELPER" }
  | { kind: "FINISH"; label: string };

export interface ReviewCollectionState {
  step: ReviewCollectionStepId;
  /** 1-based. `STORE`를 건너뛴 진행에서도 사람이 세는 순서 그대로. */
  index: number;
  title: string;
  /** 지금 무엇을 하면 되는가. 항상 한 문단. */
  body: string;
  /**
   * 이 걸음이 실패했을 때만. 정상 상태에서는 null이고, 그래서 복구 UI는 실패한 자리에만 나타난다.
   * (NN/g Smart Device Onboarding §5 — 오류는 발생한 지점에서, 구체적으로.)
   */
  failure: { title: string; body: string } | null;
  primary: ReviewCollectionControl | null;
  /** 업체코드를 직접 받아야 하는가 — 화면에서 읽지 못했거나 둘 이상이었을 때. */
  askIdentity: boolean;
  /** 확인할 스토어 값. null이면 확인 카드를 그리지 않는다. */
  confirmStore: string | null;
  /** 기다리는 중 — 컨트롤이 없는 것이 정상이다. */
  busy: boolean;
}

export interface ReviewCollectionInput {
  /** backend의 계정 preconditions. null = 아직 못 읽었다(걸음을 주장하지 않는다). */
  readiness: AcquisitionReadinessView | null;
  /**
   * 이 PC의 도우미 상태 <b>한 단어</b>(`HelperState.key`). null = 아직 답하지 않았다.
   *
   * 객체가 아니라 단어인 것이 중요하다 — 이 화면이 도우미에 대해 알아야 하는 것은 「준비됐는가」뿐이고,
   * 문장과 버튼은 그 카드가 소유한다. 상태로 객체를 들면 같은 뜻의 새 객체가 렌더마다 새 값이 되어
   * 화면이 자기를 다시 그린다.
   */
  helperKey: string | null;
  run: ActionWindowRunView | null;
  /**
   * attach가 거절됐을 때의 사유(취득 lane이 이미 쓰는 닫힌 어휘). `"ready"`는 거절이 아니므로 호출자가
   * 그것을 여기로 넘기지 않는다 — 이 칸은 「붙지 못했다」만 담는다.
   */
  unavailable: string | null;
  /** 도우미가 화면에서 본 스토어. null = 물어보지 못했다(≠ 「없다」). */
  bootstrap: StoreIdentityBootstrap | null;
  /** 이 화면이 run을 띄우는 중에 실패했는가. */
  startFailed: boolean;
  /** 판매자가 눌러서 왔는가, 주소로 왔는가. */
  arrival: ReviewCollectionArrival;
}

const OPENED_LIST = "상품평 목록을 열었습니다";
const SIGNED_IN = "로그인했습니다";

/**
 * park한 run의 blocker를 <b>걸음</b>으로 옮긴다.
 *
 * blocker 어휘는 취득 lane 전체가 공유하는 것이라 여기서 바꾸지 않는다. 바뀌는 것은 그 코드가 어느 걸음의
 * 문제로 읽히는가와, 그 걸음에서 무엇을 누르게 되는가다.
 */
function surfaceBlocker(code: string): {
  step: "SURFACE" | "STORE";
  title: string;
  body: string;
  label: string;
  failure: boolean;
} {
  switch (code) {
    case "LOGIN_REQUIRED":
    case "SESSION_EXPIRED":
      return {
        step: "SURFACE",
        title: "쿠팡에 로그인해 주세요",
        body: "열린 쿠팡 창에서 로그인한 뒤, 상품평 목록을 열어 주세요.",
        label: SIGNED_IN,
        failure: false,
      };
    case "SURFACE_CLOSED":
      return {
        step: "SURFACE",
        title: "쿠팡 창이 닫혔습니다",
        body: "다시 열고 상품평 목록을 띄우면 이어서 가져옵니다.",
        label: "쿠팡 창 다시 열기",
        failure: true,
      };
    case "STORE_MISMATCH":
      return {
        step: "STORE",
        title: "다른 판매자 계정으로 로그인되어 있습니다",
        body: "이 채널에 연결한 스토어로 로그인한 뒤, 상품평 목록을 열어 주세요.",
        label: OPENED_LIST,
        failure: true,
      };
    case "EXECUTOR_UNAVAILABLE":
      return {
        step: "SURFACE",
        title: "수집 프로그램이 실행되고 있지 않습니다",
        body: "쿠팡 화면에는 문제가 없습니다. 도우미를 실행한 뒤 다시 눌러 주세요.",
        label: "다시 시도",
        failure: true,
      };
    case "HANDOFF_REJECTED":
    case "INGEST_FAILED":
      return {
        step: "SURFACE",
        title: "읽은 상품평을 저장하지 못했습니다",
        body: "저장된 상품평은 없습니다. 잠시 뒤 다시 가져와 주세요.",
        label: "다시 시도",
        failure: true,
      };
    case "RUNTIME_FAULT":
      return {
        step: "SURFACE",
        title: "가져오는 중 문제가 생겼습니다",
        body: "저장된 상품평은 없습니다. 잠시 뒤 다시 시도해 주세요.",
        label: "다시 시도",
        failure: true,
      };
    default:
      // UNSUPPORTED_STATE · UI_DRIFT · TARGET_* — 전부 같은 하나의 수리: 다시 읽는 것.
      //
      // **문장이 양쪽 공급자에 대해 참이어야 한다.** 화면을 직접 여는 공급자에서는 「목록을 열어 주세요」가
      // 이미 연 창에 대한 지시가 되고, 판매자가 걸어가는 공급자에서는 여전히 옳다. 그래서 무엇을 확인할지만
      // 말하고, 누가 열었는지는 말하지 않는다.
      return {
        step: "SURFACE",
        title: "상품평 목록을 읽지 못했습니다",
        body: "쿠팡 창에 상품평 목록이 열려 있는지 확인한 뒤 다시 시도해 주세요.",
        label: "다시 시도",
        failure: false,
      };
  }
}

function at(step: ReviewCollectionStepId): number {
  return REVIEW_COLLECTION_STEPS.findIndex((s) => s.id === step) + 1;
}

function state(step: ReviewCollectionStepId, rest: Omit<ReviewCollectionState, "step" | "index">): ReviewCollectionState {
  return { step, index: at(step), ...rest };
}

const BLANK = {
  failure: null,
  primary: null,
  askIdentity: false,
  confirmStore: null,
  busy: false,
} as const;

/**
 * 네 개의 사실 → 한 걸음.
 *
 * 순서가 곧 규칙이다. 도우미가 먼저인 이유는 그것이 없으면 다른 셋을 물어볼 수단 자체가 없기 때문이고,
 * 아직 답하지 않은 읽기는 걸음을 <b>주장하지 않는다</b> — 읽지 못한 사실은 참인 사실이 아니다.
 */
export function reviewCollectionStateOf(input: ReviewCollectionInput): ReviewCollectionState {
  const { readiness, helperKey, run, bootstrap, unavailable, startFailed, arrival } = input;

  if (!readiness || !helperKey) {
    return state("HELPER", { ...BLANK, title: "수집 준비", body: "준비 상태를 확인하고 있습니다.", busy: true });
  }

  // 1) 이 PC의 도우미. 카드가 자기 말과 자기 버튼을 이미 갖고 있으므로 여기서는 그것을 가리킨다.
  if (helperKey !== "CONNECTED") {
    return state("HELPER", {
      ...BLANK,
      title: "브라우저 수집 준비",
      // 「열어 둔 판매자 화면」은 판매자가 연다는 뜻이었고, 이 공급자에서는 제품이 연다. 시스템이 하는 일을
      // 판매자에게 시키는 문장은 이 lane에서 고쳐야 하는 바로 그 종류다.
      body: "쿠팡 판매자센터 화면을 열어 상품평을 읽어 옵니다. 그 화면과 함께 일할 도우미가 필요합니다.",
      primary: { kind: "HELPER" },
    });
  }

  if (unavailable && unavailable !== "ready") {
    return state("SURFACE", {
      ...BLANK,
      title: "도우미와 연결하지 못했습니다",
      body: "도우미가 실행 중인지 확인한 뒤 다시 시작해 주세요.",
      failure: {
        title: unavailable === "wrong_carrier" ? "도우미가 다른 작업을 진행 중입니다" : "도우미를 찾지 못했습니다",
        body:
          unavailable === "wrong_carrier"
            ? "진행 중인 작업을 마친 뒤 다시 시작해 주세요."
            : "도우미를 실행한 뒤 다시 시작해 주세요.",
      },
    });
  }

  if (startFailed) {
    return state("SURFACE", {
      ...BLANK,
      title: "쿠팡 판매자 화면",
      body: "쿠팡 창을 준비하지 못했습니다.",
      failure: { title: "쿠팡 창을 열지 못했습니다", body: "잠시 뒤 다시 시작해 주세요." },
    });
  }

  // 주소로 들어온 방문은 아무것도 시작하지 않는다. 시작은 언제나 판매자의 press다.
  if (arrival === "VISITED" && !run) {
    return state("SURFACE", {
      ...BLANK,
      title: "상품평을 가져올 준비가 됐습니다",
      body: "누르시면 쿠팡 판매자센터의 상품평 목록을 열어 이번 페이지를 읽어 옵니다.",
      primary: { kind: "START", label: "지금 가져오기" },
    });
  }

  // 2) run이 아직 없다 = 창을 여는 중.
  if (!run) {
    return state("SURFACE", {
      ...BLANK,
      title: "쿠팡 판매자센터를 여는 중입니다",
      body: "상품평 목록을 열어 이번 페이지를 읽어 옵니다.",
      busy: true,
    });
  }

  if (run.status === "COMPLETED") {
    return state("DONE", { ...BLANK, title: "완료", body: "" });
  }
  if (run.status === "FAILED" || run.status === "CANCELLED") {
    const blocked = run.blocker ? surfaceBlocker(run.blocker.code) : null;
    return state("SURFACE", {
      ...BLANK,
      title: "쿠팡 판매자 화면",
      body: "가져오기가 끝나지 않았습니다.",
      failure: blocked
        ? { title: blocked.title, body: blocked.body }
        : { title: "가져오기를 마치지 못했습니다", body: "잠시 뒤 다시 시작해 주세요." },
    });
  }

  if (run.status === "WAITING_FOR_HUMAN") {
    const code: string | undefined = run.blocker?.code;

    // 3) 스토어 확인 — 이 lane에서 판매자가 답하는 유일한 질문.
    if (code === "STORE_UNRESOLVED" || (readiness.state === "STORE_IDENTITY_UNKNOWN" && !code)) {
      if (bootstrap?.state === "CANDIDATE") {
        return state("STORE", {
          ...BLANK,
          title: "이 스토어가 맞나요?",
          body: "열려 있는 쿠팡 판매자 화면에서 읽은 스토어입니다. 확인해 주시면 이 스토어의 상품평을 가져옵니다.",
          confirmStore: bootstrap.value,
          primary: { kind: "CONFIRM_STORE", label: "이 스토어를 연결하고 가져오기" },
        });
      }
      return state("STORE", {
        ...BLANK,
        title: "스토어 확인",
        body:
          bootstrap?.state === "AMBIGUOUS"
            ? "화면에서 스토어를 하나로 확정하지 못했습니다. 쿠팡 판매자 화면에 표시되는 업체코드를 입력해 주세요."
            : "열려 있는 화면이 어느 스토어인지 확인하고 있습니다. 확인되지 않으면 업체코드를 직접 입력할 수 있습니다.",
        askIdentity: bootstrap !== null,
        busy: bootstrap === null,
      });
    }

    if (!code) {
      return state("SURFACE", {
        ...BLANK,
        title: "쿠팡 창에서 상품평 목록을 열어 주세요",
        body: "로그인이 되어 있지 않으면 먼저 로그인해 주세요. reviewnary는 대신 클릭하거나 입력하지 않습니다.",
        primary: { kind: "RECHECK", label: OPENED_LIST },
      });
    }

    const blocked = surfaceBlocker(code);
    return state(blocked.step, {
      ...BLANK,
      title: blocked.failure ? (blocked.step === "STORE" ? "스토어 확인" : "쿠팡 판매자 화면") : blocked.title,
      body: blocked.failure ? "" : blocked.body,
      failure: blocked.failure ? { title: blocked.title, body: blocked.body } : null,
      primary: { kind: "RECHECK", label: blocked.label },
    });
  }

  // PREPARING · RUNNING · PROCESSING · PAUSED — 우리가 일하는 중.
  if (run.status === "PROCESSING") {
    return state("COLLECTING", { ...BLANK, title: "가져온 상품평을 저장하는 중입니다", body: "잠시만 기다려 주세요.", busy: true });
  }
  return state("COLLECTING", { ...BLANK, title: "상품평을 가져오는 중입니다", body: "잠시만 기다려 주세요.", busy: true });
}

/* ── 채널 화면이 읽는 사실 ──────────────────────────────────────────────────────── */

/**
 * 이 계정의 <b>화면 수집</b> 마지막 성공.
 *
 * 「연결 상태」의 마지막 수집은 API lane의 것이라 이 카드가 쓸 수 없다 — 같은 이름의 다른 사실이다.
 * 여기서는 실행 기록 중 <code>SELLER_CENTER_READ</code>로 끝난 것만 본다. 저장 0으로 끝난 성공도
 * 성공이므로(가져올 새 상품평이 없었다는 뜻이다) 행 수로 거르지 않는다.
 */
export function lastScreenRead(runs: readonly SyncRunView[]): SyncRunView | null {
  const done = runs.filter(
    (r) => r.method === "SELLER_CENTER_READ" && (r.status === "SUCCESS" || r.status === "PARTIAL"),
  );
  let best: SyncRunView | null = null;
  for (const run of done) {
    const at = run.finishedAt ?? run.startedAt;
    if (!at) continue;
    const bestAt = best ? best.finishedAt ?? best.startedAt : null;
    if (!bestAt || new Date(at).getTime() > new Date(bestAt).getTime()) best = run;
  }
  return best;
}

/**
 * 이 걸음이 남긴 것.
 *
 * `STORED`는 이 걸음이 만든 기록, `NONE`은 기록을 <b>읽었고</b> 새로 생긴 것이 없는 경우(엔진은 빈 배치를
 * 넘기지 않으므로 아무것도 저장하지 않은 걸음은 기록을 남기지 않는다), `UNKNOWN`은 기록을 읽지 못한 경우다.
 * 뒤의 둘을 합치면, 읽지 못한 것을 「없었다」고 말하게 된다 — 이 저장소가 다른 모든 곳에서 거부하는 그 문장.
 */
export type CollectionReceipt =
  | { kind: "STORED"; run: SyncRunView }
  | { kind: "NONE" }
  | { kind: "UNKNOWN" };

/**
 * 완료 문장 — <b>성공 수를 지어내지 않는다.</b>
 *
 * (`FirstSourceSummary`가 첫 연결에 대해 세운 규칙과 같다: 숫자는 종료된 실행이 실제로 저장한 수에서만 온다.)
 */
export function collectedSentence(receipt: CollectionReceipt): string {
  if (receipt.kind === "STORED" && receipt.run.successRows > 0) {
    return `상품평 ${receipt.run.successRows.toLocaleString("ko-KR")}개를 가져왔습니다.`;
  }
  if (receipt.kind === "UNKNOWN") return "가져오기가 끝났습니다.";
  return "새로 가져올 상품평이 없었습니다.";
}
