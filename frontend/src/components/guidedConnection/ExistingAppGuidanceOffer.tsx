import { useState } from "react";
import type { GuidedEvent } from "../../lib/guidedConnection";

/**
 * The optional guided-vs-text offer shown ABOVE the existing-app credential entry (`existing_credential_entry`).
 *
 * An existing-app seller already has their store's single NAVER Commerce API app; they only need to find the
 * order API group + Application ID/Secret on it. TEXT is the default: the `<details>` checklist and the secure
 * form render immediately below this offer, so a seller who already knows where to look just fills them in.
 *
 *  • **화면을 보며 확인 (guided)** — dispatches `APPLICATION_ISSUANCE_MODE {mode:"guided"}`, which the reducer
 *    routes to `application_issuance_guided` (the SAME shared Action Window walkthrough as the new-app path).
 *    The runtime SHOWS where each field lives; it issues nothing and reads no value. On finish or a text
 *    fallback the reducer returns an existing/saved seller BACK to this screen (path-aware routing in
 *    state.ts), where they then enter the values. This is a NAVIGATION away and back — the guidance flow is
 *    "go look, then enter here" — so the caption tells the seller to enter below AFTER guidance, and the
 *    secure form is entered fresh on return (this is the intended sequence, not a silent discard). A seller
 *    who has already started typing should finish in the form rather than switch.
 *  • **텍스트로 직접 확인 (text)** — dismisses this offer so the form below stands alone. No reducer event:
 *    text is already the rendered default, so this only declutters. (After a guided round trip the component
 *    remounts and the offer reappears, harmlessly — the form is right below it.)
 *
 * Privacy: holds only whether the offer is dismissed (transient, component-local). It carries no credential
 * value, account id, selector, or url.
 */
export function ExistingAppGuidanceOffer({
  dispatch,
  busy,
}: {
  dispatch: (event: GuidedEvent) => void;
  busy?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="space-y-2 rounded-lg border border-line px-4 py-3" role="group" aria-label="확인 방식 선택">
      <p className="text-sm text-muted break-keep">
        기존 앱에서 주문 API 그룹과 애플리케이션 ID·시크릿 위치를 모르시면 화면 안내를 받고, 다 확인한 뒤 아래에 입력해 주세요.
        이미 위치를 아신다면 바로 아래에 입력하셔도 됩니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={() => dispatch({ type: "APPLICATION_ISSUANCE_MODE", mode: "guided" })}
          disabled={busy}
        >
          화면을 보며 확인
        </button>
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={() => setDismissed(true)}
          disabled={busy}
        >
          텍스트로 직접 확인
        </button>
      </div>
    </div>
  );
}
