import { useState } from "react";
import { NaverIssuanceTutorial } from "./NaverIssuanceTutorial";
import { NAVER_ISSUANCE_TUTORIAL, type GuidedEvent } from "../../lib/guidedConnection";

/**
 * The fork shown at `application_issuance`: how does the seller want to issue the NAVER Commerce API
 * application?
 *
 *  • **화면을 보며 안내받기 (guided)** — dispatches `APPLICATION_ISSUANCE_MODE {mode:"guided"}`, which the
 *    reducer routes to `application_issuance_guided` (the Action Window walkthrough). This is the ONLY place
 *    the Local Agent participates in the order connection.
 *  • **텍스트로 직접 진행하기 (text)** — renders the existing static `NaverIssuanceTutorial` checklist IN
 *    PLACE, with its unchanged completion (`ISSUANCE_COMPLETE`). The text choice is a component-local toggle,
 *    NOT a reducer event: `mode:"text"` is a no-op at `application_issuance`, so today's text flow is byte
 *    identical — the checklist is simply revealed here.
 *
 * Privacy: holds only which mode is showing (transient). It never carries a credential value or an account id.
 */
export function NaverIssuanceModeChoice({
  dispatch,
  busy,
}: {
  dispatch: (event: GuidedEvent) => void;
  busy?: boolean;
}) {
  const [showText, setShowText] = useState(false);

  if (showText) {
    return (
      <div className="space-y-4">
        <NaverIssuanceTutorial
          steps={NAVER_ISSUANCE_TUTORIAL}
          onComplete={() => dispatch({ type: "ISSUANCE_COMPLETE" })}
          completeLabel="발급을 완료했어요"
          busy={busy}
        />
        <button type="button" className="btn-ghost text-sm" onClick={() => setShowText(false)}>
          화면 안내로 다시 보기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-label="발급 진행 방식 선택">
      <p className="text-muted">발급을 어떻게 진행할지 선택해 주세요.</p>
      <button
        type="button"
        className="btn-primary block w-full"
        onClick={() => dispatch({ type: "APPLICATION_ISSUANCE_MODE", mode: "guided" })}
        disabled={busy}
      >
        화면을 보며 안내받기
      </button>
      <button
        type="button"
        className="btn-ghost block w-full"
        onClick={() => setShowText(true)}
        disabled={busy}
      >
        텍스트로 직접 진행하기
      </button>
      <p className="text-xs text-muted">
        화면 안내는 내 PC의 SellerOps 도우미가 NAVER API 센터 창을 열어 눌러야 할 위치를 표시합니다. 도우미가
        없거나 연결이 안 되면 텍스트 안내로 진행할 수 있어요.
      </p>
    </div>
  );
}
