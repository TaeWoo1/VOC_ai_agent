// **What the 상품평 screen says while `[쿠팡에서 보기]` is working, and afterwards.**
//
// Its own copy rather than `blockerView`'s, because the SAME blocker code means a different thing here.
// `TARGET_NOT_FOUND` on a guided walk is "버튼을 찾지 못했어요" — a control that should be on the page and
// is not. On a locate it is "this review is not on the page you are looking at", which is not a fault at
// all: the seller turns a page and it resolves. Rendering the guided-walk wording here would tell a seller
// something is broken every time they are on page 2.
//
// Copy lives on the FE, per the contract's copy ownership. The runtime sends the enums; this turns them into
// the sentences this one surface needs.
import type { ActionWindowRunView } from "../../../../../contracts/action-window/v2/index";
import type { LocateUnavailable } from "./useReviewLocate";

export type LocateTone = "working" | "done" | "waiting" | "failed";

export interface LocateMessage {
  tone: LocateTone;
  text: string;
  /** True while the run can still resolve by itself — the screen says so instead of offering a dead button. */
  looking: boolean;
}

/** Why the press never reached a run. Each names a different thing to do about it. */
const UNAVAILABLE_TEXT: Record<LocateUnavailable, string> = {
  "bridge-disabled": "이 환경에서는 로컬 에이전트 연결이 꺼져 있습니다.",
  unpaired: "SellerOps 로컬 에이전트와 아직 연결되지 않았습니다. 채널 설정에서 연결한 뒤 다시 눌러 주세요.",
  "ticket-rejected": "로컬 에이전트 연결이 거절되었습니다. 채널 설정에서 다시 연결해 주세요.",
  unreachable: "SellerOps 로컬 에이전트가 실행 중이 아닙니다. 에이전트를 켠 뒤 다시 눌러 주세요.",
  "no-announcement": "로컬 에이전트가 응답하지 않습니다. 에이전트를 다시 시작한 뒤 눌러 주세요.",
  "transport-version-mismatch": "로컬 에이전트 버전이 맞지 않습니다. 에이전트를 업데이트해 주세요.",
  // The agent is up but doing something else entirely — say that, rather than "연결할 수 없습니다".
  "carrier-mismatch": "로컬 에이전트가 지금 다른 작업을 하고 있어 상품평을 찾아드릴 수 없습니다.",
  "start-refused": "로컬 에이전트가 이 요청을 받지 않았습니다. 잠시 후 다시 눌러 주세요.",
  "mint-failed": "이 상품평은 지금 찾아드릴 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

export function locateUnavailableText(reason: LocateUnavailable): string {
  return UNAVAILABLE_TEXT[reason] ?? "상품평을 찾아드릴 수 없습니다.";
}

/**
 * The one line the 상세 panel shows for a locate run.
 *
 * <p>`looking` is what keeps the parks honest. When the review is simply not on the visible page, the run is
 * still reading as the seller turns pages — so the copy says "넘겨 보세요" and the screen does not pretend a
 * button press is required. When the window was closed, nothing is watching, and the copy asks for the one
 * thing only they can do.
 */
export function locateMessage(view: ActionWindowRunView | null, starting: boolean): LocateMessage | null {
  if (starting) return { tone: "working", text: "쿠팡 화면에서 찾는 중…", looking: true };
  if (view === null) return null;
  const code = view.blocker?.code;
  switch (view.status) {
    case "PREPARING":
    case "RUNNING":
    case "PROCESSING":
      return { tone: "working", text: "쿠팡 화면에서 찾는 중…", looking: true };
    case "COMPLETED":
      return {
        tone: "done",
        text: "쿠팡 화면에서 이 상품평에 테두리를 그렸습니다.",
        looking: false,
      };
    case "WAITING_FOR_HUMAN":
      if (code === "TARGET_AMBIGUOUS") {
        return {
          tone: "waiting",
          // The one refusal that a page turn will not fix — so it does not tell them to turn one.
          text:
            "상품·옵션·등록일·별점·내용이 모두 같은 상품평이 이 페이지에 둘 이상 있어 어느 줄인지 가릴 수 " +
            "없습니다. 잘못된 줄을 표시하지 않기 위해 아무것도 표시하지 않았습니다.",
          looking: false,
        };
      }
      if (code === "SURFACE_CLOSED") {
        return {
          tone: "waiting",
          text: "쿠팡 창이 닫혔습니다. 창을 다시 열어 상품평 목록으로 이동한 뒤 [다시 확인]을 눌러 주세요.",
          looking: false,
        };
      }
      if (code === "UNSUPPORTED_STATE") {
        return {
          tone: "waiting",
          text: "쿠팡 창에 상품평 목록 화면을 띄워 주세요. 띄우시면 잠시 자동으로 다시 확인합니다.",
          looking: true,
        };
      }
      return {
        tone: "waiting",
        // It says "for a while" rather than "continuously": the look-again loop is BOUNDED (ten minutes), and
        // when it ends nothing tells the seller. Promising it never stops would leave them paging at a run
        // that had quietly stopped watching — so the copy points at the button that always works.
        text:
          "지금 보이는 쿠팡 페이지에는 이 상품평이 없습니다. 쿠팡 창에서 페이지를 넘겨 보세요 — 넘기시는 " +
          "동안 잠시 자동으로 다시 확인합니다. 한참 뒤라면 [다시 확인]을 눌러 주세요.",
        looking: true,
      };
    case "FAILED":
      return {
        tone: "failed",
        text: "요청이 만료되었습니다. [쿠팡에서 보기]를 다시 눌러 주세요.",
        looking: false,
      };
    case "CANCELLED":
      return { tone: "waiting", text: "찾기를 멈췄습니다.", looking: false };
    default:
      return { tone: "working", text: "쿠팡 화면에서 찾는 중…", looking: true };
  }
}
