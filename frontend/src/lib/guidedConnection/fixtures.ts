// NAVER Guided Connection (G3) — synthetic, channel-neutral fixtures (§18).
//
// These are SYNTHETIC: no cloned NAVER brand assets, screenshots, or scraped UI copy — just the
// representative field shape and scripted sanitized-event sequences that let the state machine and
// wizard be exercised entirely offline (§17.10 — no live NAVER needed to verify). The credential
// template mirrors the backend NAVER template shape (client_id shown, client_secret secret) without
// carrying any value.
//
// The initial order connection is Local-Agent-free: no sequence contains a readiness/agent/session
// event, because none exists — a read-only `RESUME_FROM_CAPABILITY` hands straight to the path fork
// (no credential) or restores completed (a prior sync succeeded), never re-running test/sync on load.
import type { CredentialTemplateView } from "../types";
import type { GuidedEvent } from "./types";

/** Representative NAVER-like credential field shape (values never included). */
export const NAVER_LIKE_TEMPLATE: CredentialTemplateView = {
  channelCode: "NAVER",
  connectorClass: "NaverApiConnector",
  authType: "API_KEY",
  fields: [
    {
      key: "client_id",
      label: "애플리케이션 ID (Client ID)",
      required: true,
      secret: false,
      helpText: "NAVER 커머스 API 센터에서 발급된 애플리케이션 ID입니다.",
    },
    {
      key: "client_secret",
      label: "애플리케이션 시크릿 (Client Secret)",
      required: true,
      secret: true,
      helpText: "발급 화면에서 확인한 시크릿을 직접 입력하세요. 저장 후에는 다시 표시되지 않습니다.",
    },
  ],
  notes: "셀러 소유 NAVER 커머스 API 애플리케이션(type=SELF) 기준입니다.",
};

/**
 * No stored key → GUIDED-FIRST (2026-08-04): the seller enters the guided walkthrough directly, and the
 * runtime — by observing NAVER's application list — reveals an EMPTY store (`ISSUANCE_APP_BRANCH_OBSERVED
 * {branch:"new"}` sets path="new"). Guidance finishing hands off to the issued-credential entry. The seller
 * never pre-declares have/new; there is no path-choice fork and no readiness gate.
 */
const NEW_APP_ISSUANCE: GuidedEvent[] = [
  { type: "RESUME_FROM_CAPABILITY", credentialPresent: false, completed: false },
  { type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "new" },
  { type: "ISSUANCE_COMPLETE" },
  { type: "BEGIN_CREDENTIAL_ENTRY" },
];

/** Happy path (new app): discovery → fork → issuance → credentials → registration → test → sync → completed. */
export const HAPPY_PATH_EVENTS: GuidedEvent[] = [
  ...NEW_APP_ISSUANCE,
  { type: "SUBMIT_CREDENTIALS" },
  { type: "CREDENTIAL_REGISTERED" },
  { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null },
  { type: "SYNC_RESULT", status: "SUCCESS" },
];

/** Same as the happy path but the first sync returns zero new orders — still SUCCESS (§12). */
export const ZERO_COUNT_SYNC_EVENTS: GuidedEvent[] = [...HAPPY_PATH_EVENTS];

/** Reaches the test step, then a bad credential bounces the seller back to entry (§12). */
export const INVALID_CREDENTIAL_EVENTS: GuidedEvent[] = [
  ...NEW_APP_ISSUANCE,
  { type: "SUBMIT_CREDENTIALS" },
  { type: "CREDENTIAL_REGISTERED" },
  { type: "TEST_RESULT", status: "FAILED", reasonCode: "INVALID_CREDENTIAL" },
];

/** Reuse on load: the backend snapshot shows a prior sync succeeded → completed restored, NO re-test/sync. */
export const SAVED_CREDENTIAL_REUSE_EVENTS: GuidedEvent[] = [
  { type: "RESUME_FROM_CAPABILITY", credentialPresent: true, completed: true },
];

/** Stored key but never completed → land on the connection test as a user CTA, then the seller verifies. */
export const SAVED_KEY_INCOMPLETE_EVENTS: GuidedEvent[] = [
  { type: "RESUME_FROM_CAPABILITY", credentialPresent: true, completed: false },
  { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null },
  { type: "SYNC_RESULT", status: "SUCCESS" },
];

/** Existing app, no stored key (guided-first): enter guidance → the runtime OBSERVES an existing app
 *  (`branch:"existing"` → path="existing") → finish → enter the existing key → register → test → sync (§flow 3). */
export const EXISTING_APP_EVENTS: GuidedEvent[] = [
  { type: "RESUME_FROM_CAPABILITY", credentialPresent: false, completed: false },
  { type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "existing" },
  { type: "ISSUANCE_COMPLETE" },
  { type: "SUBMIT_CREDENTIALS" },
  { type: "CREDENTIAL_REGISTERED" },
  { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null },
  { type: "SYNC_RESULT", status: "SUCCESS" },
];

/** Existing app but the Secret cannot be produced → credential recovery (§flow 4). Guided-first: the runtime
 *  observes the existing app, guidance finishes to the existing-credential entry, then the Secret is missing. */
export const SECRET_LOST_EVENTS: GuidedEvent[] = [
  { type: "RESUME_FROM_CAPABILITY", credentialPresent: false, completed: false },
  { type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: "existing" },
  { type: "ISSUANCE_COMPLETE" },
  { type: "SECRET_UNAVAILABLE" },
];
