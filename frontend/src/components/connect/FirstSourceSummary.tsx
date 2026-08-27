import { useEffect, useState } from "react";
import { BtnLink } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import {
  sourceSummaryHeadline,
  sourceSummaryLines,
  type SourceSummaryLine,
} from "../../lib/firstSourceSummary";
import type { ChannelCoverageRowView, SyncRunView } from "../../lib/types";

/**
 * <b>「연결 완료」 is not the end of onboarding — this is.</b>
 *
 * <p>Disconnected Channel Onboarding Live Walkthrough v1 §5/§6/§7/§9. Every channel's completion
 * screen used to end at 연결 상태 + 마지막 성공 수집 and a link back to the channel list: four facts
 * about our plumbing and none about the seller's shop. This card answers the three questions a first
 * connection actually raises — what came in, what did not, and what to do now — and hands the seller
 * to 홈, where the briefing and 「무엇을 도와드릴까요?」 already live.
 *
 * <p><b>It states, it does not collect.</b> Two read-only calls, both of rows this backend already
 * holds. Nothing here contacts a channel and nothing here can start a run — a completion screen that
 * kicked off work would make 「완료」 the name of a thing still happening.
 *
 * <p><b>Fail-soft, and never in the direction of a claim.</b> A failed read renders the handoff
 * without lines. Silence about what was collected is a smaller lie than a number that came from
 * nowhere.
 */
export function FirstSourceSummary({
  channelCode,
  channelNameKo,
  accountId,
}: {
  channelCode: string;
  channelNameKo: string;
  /** The account just connected. Its runs are the ONLY source of a printed count. */
  accountId: string | null;
}) {
  const [lines, setLines] = useState<SourceSummaryLine[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      // One guard for both reads, and it is deliberately wide: any way a read can fail to produce
      // rows ends in the same place — the handoff without lines. Saying nothing about what was
      // collected is a smaller lie than a number that came from nowhere.
      try {
        const [coverage, runs] = await Promise.all([
          api.getChannelCoverageStrict() as Promise<ChannelCoverageRowView[]>,
          accountId
            ? (api.getSyncRunsStrict({ sellerAccountId: accountId }) as Promise<SyncRunView[]>)
            : Promise.resolve<SyncRunView[]>([]),
        ]);
        if (!live) return;
        setLines(sourceSummaryLines(coverage, runs, channelCode));
      } catch {
        if (live) setLines([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [channelCode, accountId]);

  const headline = lines ? sourceSummaryHeadline(channelNameKo, lines) : null;

  return (
    <section
      className="space-y-4 rounded-2xl border border-line bg-surface p-5"
      aria-label="첫 수집 결과"
      data-testid="first-source-summary"
    >
      <div className="space-y-1">
        <h2 className="break-keep text-xl font-semibold text-ink">
          {headline ?? `${channelNameKo} 연결이 완료되었습니다.`}
        </h2>
        <p className="break-keep text-base text-muted">
          앞으로는 새 주문·문의·리뷰를 알아서 확인해 정리해 드립니다.
        </p>
      </div>

      {lines && lines.length > 0 ? (
        <ul className="divide-y divide-line/70" data-testid="first-source-lines">
          {lines.map((line) => (
            <li key={line.dataType} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
              <span className="w-12 shrink-0 text-base font-semibold text-ink">{line.label}</span>
              <span className={`min-w-0 flex-1 break-keep text-base ${TONE_CLASS[line.tone]}`}>
                {line.sentence}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* The one control. 「채널 화면으로」 sent a seller who had just connected their shop back to
          the list of things to connect; the work they came for is on 홈. */}
      <div className="pt-1">
        <BtnLink to="/">오늘 할 일 확인하기</BtnLink>
      </div>
    </section>
  );
}

/**
 * Colour is never the only carrier here — every line already says its own state in words. `blocked` is
 * the only one a seller must act on, so it is the only one that takes a state colour.
 */
const TONE_CLASS: Record<SourceSummaryLine["tone"], string> = {
  collected: "text-ink",
  empty: "text-muted",
  pending: "text-muted",
  blocked: "text-warn",
  unsupported: "text-muted",
};
