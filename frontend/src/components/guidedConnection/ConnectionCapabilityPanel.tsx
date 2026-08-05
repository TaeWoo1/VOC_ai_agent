import {
  CAPABILITY_REASON_COPY,
  CAPABILITY_STATE_COPY,
  SYNC_STATUS_COPY,
} from "../../lib/guidedConnection";
import type { ConnectionCapabilityView } from "../../lib/types";

/**
 * Channel-neutral capability-result panel for a guided-connection wizard's completion screen. It
 * renders the sanitized {@link ConnectionCapabilityView} the backend returns: the seller-identity
 * line, the first-sync status, and one line per capability (order read / review import / review
 * reply / inquiry read) with a state chip + optional explanation.
 *
 * <p>Presentational + sanitized: it consumes ONLY closed codes + fixed labels (no token, id, order
 * id, or personal data). The review/inquiry lines are informational — this screen never mixes in
 * the review Action Window; it only reports each surface's honest status.
 */
export function ConnectionCapabilityPanel({ capability }: { capability: ConnectionCapabilityView }) {
  return (
    <div className="space-y-3 rounded-lg bg-canvas px-4 py-4" role="status" aria-label="연결 역량 결과">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">판매자 확인</span>
        <span className={`text-sm font-medium ${capability.identityConfirmed ? "text-good" : "text-warn"}`}>
          {capability.identityConfirmed ? "자격 증명 인증됨" : "인증 미완료"}
        </span>
      </div>
      <p className="text-sm text-muted">
        {capability.identityConfirmed
          ? "저장한 연결 정보로 네이버 인증에 성공하고 첫 주문 수집까지 확인했습니다. (스토어 이름은 표시하지 않습니다.)"
          : "아직 자격 증명 인증이 완료되지 않았습니다."}
      </p>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm font-medium text-ink">첫 주문 수집</span>
        <span className="text-sm text-muted">
          {SYNC_STATUS_COPY[capability.firstSyncStatus] ?? capability.firstSyncStatus}
        </span>
      </div>

      <ul className="space-y-2 border-t border-line pt-3">
        {capability.features.map((f) => {
          const state = CAPABILITY_STATE_COPY[f.state] ?? { chip: f.state, tone: "muted" as const };
          const tone =
            state.tone === "good" ? "text-good" : state.tone === "warn" ? "text-warn" : "text-muted";
          const reason = f.reason ? CAPABILITY_REASON_COPY[f.reason] : null;
          return (
            <li key={f.feature} className="space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{f.label}</span>
                <span className={`rounded-full bg-surface px-3 py-1 text-xs font-medium ${tone}`}>
                  {state.chip}
                </span>
              </div>
              {reason && <p className="text-xs text-muted">{reason}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
