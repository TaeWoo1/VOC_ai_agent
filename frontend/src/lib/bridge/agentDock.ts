import type { BridgePhase } from "./bridgeClient";
import { BRIDGE_TOKEN_KEY } from "./bridgeClient";

/**
 * **What the SellerOps 도우미 dock may show, and when.** (Agent UX cleanup, 2026-08-19.)
 *
 * The dock used to be a status console pinned to every screen: a new seller saw "내 PC 연결 / 로컬 에이전트에
 * 연결하지 못했습니다" the moment they signed up, although nothing they were doing needed the helper. The rule is
 * now:
 *
 * - **Quiet by default.** A seller who never connected the helper sees nothing here — the screens that actually
 *   need it (NAVER 리뷰 수집, Coupang 상품평 찾기, guided issuance) carry their own "SellerOps 도우미가 필요합니다"
 *   panel with the connect action (`AgentPairingPanel`).
 * - **Connected → a small chip.** Presence only; details on request.
 * - **Was connected, now broken → a reconnect notice.** "Was connected" means a pairing this browser remembers
 *   (stored token) or a `paired` phase seen during this page load; "broken" means the helper went away, the socket
 *   dropped, the agent revoked us, refused us, or needs an update. A first-load `connecting` with a remembered
 *   pairing is not broken yet — the notice waits for the first proven-broken phase and then stays through the
 *   1.5 s `connecting ↔ unreachable` retry cycle instead of flickering.
 *
 * Pure: the component feeds phases in and renders what comes out, so every branch is testable without a bridge.
 * Nothing here touches pairing, the bridge client, or any live flow — only what is shown.
 */

export type DockNotice = "agent_off" | "dropped" | "revoked" | "denied" | "incompatible";

export interface DockMemory {
  /** A pairing this browser held before (stored token at mount) or reached during this page load. */
  remembered: boolean;
  /** The last proven-broken phase seen while `remembered`; null = never broken (or connected again since). */
  notice: DockNotice | null;
}

export type DockView =
  | { kind: "hidden" }
  | { kind: "connected" }
  | { kind: "reconnect"; notice: DockNotice; retrying: boolean }
  /** The seller pressed 다시 연결 on the notice: the pairing code has to be confirmed in the helper's window. */
  | { kind: "pairing" };

const BROKEN_NOTICE: Partial<Record<BridgePhase, DockNotice>> = {
  unreachable: "agent_off",
  disconnected: "dropped",
  revoked: "revoked",
  pairing_denied: "denied",
  incompatible_version: "incompatible",
};

/** Does this browser remember a pairing? Read once at mount; only its presence, never the value. */
export function hasStoredPairing(storage: Pick<Storage, "getItem"> | undefined = safeLocalStorage()): boolean {
  try {
    return Boolean(storage?.getItem(BRIDGE_TOKEN_KEY));
  } catch {
    return false;
  }
}

function safeLocalStorage(): Pick<Storage, "getItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function initialDockMemory(remembered: boolean): DockMemory {
  return { remembered, notice: null };
}

/** Fold one observed phase into what the dock remembers. Returns the same object when nothing changed. */
export function nextDockMemory(memory: DockMemory, phase: BridgePhase): DockMemory {
  if (phase === "paired") return memory.remembered && memory.notice === null ? memory : { remembered: true, notice: null };
  // A deliberate 연결 해제 lands on `unpaired` with the token cleared: forget, so the dock goes quiet again.
  if (phase === "unpaired") return !memory.remembered && memory.notice === null ? memory : { remembered: false, notice: null };
  const notice = BROKEN_NOTICE[phase];
  if (!notice) return memory;
  // `revoked` can only be reached from a held token, so it counts as a remembered pairing even on a fresh load.
  const remembered = memory.remembered || phase === "revoked";
  if (!remembered) return memory;
  return remembered === memory.remembered && notice === memory.notice ? memory : { remembered, notice };
}

export function dockView(memory: DockMemory, phase: BridgePhase): DockView {
  if (phase === "paired") return { kind: "connected" };
  if (!memory.remembered || memory.notice === null) return { kind: "hidden" };
  if (phase === "unpaired") return { kind: "hidden" };
  if (phase === "pairing_pending") return { kind: "pairing" };
  const current = BROKEN_NOTICE[phase];
  if (current) return { kind: "reconnect", notice: current, retrying: false };
  // connecting / connecting_ws / pairing_pending between broken phases: keep the notice, mark it as retrying.
  return { kind: "reconnect", notice: memory.notice, retrying: true };
}

/** Seller-facing words. "SellerOps 도우미", never "로컬 에이전트". */
export const DOCK_COPY = {
  connected: "SellerOps 도우미 연결됨",
  connectedDetail: "이 브라우저가 내 PC의 SellerOps 도우미와 연결되어 있어요.",
  noChannels: "도우미가 맡고 있는 채널 연결이 아직 없어요.",
  disconnect: "연결 해제",
  reconnect: "다시 연결",
  retrying: "다시 연결하는 중…",
  pairing: "내 PC에 열린 창에서 아래 숫자가 같은지 확인하고 허용을 눌러 주세요.",
  pairingWaiting: "확인을 기다리는 중…",
  pairingReopen: "허용 창이 안 열렸나요? 다시 열기",
  notice: {
    agent_off: { title: "SellerOps 도우미와 연결이 끊어졌어요", body: "내 PC에서 도우미가 꺼진 것 같아요. 도우미를 실행하면 자동으로 다시 연결돼요." },
    dropped: { title: "SellerOps 도우미와 연결이 끊어졌어요", body: "잠시 후 자동으로 다시 연결해요. 계속 안 되면 내 PC의 도우미가 실행 중인지 확인해 주세요." },
    revoked: { title: "SellerOps 도우미 연결이 해제됐어요", body: "내 PC의 도우미에서 이 브라우저의 연결이 해제됐어요. 다시 연결해 주세요." },
    denied: { title: "SellerOps 도우미 연결이 거부됐어요", body: "다시 연결하고, 내 PC에 열리는 창에서 허용을 눌러 주세요." },
    incompatible: { title: "SellerOps 도우미 업데이트가 필요해요", body: "SellerOps 또는 내 PC의 도우미를 최신 버전으로 업데이트해 주세요." },
  } satisfies Record<DockNotice, { title: string; body: string }>,
} as const;
