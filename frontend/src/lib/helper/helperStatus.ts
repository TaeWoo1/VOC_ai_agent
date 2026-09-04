/**
 * The seller-facing state of the reviewnary 도우미 (Local Helper Pilot Packaging v1, 2026-09-05).
 *
 * The bridge client speaks in phases (`connecting · unreachable · unpaired · pairing_pending · paired ·
 * incompatible_version · revoked …`), the health probe speaks in versions, and the backend speaks in
 * session-readiness states. None of those is a sentence a seller can act on. This module is the one place
 * those axes become the words the product shows — 연결됨 · 설치 필요 · 실행 필요 · 다시 연결 필요 ·
 * 업데이트 필요 · 기기 연결 필요 · 네이버 로그인 필요 — each with exactly one next action. No port, token,
 * carrier or pairing word leaves this file.
 *
 * Two honesty rules:
 * - "설치 필요" and "실행 필요" are the SAME socket-level fact (nothing answered on loopback). They are told
 *   apart by whether this browser was ever paired: a browser that holds a pairing token has met a helper on
 *   this machine, so the helper exists and is not running; one that never has is told to install. A wrong
 *   guess costs one extra sentence, never a wrong action — both paths end at the same install/start page.
 * - "네이버 로그인됨" is only ever the helper's own last observation (`sessionReadiness` + when), never
 *   inferred from a successful collection or a stored profile.
 */

export type HelperStateKey =
  | "CHECKING" | "CONNECTED" | "INSTALL" | "START" | "RECONNECT" | "PENDING" | "UPDATE"
  | "LINK" | "LINKING" | "LINK_SERVER";

export interface HelperAction {
  kind: "install" | "connect" | "retry" | "update" | "link";
  label: string;
}

/**
 * Whether the paired helper is linked to the seller's ACCOUNT (Helper Device Authentication v1) — a
 * different axis from pairing: pairing is browser ↔ helper on this machine, the link is helper ↔ reviewnary
 * account. `undefined` = not asked (a surface that only reads pairing); `unknown` = asked, no answer yet.
 */
export type DeviceLinkWord = "linked" | "unlinked" | "linking" | "denied" | "expired" | "unreachable" | "unknown";

export interface HelperState {
  key: HelperStateKey;
  label: string;
  tone: "good" | "warn" | "bad" | "neutral" | "info";
  /** One sentence under the word, or null when the word is enough. */
  note: string | null;
  action: HelperAction | null;
}

/**
 * The oldest helper this frontend will work with. Older → 업데이트 필요, with the way to update, never a dead end.
 * 0.2.0: the first helper that links to the account with a device token instead of a stored password.
 */
export const MIN_HELPER_VERSION = "0.2.0";

/** Numeric semver compare on the leading `major.minor.patch`; anything unparsable is older than everything. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export interface HelperStatusInput {
  phase: string;
  /** Whether this browser holds (or has held) a pairing token — "met a helper on this machine before". */
  pairedBefore: boolean;
  /** `agentVersion` from the health probe, or null when the probe did not answer. */
  agentVersion: string | null;
  /** True when the origin makes a blocked Local Network Access permission plausible. */
  maybeNeedsLocalNetworkAccess?: boolean;
  pairingHint?: "no_response";
  attestedApproval?: boolean;
  device?: DeviceLinkWord;
}

