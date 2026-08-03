import { Link } from "react-router-dom";
import type { AttentionCard } from "../../lib/homeSignals";
import type { FeedItem, ItemAnalysis } from "../../lib/types";
import { analysisKey } from "../../lib/inboxView";
import { TYPE_LABEL, itemTitle } from "../../lib/inboxWorkspace";
import { relativeTime } from "../../lib/format";
import { Panel } from "../ui/Panel";
import { BtnLink } from "../ui/Btn";
import { useAgentAvailability } from "../../hooks/useAgentAvailability";

function SignalTile({ card }: { card: AttentionCard }) {
  const ready = card.signal.kind === "READY";
  return (
    <Link
      to={card.to}
      className="block rounded-xl border border-line p-4 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
    >
      <p className="break-keep text-base text-muted">{card.label}</p>
      {ready ? (
        <p className="mt-1.5 text-3xl font-bold tabular-nums text-ink">
          {(card.signal as { count: number }).count}
          <span className="ml-1 text-lg font-semibold text-muted">건</span>
        </p>
      ) : (
        // No number. A count rendered because a read failed would read as "nothing needs you".
        <p className="mt-2 break-keep text-base text-muted">{card.hint}</p>
      )}
    </Link>
  );
}

/**
 * Zone 1 — what needs a person today.
 *
 * The agent assist appears ONLY when the operations runtime actually answered. It is never a
 * disabled button and never a "준비 중" label: a control the seller cannot use costs more trust
 * than an absent one.
 */
export function AttentionZone({
  cards,
  preview,
  analyses,
}: {
  cards: readonly AttentionCard[];
  preview: readonly FeedItem[];
  analyses: Map<string, ItemAnalysis>;
}) {
  const agentReachable = useAgentAvailability();

  return (
    <Panel
      title="확인 필요"
      description="지금 사람이 봐야 할 것만 모았습니다."
      action={
        agentReachable ? (
          <BtnLink to="/agent" size="sm" variant="outline">
            운영 에이전트로 정리
          </BtnLink>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <SignalTile key={card.id} card={card} />
        ))}
      </div>

      {preview.length > 0 ? (
        <ul className="mt-5 divide-y divide-line border-t border-line">
          {preview.map((item) => {
            const analysis = analyses.get(analysisKey(item.type, item.id));
            return (
              <li key={`${item.type}:${item.id}`}>
                <Link
                  to={`/inbox/${item.id}`}
                  className="flex items-center gap-3 py-3 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                >
                  <span className="shrink-0 rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
                    {TYPE_LABEL[item.type]}
                  </span>
                  <span className="min-w-0 flex-1 truncate break-keep font-medium text-ink">
                    {itemTitle(item)}
                  </span>
                  {analysis ? (
                    <span className="hidden shrink-0 text-xs text-muted sm:inline">
                      {analysis.category}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted">
                    {relativeTime(item.receivedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Panel>
  );
}
