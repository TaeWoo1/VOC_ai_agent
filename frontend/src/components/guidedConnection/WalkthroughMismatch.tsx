import type { WalkthroughMismatchReason } from "../../lib/guidedConnection";

/**
 * WALKTHROUGH_ENVIRONMENT_MISMATCH screen. Shown when the tab's environment cannot be proven bound to the
 * bootstrapped run (any of URL run id / frontend run id / backend context run id missing or disagreeing, or
 * the origin differs, or the operator-tab handshake did not match). It renders NO credential form and NO
 * connection-test/sync CTA, and it does NOT try to recover or probe another backend — the operator must
 * re-open the exact URL the preflight issued. Fail-closed by design.
 */
const REASON_COPY: Record<WalkthroughMismatchReason | "HANDSHAKE_FAILED", string> = {
  MISSING_URL_RUN: "이 탭의 주소에 walkthrough 실행 ID가 없습니다. preflight가 출력한 정확한 URL로 다시 열어 주세요.",
  MISSING_FRONTEND_RUN: "이 프론트엔드 빌드에 walkthrough 실행 ID가 설정되어 있지 않습니다. bootstrap으로 다시 시작해 주세요.",
  MISSING_CONTEXT: "연결된 백엔드가 walkthrough 실행 정보를 제공하지 않습니다. 승인된 백엔드가 아닐 수 있습니다.",
  RUN_MISMATCH: "주소·프론트엔드·백엔드의 walkthrough 실행 ID가 서로 다릅니다. 다른 실행이나 오래된 탭일 수 있습니다.",
  ORIGIN_MISMATCH: "이 탭의 origin이 승인된 origin과 다릅니다. (예: 127.0.0.1 대신 localhost)",
  HANDSHAKE_FAILED: "백엔드 핸드셰이크가 이 실행/origin과 일치하지 않습니다. 승인된 URL로 다시 열어 주세요.",
};

export function WalkthroughMismatch({
  reasons,
  expectedUrl,
}: {
  reasons: Array<WalkthroughMismatchReason | "HANDSHAKE_FAILED">;
  expectedUrl: string | null;
}) {
  return (
    <section className="card space-y-4 border-bad p-6" role="alert" aria-label="WALKTHROUGH_ENVIRONMENT_MISMATCH">
      <h2 className="text-lg font-bold text-bad">환경 확인 실패 — 연결을 진행할 수 없습니다</h2>
      <p className="text-sm text-muted">
        이 브라우저 탭이 승인된 walkthrough 환경(같은 프론트엔드·백엔드·DB·실행)에 연결되어 있는지 확인하지 못했습니다.
        안전을 위해 연결 정보 입력과 연결 테스트·수집을 모두 막았습니다. 자동으로 다른 백엔드를 찾지 않습니다.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
        {reasons.map((r) => (
          <li key={r}>{REASON_COPY[r] ?? r}</li>
        ))}
      </ul>
      {expectedUrl && (
        <div className="rounded-lg bg-canvas px-4 py-3 text-sm">
          <p className="text-muted">preflight가 출력한 정확한 URL을 새 창에서 다시 열어 주세요:</p>
          <p className="mt-1 break-all font-mono text-ink">{expectedUrl}</p>
        </div>
      )}
    </section>
  );
}
