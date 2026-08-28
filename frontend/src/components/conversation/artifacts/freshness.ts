import type { FreshnessVerdict } from "../../../lib/conversation/types";
import type { StatusTone } from "../../ui/Status";

/** The verdict in the seller's words. The enum never reaches the screen. */
export const FRESHNESS_LABEL: Record<FreshnessVerdict, string> = {
  FRESH: "최신",
  UNPROVEN: "최신 수집 확인 안 됨",
  NOT_COLLECTED: "이 기간 수집 없음",
  NOT_SUPPORTED: "수집 경로 없음",
  NOT_CONNECTED: "연결 안 됨",
};

export const FRESHNESS_TONE: Record<FreshnessVerdict, StatusTone> = {
  FRESH: "good",
  UNPROVEN: "warn",
  NOT_COLLECTED: "warn",
  NOT_SUPPORTED: "neutral",
  NOT_CONNECTED: "bad",
};
