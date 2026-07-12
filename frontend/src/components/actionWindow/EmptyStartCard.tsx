import { DESKTOP_ONLY_COPY, EMPTY_START_COPY } from "../../lib/actionWindow/copy";

/**
 * Empty-start card — shown on both /operations and /operations/current when there is
 * no run. Desktop shows the 시작 button; mobile is read-only with a note that the real
 * action happens on desktop. Copy is FE-owned (EMPTY_START_COPY / DESKTOP_ONLY_COPY).
 */
export function EmptyStartCard({
  connected,
  onStart,
}: {
  connected: boolean;
  onStart: () => void;
}) {
  return (
    <section aria-label="시작하기" className="rounded-2xl bg-surface p-6 text-center shadow-card">
      <p className="text-lg text-ink">{EMPTY_START_COPY.title}</p>
      <p className="mt-1 text-muted">{EMPTY_START_COPY.body}</p>
      {connected ? (
        <button
          type="button"
          onClick={onStart}
          className="mt-4 hidden rounded-xl bg-brand px-5 py-3 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-block"
        >
          시작
        </button>
      ) : null}
      <p className="mt-4 text-sm text-muted sm:hidden">{DESKTOP_ONLY_COPY.start}</p>
    </section>
  );
}
