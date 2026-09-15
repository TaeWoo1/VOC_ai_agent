import type {
  CustomerOperationsGapRow,
  CustomerOperationsHome,
  CustomerOperationsSourceHealth,
  ResponsibilityStatus,
} from "./customerOperationsTypes";
import type { StatusTone } from "../components/ui/Status";

/**
 * What 「고객 운영 관리」 is allowed to say. Every sentence the screen prints about the job comes from here, and the
 * module exists to hold four invariants a seller could otherwise be misled by:
 *
 * <ul>
 *   <li><b>observed ≠ processed.</b> A source read with nothing new is 「확인함」, never 「처리함」. 「정리했습니다」 is said
 *   only about cases Reviewnary actually closed.</li>
 *   <li><b>prepared ≠ executed.</b> A draft is always said together with 「보내지 않았습니다」.</li>
 *   <li><b>0 items ≠ could not observe.</b> A source with no observation never prints a count.</li>
 *   <li><b>PARTIAL ≠ 정상.</b> A partial read is 「일부만 확인」, and nothing near it says the job went fine.</li>
 * </ul>
 */

export const RESPONSIBILITY_NAME = "고객 운영 관리";
export const RESPONSIBILITY_DESCRIPTION =
  "Reviewnary가 새 고객 문제를 확인하고, 직접 판단할 필요가 있는 일만 알려드립니다.";

/** What Reviewnary does, and what stays with the seller — the job's contract, stated as it is enforced. */
export const DUTIES_REVIEWNARY = ["중요하지 않은 일 정리", "반복 문제 관찰", "필요한 정보 조사", "답변/행동 준비"];
export const DUTIES_SELLER = ["고객에게 실제 메시지 전송", "금전/보상/취소", "불확실한 판단"];

export const NO_ELIGIBLE_SOURCE_SENTENCE = "고객 운영 관리를 시작하려면 Cafe24를 먼저 연결해 주세요.";

export function statusWord(status: ResponsibilityStatus | null): { label: string; tone: StatusTone } {
  switch (status) {
    case "ACTIVE":
      return { label: "운영 중", tone: "good" };
    case "PAUSED":
      return { label: "일시정지", tone: "warn" };
    case "STOPPED":
      return { label: "중지됨", tone: "neutral" };
    default:
      return { label: "시작 전", tone: "neutral" };
  }
}

