// Shared helpers for the channel workspace sections.
//
// Extracted VERBATIM from the previous single-file 채널 상세 page. Nothing here was rewritten:
// the constants, the label functions and the next-action table are the same code that drove the
// live-verified connection and collection flows, moved so four section components can share them.
import { isAxiosError } from "axios";
import { untilTime } from "../../lib/format";
import type { ConnectionStatusView } from "../../lib/types";

export type ScrollTarget = "collect" | "runs" | "info";

export function backendMessage(e: unknown): string | null {
  if (isAxiosError(e)) {
    const data = e.response?.data as { message?: string } | undefined;
    return data?.message ?? null;
  }
  return null;
}

export const DATA_TYPES: Array<{ value: string; label: string }> = [
  { value: "REVIEW", label: "리뷰" },
  { value: "INQUIRY", label: "문의" },
  { value: "ORDER_SUMMARY", label: "주문·매출" },
];

export const INTERVALS: Array<{ minutes: number; label: string }> = [
  { minutes: 60, label: "매시간" },
  { minutes: 360, label: "6시간마다" },
  { minutes: 1440, label: "매일" },
];

export type Tone = "good" | "warn" | "bad" | "muted";

export const TITLE_CLS: Record<Tone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  muted: "text-ink",
};

export interface NextAction {
  tone: Tone;
  title: string;
  guidance: string;
  detail?: string;
  cta?: { label: string; target: ScrollTarget };
}

// Humanize the masked credential authType for operators. Kept high-level — the
// exact secret-key shape is the connector's concern (and a Slice 2 backend

export function authTypeLabel(authType: string): string {
  switch (authType) {
    case "API_KEY":
    case "HMAC":
    case "JWT_HS256":
      return "API 키";
    case "OAUTH2":
      return "앱 연동(OAuth)";
    default:
      return authType;
  }
}

// Expiry label for tokenExpiresAt: future → "n일 후", past/now → 재등록 안내,
// missing → 정보 없음.
export function expiryLabel(iso: string | null): { text: string; expired: boolean } {
  if (!iso) {
    return { text: "만료 정보 없음", expired: false };
  }
  if (new Date(iso).getTime() <= Date.now()) {
    return { text: "만료됨 (재등록 필요)", expired: true };
  }
  return { text: untilTime(iso), expired: false };
}

// Calm, high-level per-channel guidance on what kind of connection info the
// channel needs — keyed by ChannelResponse.code. Describes the *kind* of info,
// never the connector's exact secret-key names, never a password-casual ask.
// Only the product channels carry a sentence (`lib/productChannels.ts`); a
// channel outside that set is not shown, so it gets no connection claim here.

export const CHANNEL_GUIDANCE: Record<string, string> = {
  COUPANG: "쿠팡 판매자센터(쿠팡 윙)에서 발급한 API 키로 연결합니다.",
  NAVER: "네이버 커머스 API 센터에서 발급한 애플리케이션 키로 연결합니다.",
  CAFE24: "자사몰 관리자에서 앱 연동(OAuth)으로 연결합니다.",
};
export const GENERIC_GUIDANCE =
  "채널 판매자센터에서 발급한 연결 정보(API 키 등)로 연결합니다.";

// "다음 조치" copy keyed by ConnectionStatusView.state (the 6 connection states
// from ChannelConnectionStatus — NOT the connector-alert types). Every CTA points
// at an action that already exists on this page: 수집 테스트 = 지금 수집하기 in the
// 자동 수집 설정 section; 수집 내역 보기 scrolls to 최근 수집 내역 (where 다시 시도
// lives). Re-auth/disconnected states explain that 연결 정보 갱신 is needed but

export const NEXT_ACTION: Record<string, NextAction> = {
  CONNECTED: {
    tone: "good",
    title: "정상 수집 중입니다",
    guidance: "연결에 문제가 없습니다. 필요하면 지금 수집을 한 번 테스트할 수 있습니다.",
    cta: { label: "수집 테스트", target: "collect" },
  },
  NOT_COLLECTED: {
    tone: "muted",
    title: "아직 수집 이력이 없습니다",
    guidance: "수집을 한 번 테스트해 연결이 정상인지 확인해 보세요.",
    cta: { label: "수집 테스트", target: "collect" },
  },
  DEGRADED: {
    tone: "warn",
    title: "최근 수집에 실패했습니다",
    guidance: "수집 내역에서 오류를 확인하고 다시 시도해 보세요.",
    cta: { label: "수집 내역 보기", target: "runs" },
  },
  EXPIRED: {
    tone: "bad",
    title: "재연결이 필요합니다",
    guidance: "인증이 만료되어 자동 수집이 멈췄습니다. 자동 수집을 다시 사용하려면 연결 정보를 갱신해야 합니다.",
    detail: "아래 연결 정보에서 만료 상태를 확인할 수 있습니다.",
    cta: { label: "연결 정보 보기", target: "info" },
  },
  NEEDS_REAUTH: {
    tone: "bad",
    title: "재연결이 필요합니다",
    guidance: "인증이 만료되어 자동 수집이 멈췄습니다. 자동 수집을 다시 사용하려면 연결 정보를 갱신해야 합니다.",
    detail: "아래 연결 정보에서 만료 상태를 확인할 수 있습니다.",
    cta: { label: "연결 정보 보기", target: "info" },
  },
  DISCONNECTED: {
    tone: "bad",
    title: "연결 정보 확인이 필요합니다",
    guidance: "채널 연결이 끊겼습니다. 연결 정보와 최근 수집 내역을 확인해 주세요.",
    cta: { label: "연결 정보 보기", target: "info" },
  },
};

export function nextActionFor(status: ConnectionStatusView): NextAction {
  const base: NextAction = NEXT_ACTION[status.state] ?? {
    tone: "muted",
    title: "연결 상태를 확인해 주세요",
    guidance: "아래 수집 내역과 오류 메시지에서 자세한 상태를 확인할 수 있습니다.",
    cta: { label: "수집 내역 보기", target: "runs" },
  };
  // For a degraded connection, lead with the consecutive-failure count.
  if (base.tone === "warn" && status.consecutiveFailures > 0) {
    return {
      ...base,
      guidance: `최근 수집이 연속 ${status.consecutiveFailures}회 실패했습니다. ${base.guidance}`,
    };
  }
  return base;
}

