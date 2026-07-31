import type { WalkthroughContextView } from "../../lib/types";

/**
 * Always-visible disposable-walkthrough banner. It lets the operator VISUALLY compare the screen's run id
 * against the one the CLI preflight printed before entering any credential — the human check that pairs
 * with the machine binding. It stays on the wizard, the completed screen, and the read-only refresh screen,
 * so a stale screen carried over from a different run is obvious. Sanitized: only a run-id prefix, git SHA
 * prefix, DB alias, backend origin, and a live NAVER-call count — never a secret, token, or account id.
 */
export function WalkthroughBanner({
  context,
  naverCalls,
}: {
  context: WalkthroughContextView | null;
  naverCalls: number;
}) {
  const runPrefix = context?.walkthroughRunId ? context.walkthroughRunId.slice(0, 8) : "unknown";
  const sha = context?.gitCommit ? context.gitCommit.slice(0, 7) : "unknown";
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-warn bg-warn/30 px-4 py-2 text-xs text-ink"
      role="note"
      aria-label="Disposable NAVER Walkthrough"
    >
      <span className="font-bold">Disposable NAVER Walkthrough</span>
      <span>
        run <code className="font-mono">{runPrefix}</code>
      </span>
      <span>
        git <code className="font-mono">{sha}</code>
      </span>
      <span>db {context?.dbAlias ?? "unknown"}</span>
      <span>backend {context?.backendOrigin ?? "unknown"}</span>
      <span className={naverCalls === 0 ? "text-good" : "text-warn"}>
        NAVER 호출 {naverCalls}{naverCalls === 0 ? " (아직 없음)" : ""}
      </span>
    </div>
  );
}
