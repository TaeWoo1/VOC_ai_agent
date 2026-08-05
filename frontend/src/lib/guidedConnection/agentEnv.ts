// Local Agent environment status (pure, sanitized).
//
// The walkthrough must guide the DIFFERENT Local-Agent situations differently, because their fixes differ:
//   • the agent is NOT RUNNING (off / not installed / blocked)      → "run the helper, then retry",
//   • the agent is paired but hosting a DIFFERENT run/session        → "restart the helper, then retry",
//   • a pairing state (not paired / pending / denied / revoked …)    → its own pairing action.
// Collapsing "not running" and "different run" into one message sends the operator down the wrong fix.
//
// This classifier derives the situation ONLY from signals that already exist — the bridge phase and an
// optional Action Window host refusal reason. It invents NO new agent-run↔walkthrough-run linkage, and it
// never guesses a run id. Everything here is a pure string/enum mapping: no DOM, no network, no secret,
// selector, url, or account id.

import type { BridgePhase } from "../bridge/bridgeClient";
import type { AwRefusalReason } from "../actionWindow/wsTransport";

/** Distinct, user-actionable Local-Agent situations. Each maps to its own copy + next action. */
export type AgentEnvCode =
  | "PAIRED" // connected and able to host — healthy
  | "CONNECTING" // transient: detecting / reconnecting
  | "NOT_RUNNING" // the Local Agent process is not reachable (off / not installed / LNA-blocked)
  | "NOT_PAIRED" // reachable but not yet paired
  | "PAIRING_PENDING" // waiting for the operator to confirm the code in the agent's own window
  | "PAIRING_BLOCKED" // denied / revoked / incompatible version — the fix is not a plain retry
  | "SESSION_MISMATCH" // paired, but the agent is hosting a DIFFERENT run/session than this walkthrough
  | "HOST_UNAVAILABLE"; // paired, but the agent cannot host the guidance run right now

export interface AgentEnvStatus {
  code: AgentEnvCode;
  /** Which layer the operator must act on: the agent itself, the run/environment, or nothing (healthy). */
  fault: "agent" | "environment" | "none";
  /** Whether a plain retry (re-detect / re-pair) is the right next action. */
  canRetry: boolean;
  /** Whether the agent-free text fallback should be offered as a way forward. */
  offerTextFallback: boolean;
}

/**
 * Classify the Local-Agent situation from the bridge phase and (once paired) an optional host refusal.
 *
 * Precedence: before the agent is `paired` the bridge phase is the whole story — a host refusal is not yet
 * meaningful. Once `paired`, the host refusal distinguishes "hosting a different run" (`carrier-mismatch`)
 * from "cannot host the guidance" from a transient drop. Absent signals fail SAFE: no refusal on a paired
 * agent reads as healthy `PAIRED` (never a fabricated mismatch), mirroring the binding logic's absence≠signal.
 */
export function classifyAgentEnv(input: {
  bridgePhase: BridgePhase;
  hostRefusal?: AwRefusalReason | null;
}): AgentEnvStatus {
  const { bridgePhase, hostRefusal } = input;

  if (bridgePhase !== "paired") {
    switch (bridgePhase) {
      case "unreachable":
        return { code: "NOT_RUNNING", fault: "agent", canRetry: true, offerTextFallback: true };
      case "connecting":
      case "connecting_ws":
      case "disconnected":
        return { code: "CONNECTING", fault: "none", canRetry: true, offerTextFallback: false };
      case "unpaired":
        return { code: "NOT_PAIRED", fault: "agent", canRetry: true, offerTextFallback: false };
      case "pairing_pending":
        return { code: "PAIRING_PENDING", fault: "none", canRetry: false, offerTextFallback: false };
      case "pairing_denied":
      case "revoked":
        return { code: "PAIRING_BLOCKED", fault: "agent", canRetry: true, offerTextFallback: true };
      case "incompatible_version":
        // A version mismatch is not fixed by re-pairing — the app must be updated. Retry is not the action.
        return { code: "PAIRING_BLOCKED", fault: "agent", canRetry: false, offerTextFallback: true };
    }
  }

  // Paired.
  switch (hostRefusal) {
    case "carrier-mismatch":
      // The agent is connected but hosting a different run/session — restart the agent for THIS run.
      return { code: "SESSION_MISMATCH", fault: "environment", canRetry: true, offerTextFallback: true };
    case "unreachable":
      // Paired then the host became unreachable → treat as the agent no longer running.
      return { code: "NOT_RUNNING", fault: "agent", canRetry: true, offerTextFallback: true };
    case "bridge-disabled":
    case "unpaired":
    case "ticket-rejected":
    case "no-announcement":
    case "transport-version-mismatch":
      return { code: "HOST_UNAVAILABLE", fault: "agent", canRetry: true, offerTextFallback: true };
    default:
      return { code: "PAIRED", fault: "none", canRetry: false, offerTextFallback: false };
  }
}

/** FE-owned, sanitized, localized copy per situation. `PAIRED`/`CONNECTING` carry no error notice. */
export interface AgentEnvCopy {
  title: string;
  body: string;
}

export const AGENT_ENV_COPY: Record<AgentEnvCode, AgentEnvCopy | null> = {
  PAIRED: null,
  CONNECTING: { title: "도우미 연결 중", body: "내 PC의 SellerOps 도우미와 연결하고 있어요…" },
  NOT_RUNNING: {
    title: "도우미가 실행되어 있지 않아요",
    body: "내 PC의 SellerOps 도우미를 찾지 못했어요. 도우미를 실행한 뒤 다시 시도해 주세요.",
  },
  NOT_PAIRED: {
    title: "도우미와 연결이 필요해요",
    body: "이 브라우저를 내 PC의 SellerOps 도우미와 연결해 주세요.",
  },
  PAIRING_PENDING: {
    title: "확인을 기다리는 중",
    body: "내 PC에 열린 창에서 확인 코드가 같은지 확인하고 허용을 눌러 주세요.",
  },
  PAIRING_BLOCKED: {
    title: "연결을 진행할 수 없어요",
    body: "연결이 거부·해제되었거나 도우미 버전이 낮을 수 있어요. 다시 연결하거나 도우미를 업데이트한 뒤 진행해 주세요.",
  },
  SESSION_MISMATCH: {
    title: "도우미가 다른 연결 세션에 연결되어 있어요",
    body: "도우미가 다른 실행(run)을 진행 중이에요. 도우미를 다시 시작한 뒤 이 화면에서 다시 시도해 주세요. 자동으로 실행을 바꾸지 않습니다.",
  },
  HOST_UNAVAILABLE: {
    title: "지금은 화면 안내를 실행할 수 없어요",
    body: "도우미는 연결됐지만 안내 실행을 준비하지 못했어요. 다시 시도하거나 텍스트로 진행해 주세요.",
  },
};
