/**
 * What signing out actually tears down (Agent Interaction Model v2 §0).
 *
 * `logout()` used to remove ONLY the JWT; every other locally stored piece of the session — the
 * current-conversation pointer, the local-helper pairing token, in-flight connection-flow state —
 * survived into the NEXT sign-in, which may be a different organization on the same machine. None of
 * it renders another org's data by itself (the runtime and backend scope every read), but each is a
 * pointer or credential from one org's session standing inside another's; the invariant is that an
 * identity transition leaves nothing of the previous identity behind.
 *
 * The conversation pointer is additionally org-NAMESPACED (`ConversationProvider`), so even an
 * un-cleared key can never resolve into another org's thread. This teardown is the belt to that brace.
 */

/** The current-conversation pointer, per org: `reviewnary.conversation.current.<orgId>`. */
export const CONVERSATION_KEY_PREFIX = "reviewnary.conversation.current";

/** The local-helper pairing token (`lib/bridge/bridgeClient.ts` / `projectionClient.ts`). */
const BRIDGE_TOKEN_KEY = "sellerops_bridge_token";

/** Connection-flow state carried in sessionStorage — meaningless (and misleading) across identities. */
const SESSION_KEYS = [
  "naver_guided_connection_v1",
  "cafe24_tutorial_v1",
  "walkthrough_tab_nonce",
  "sellerops_url_secret",
  "sellerops_social_onboarding",
];

import { forgetSnippets } from "./conversation/snippetCache";

export function clearSessionScopedState(): void {
  // In-memory too: the page's own memory of the customer sentences it drew is one org's content.
  forgetSnippets();
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && (key === CONVERSATION_KEY_PREFIX || key.startsWith(`${CONVERSATION_KEY_PREFIX}.`))) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
    window.localStorage.removeItem(BRIDGE_TOKEN_KEY);
  } catch {
    // storage unavailable — nothing stored, nothing to clear
  }
  try {
    for (const key of SESSION_KEYS) window.sessionStorage.removeItem(key);
  } catch {
    // sessionStorage unavailable
  }
}
