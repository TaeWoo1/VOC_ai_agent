import type { RecentRunItem } from "../../lib/actionWindow/homeFixtures";
import { channelLabel, resolveCopy, runStatusView, SECTION_TITLE } from "../../lib/actionWindow/copy";
import { shortDate } from "../../lib/format";

/**
 * Recent activity — read-only list of finished runs (mock data in FE-2; no
 * persistence implied). No buttons: terminal runs have no commands.
 */
export function RecentActivityList({ items }: { items: RecentRunItem[] }) {
  return (
    <section aria-label={SECTION_TITLE.recentActivity} className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="mb-1 text-lg font-semibold text-ink">{SECTION_TITLE.recentActivity}</h2>
      <p className="mb-3 text-sm text-muted">완료되거나 실패한 작업이 여기에 보여요.</p>
      {items.length === 0 ? (
        <p className="text-muted">아직 완료된 작업이 없어요.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item) => {
            const status = runStatusView(item.status);
            return (
              <li
                key={item.runId}
                className="flex flex-col gap-1 rounded-xl border border-line bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="min-w-0 flex-1 break-keep">
                    <span className="block font-medium text-ink">
                      {resolveCopy(item.runCopyKey)}
                    </span>
                    <span className="block text-sm text-muted">
                      {channelLabel(item.channelCode)} · {item.completedSteps} /{" "}
                      {item.totalSteps} 단계
                    </span>
                  </span>
                </div>
                <span className="shrink-0 pl-8 text-sm text-muted sm:pl-0 sm:text-right">
                  <span className="block">{status.label}</span>
                  <span className="block">{shortDate(item.finishedAt)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
