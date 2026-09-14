import type { ReactNode } from "react";
import { Status } from "../../ui/Status";
import type { CapabilityCardStatus } from "../../../lib/connect/coupangCapabilities";

/**
 * <b>이 채널에서 자료가 들어오는 방법 하나.</b>
 *
 * <p>제목 · 상태 한 단어 · 설명 한 문단 · 사실 한 줄 · <b>primary 하나</b>. 그 다음에야, 접힌 채로,
 * 그 방법에 딸린 설정이 온다. 이 모양이 규칙인 이유는 실측된 실패 때문이다 — 쿠팡 채널 화면은 같은 두
 * 능력을 열세 개의 제목으로 흩어 놓았고, 첫 화면에 solid 세 개를 동시에 세웠으며(그중 목적은 disabled),
 * 같은 채널을 두 곳에서 반대로 설명했다(2026-09-14, 1440×900).
 *
 * <p>진단은 여기 없다. 정상 상태의 카드에는 도우미도, 실행 프로그램도, 연결 방식도 나타나지 않는다 —
 * 그것들은 무언가가 실패했을 때 그 걸음 안에서만 이름을 얻는다.
 */
export function CapabilityCard({
  title,
  status,
  description,
  facts,
  primary,
  secondary,
  advanced,
  testId,
}: {
  title: string;
  status: CapabilityCardStatus;
  /** 이 방법이 무엇인지, 판매자가 하는 일로. */
  description: string;
  /** 사실 한 줄 — 마지막 수집 같은 것. 읽지 못했으면 넘기지 않는다(없는 줄이 틀린 줄보다 낫다). */
  facts?: ReactNode;
  primary?: ReactNode;
  /** 링크 하나까지. 버튼이 아니다. */
  secondary?: ReactNode;
  /** 접힌 채로 오는 설정. 열지 않으면 화면에 없는 것과 같다. */
  advanced?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" data-testid={testId} aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="break-keep text-base font-semibold text-ink">{title}</h2>
        <Status tone={status.tone} variant="word">
          {status.label}
        </Status>
      </div>
      <p className="mt-1.5 break-keep text-base leading-relaxed text-muted">{description}</p>
      {facts ? <p className="mt-2 break-keep text-sm text-muted">{facts}</p> : null}
      {primary || secondary ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {primary}
          {secondary}
        </div>
      ) : null}
      {advanced ? <div className="mt-4 border-t border-line pt-3">{advanced}</div> : null}
    </section>
  );
}