export function cadenceLabel(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}시간마다`;
  return `${minutes}분마다`;
}

const DATA_TYPE_KO: Record<string, string> = { INQUIRY: "문의", REVIEW: "리뷰" };
const CHANNEL_LABEL: Record<string, string> = { CAFE24: "Cafe24", NAVER: "네이버", COUPANG: "쿠팡" };

/** `CAFE24:INQUIRY` → 「Cafe24 문의」. An unknown token is dropped rather than printed raw. */
export function scopeLabels(sourcesInScope: string[]): string[] {
  return sourcesInScope
    .map((token) => {
      const [channel, type] = token.split(":");
      const c = CHANNEL_LABEL[channel ?? ""];
      const t = DATA_TYPE_KO[type ?? ""];
      return c && t ? `${c} ${t}` : null;
    })
    .filter((label): label is string => label !== null);
}

export function dataTypeKo(type: string): string {
  return DATA_TYPE_KO[type] ?? "자료";
}

const KST = "Asia/Seoul";

function kstParts(date: Date): { y: number; m: number; d: number; hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute") };
}

/** 「오늘 14:02」 · 「어제 22:00」 · 「내일 00:00」 · 「9월 14일 14:00」 — always Korea time, because the job's windows are. */
export function kstClock(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const a = kstParts(at);
  const n = kstParts(now);
  const dayIndex = (p: { y: number; m: number; d: number }) => Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;
  const diff = dayIndex(a) - dayIndex(n);
  const time = `${a.hh}:${a.mm}`;
  if (diff === 0) return `오늘 ${time}`;
  if (diff === -1) return `어제 ${time}`;
  if (diff === 1) return `내일 ${time}`;
  return `${a.m}월 ${a.d}일 ${time}`;
}

const FAILURE_KO: Record<string, string> = {
  AUTH_REQUIRED: "연결이 만료되어 다시 연결이 필요합니다",
  NOT_CONNECTED: "연결이 끊겨 다시 연결이 필요합니다",
  TIMEOUT: "채널 응답이 늦었습니다",
  RATE_LIMITED: "채널의 요청 한도에 걸렸습니다",
  EXECUTION_FAILED: "확인 중 오류가 났습니다",
  INTERRUPTED: "확인이 중간에 멈췄습니다",
  CONNECTOR_UNAVAILABLE: "이 서비스에서 아직 확인할 수 없는 채널입니다",
  CONFIGURATION_REQUIRED: "확인에 필요한 설정이 빠져 있습니다",
  CANCELLED: "고객 운영 관리가 멈춰 확인을 끝내지 않았습니다",
};

export function failureKo(reason: string | null): string {
  return (reason && FAILURE_KO[reason]) || "끝까지 확인하지 못했습니다";
}

/**
 * One source's last observation, as a fact and a tone.
 *
 * NONE prints no number at all. COMPLETE with nothing read says there was nothing new, which is a finding. BOUNDED and
 * PARTIAL say how far the read got and never read as fine.
 */
export function sourceHealthLine(source: CustomerOperationsSourceHealth): { text: string; tone: StatusTone } {
  const name = `${CHANNEL_LABEL[source.channelCode] ?? source.channelNameKo ?? "채널"} ${dataTypeKo(source.dataType)}`;
  switch (source.completeness) {
    case "COMPLETE": {
      if (source.observedCount === null || source.observedCount === 0) {
        return { text: `${name} — 확인함 · 새로 들어온 것 없음`, tone: "neutral" };
      }
      const fresh = source.newCount !== null ? ` · 새로 ${source.newCount.toLocaleString("ko-KR")}건` : "";
      return { text: `${name} — 확인함 · ${source.observedCount.toLocaleString("ko-KR")}건 읽음${fresh}`, tone: "neutral" };
    }
    case "BOUNDED":
      return {
        text: `${name} — 일부 범위만 확인했습니다${
          source.observedCount !== null ? ` · ${source.observedCount.toLocaleString("ko-KR")}건 읽음` : ""
        }`,
        tone: "warn",
      };
    case "PARTIAL":
      return { text: `${name} — 일부만 확인했습니다 · ${failureKo(source.failureReason)}`, tone: "warn" };
    case "NONE":
      return { text: `${name} — 확인하지 못했습니다 · ${failureKo(source.failureReason)}`, tone: source.sellerActionRequired ? "bad" : "warn" };
    default:
      return { text: `${name} — 확인 중입니다`, tone: "neutral" };
  }
}

export function lastRunWord(status: string | null): string | null {
  switch (status) {
    case "SUCCESS":
      return null;
    case "PARTIAL":
      return "일부만 확인";
    case "FAILED":
      return "확인하지 못함";
    default:
      return null;
  }
}

export function decisionsLine(total: number): string {
  return total > 0
    ? `직접 판단하실 일이 ${total.toLocaleString("ko-KR")}건 있습니다.`
    : "지금 직접 판단하실 일은 없습니다.";
}

/** ②, as separate facts. Nothing is summed: a closed case, a watched case and a draft are three different things. */
export function handledLine(handled: CustomerOperationsHome["handled"]): string {
  const parts: string[] = [];
  if (handled.autoResolved > 0) parts.push(`따로 할 일이 없는 ${handled.autoResolved.toLocaleString("ko-KR")}건을 정리했습니다`);
  if (handled.monitoring > 0) parts.push(`${handled.monitoring.toLocaleString("ko-KR")}건을 지켜보고 있습니다`);
  if (handled.draftsPrepared > 0) {
    parts.push(`답변 초안 ${handled.draftsPrepared.toLocaleString("ko-KR")}건을 준비했습니다(아직 보내지 않았습니다)`);
  }
  return parts.length === 0 ? "최근 24시간 동안 정리하거나 준비한 일은 없습니다." : `${parts.join(" · ")}.`;
}

/** ③ — gaps the seller can fix, then what the last check could not finish on its own. */
export function unobservedLine(home: Pick<CustomerOperationsHome, "gaps" | "sources" | "lastCheckedAt">): string {
  if (home.gaps.total > 0) {
    return `다시 연결해야 확인할 수 있는 곳이 ${home.gaps.total.toLocaleString("ko-KR")}곳 있습니다.`;
  }
  if (home.sources.length === 0) {
    return home.lastCheckedAt ? "지난 확인에서 확인한 대상이 없습니다." : "아직 첫 확인이 끝나지 않았습니다.";
  }
  if (home.sources.some((s) => s.completeness !== "COMPLETE")) {
    return "지난 확인에서 끝까지 보지 못한 곳이 있습니다. 다음 확인에서 다시 봅니다.";
  }
  return "지난 확인에서 모든 대상을 끝까지 확인했습니다.";
}

export function gapRowLine(row: CustomerOperationsGapRow): string {
  const channel = row.channelCode ? CHANNEL_LABEL[row.channelCode] ?? row.channelNameKo : row.channelNameKo;
  const types = row.dataTypes.map(dataTypeKo).join("·") || "자료";
  const why = row.reason === "SOURCE_AUTH_REQUIRED" ? "연결이 만료되어" : "연결이 끊겨";
  return `${channel ?? "채널"} ${types} — ${why} 확인하지 못했습니다.`;
}

const ACTION_KO: Record<string, string> = {
  NO_ACTION: "할 일 없음",
  MONITOR_REPEAT_ISSUE: "반복되는지 지켜보기",
  REPLY_TO_CUSTOMER: "고객에게 답변",
  CONTACT_CUSTOMER: "고객에게 연락",
  REFUND_OR_COMPENSATION: "환불·보상 판단",
  CANCEL_OR_EXCHANGE: "취소·교환 판단",
  ADD_KNOWLEDGE: "답변 기준 추가",
  REVIEW_PRODUCT_LISTING: "상품 설명 점검",
};

export function actionKo(type: string | null): string | null {
  return type ? ACTION_KO[type] ?? null : null;
}

export function dispositionWord(disposition: "AUTO_RESOLVED" | "MONITORING"): { label: string; tone: StatusTone } {
  return disposition === "AUTO_RESOLVED" ? { label: "정리함", tone: "neutral" } : { label: "지켜보는 중", tone: "info" };
}

export function subjectFallback(kind: "INQUIRY" | "REVIEW"): string {
  return kind === "INQUIRY" ? "제목 없는 문의" : "내용 없는 리뷰";
}

export function subjectKindKo(kind: "INQUIRY" | "REVIEW"): string {
  return kind === "INQUIRY" ? "문의" : "리뷰";
}