export function helperStatusOf(input: HelperStatusInput): HelperState {
  const { phase } = input;
  if (phase === "incompatible_version" || (input.agentVersion !== null && compareVersions(input.agentVersion, MIN_HELPER_VERSION) < 0)) {
    return {
      key: "UPDATE",
      label: "업데이트 필요",
      tone: "warn",
      note: "설치된 도우미가 이 화면보다 오래된 버전입니다. 새 버전을 설치하면 이어서 쓸 수 있습니다.",
      action: { kind: "update", label: "업데이트 방법 보기" },
    };
  }
  if (phase === "paired") {
    switch (input.device) {
      case undefined:
      case "linked":
        return { key: "CONNECTED", label: "연결됨", tone: "good", note: null, action: null };
      case "unknown":
        return { key: "CHECKING", label: "확인 중", tone: "neutral", note: null, action: null };
      case "linking":
        return {
          key: "LINKING",
          label: "연결 확인 중",
          tone: "info",
          note: "이 계정과 연결하는 중입니다. 잠시만 기다려 주세요.",
          action: null,
        };
      case "unreachable":
        return {
          key: "LINK_SERVER",
          label: "서버 연결 확인 필요",
          tone: "warn",
          note: "도우미가 reviewnary 서버에 닿지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
          action: { kind: "link", label: "다시 시도" },
        };
      default: {
        const note = input.device === "denied"
          ? "연결이 거부됐습니다. 다시 연결해 주세요."
          : input.device === "expired"
            ? "연결 요청 시간이 지났습니다. 다시 연결해 주세요."
            : "도우미가 아직 이 계정과 연결되지 않았습니다. 연결하면 도우미가 비밀번호 없이 이 계정으로 일합니다.";
        return { key: "LINK", label: "기기 연결 필요", tone: "warn", note, action: { kind: "link", label: "이 기기 연결" } };
      }
    }
  }
  if (phase === "pairing_pending") {
    return {
      key: "PENDING",
      label: "연결 확인 중",
      tone: "info",
      note: input.attestedApproval === false
        ? "내 PC에 열린 창에서 숫자가 같은지 확인하고 허용을 눌러 주세요."
        : "내 PC 화면에 뜬 reviewnary 창에서 허용을 눌러 주세요.",
      action: null,
    };
  }
  if (phase === "unpaired" || phase === "pairing_denied" || phase === "revoked") {
    const note = input.pairingHint === "no_response"
      ? "승인 창에 응답이 없어 연결이 취소됐습니다. 다시 연결하면 창이 한 번 더 열립니다."
      : phase === "pairing_denied"
        ? "연결이 거부됐습니다. 다시 연결하고, 내 PC에 열리는 창에서 허용을 눌러 주세요."
        : phase === "revoked"
          ? "연결이 해제됐습니다. 다시 연결해 주세요."
          : "도우미가 실행 중입니다. 이 브라우저와 연결해 주세요.";
    return { key: "RECONNECT", label: "다시 연결 필요", tone: "warn", note, action: { kind: "connect", label: "도우미 연결" } };
  }
  if (phase === "connecting" || phase === "connecting_ws") {
    return { key: "CHECKING", label: "확인 중", tone: "neutral", note: null, action: null };
  }
  // unreachable / disconnected: nothing answered on this machine.
  const lna = input.maybeNeedsLocalNetworkAccess
    ? " 브라우저가 로컬 네트워크 접근 권한을 물어보면 허용해 주세요."
    : "";
  if (input.pairedBefore) {
    return {
      key: "START",
      label: "실행 필요",
      tone: "warn",
      note: `도우미가 실행되고 있지 않습니다. Mac에 다시 로그인하거나 설치 파일을 한 번 더 실행하면 시작됩니다.${lna}`,
      action: { kind: "retry", label: "다시 찾기" },
    };
  }
  return {
    key: "INSTALL",
    label: "설치 필요",
    tone: "neutral",
    note: `이 PC에서 도우미를 찾지 못했습니다. 설치하면 판매자센터 화면과 함께 일할 수 있습니다.${lna}`,
    action: { kind: "install", label: "설치 안내" },
  };
}

// ---- NAVER session, as the helper last observed it ---------------------------------------------------

export type NaverSessionKey = "LOGGED_IN" | "LOGIN_REQUIRED" | "AUTH_CHALLENGE" | "ACCOUNT_AMBIGUOUS" | "UNOBSERVED";

export interface NaverSessionState {
  key: NaverSessionKey;
  label: string;
  tone: "good" | "warn" | "neutral";
  note: string | null;
  action: { label: string } | null;
}

/**
 * `sessionReadiness` is `contracts/session-readiness/v1` verbatim: READY · LOGIN_REQUIRED · TWO_FACTOR_REQUIRED ·
 * ACCOUNT_AMBIGUOUS · EXPIRED · UNOBSERVED_EXTERNAL. Anything else (an older backend, a null) is UNOBSERVED —
 * the fail-closed word, never 로그인됨.
 */
export function naverSessionOf(sessionReadiness: string | null | undefined, observedAgo: string | null): NaverSessionState {
  const when = observedAgo ? ` (${observedAgo} 확인)` : "";
  switch (sessionReadiness) {
    case "READY":
      return { key: "LOGGED_IN", label: "로그인됨", tone: "good", note: observedAgo ? `${observedAgo} 확인` : null, action: null };
    case "LOGIN_REQUIRED":
    case "EXPIRED":
      return {
        key: "LOGIN_REQUIRED",
        label: "로그인 필요",
        tone: "warn",
        note: `네이버 로그인이 필요합니다${when}. 도우미가 여는 창에서 한 번 로그인하면 이후에는 유지됩니다.`,
        action: { label: "네이버 로그인" },
      };
    case "TWO_FACTOR_REQUIRED":
      return {
        key: "AUTH_CHALLENGE",
        label: "추가 인증 필요",
        tone: "warn",
        note: `네이버가 추가 인증을 요구합니다${when}. 도우미가 여는 창에서 인증을 마쳐 주세요.`,
        action: { label: "네이버 로그인" },
      };
    case "ACCOUNT_AMBIGUOUS":
      return {
        key: "ACCOUNT_AMBIGUOUS",
        label: "계정 선택 필요",
        tone: "warn",
        note: `여러 계정 중 어느 스토어인지 정해지지 않았습니다${when}. 도우미가 여는 창에서 계정을 골라 주세요.`,
        action: { label: "네이버 로그인" },
      };
    default:
      return {
        key: "UNOBSERVED",
        label: "확인되지 않음",
        tone: "neutral",
        note: "아직 도우미가 네이버 로그인 상태를 확인한 적이 없습니다. 첫 작업을 시작하면 확인합니다.",
        action: null,
      };
  }
}
