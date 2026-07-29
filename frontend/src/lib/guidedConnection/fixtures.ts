// NAVER Guided Connection (G3) — synthetic, channel-neutral fixtures (§18).
//
// These are SYNTHETIC: no cloned NAVER brand assets, screenshots, or scraped UI copy — just the
// representative field shape and scripted sanitized-event sequences that let the state machine and
// wizard be exercised entirely offline (§17.10 — no live NAVER needed to verify). The credential
// template mirrors the backend NAVER template shape (client_id shown, client_secret secret) without
// carrying any value.
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

/** The readiness signal that passes the gate (agent paired, renderer up, session live via attestation). */
export const READY_SIGNAL: Extract<GuidedEvent, { type: "READINESS" }> = {
  type: "READINESS",
  agentPaired: true,
  rendererAvailable: true,
  naverSession: "logged_in",
  sessionSource: "attested",
};

/**
 * No stored key → the browser gate runs; the seller chooses to issue a NEW app. Choosing "new" first routes
 * through the app-absence check (one app per store, no delete) — issuance proceeds only once the seller
 * confirms the store has no application (`APPLICATION_LIST_RESULT{ found: false }`).
 */
const NEW_APP_ISSUANCE: GuidedEvent[] = [
  { type: "SAVED_CREDENTIAL_CHECKED", hasSavedCredential: false },
  READY_SIGNAL,
  { type: "APPLICATION_PATH", choice: "new" },
  { type: "APPLICATION_LIST_RESULT", found: false },
  { type: "ACCOUNT_STORE_RESOLVED" },
  { type: "ISSUANCE_COMPLETE" },
  { type: "BEGIN_CREDENTIAL_ENTRY" },
];

/** Happy path (new app): discovery → gate → issuance → credentials → registration → test → sync → completed. */
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

/** Reuse: a stored key is found → straight to the test, no re-entry, no gate → sync → completed (§flow 1–2). */
export const SAVED_CREDENTIAL_REUSE_EVENTS: GuidedEvent[] = [
  { type: "SAVED_CREDENTIAL_CHECKED", hasSavedCredential: true },
  { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null },
  { type: "SYNC_RESULT", status: "SUCCESS" },
];

/** Existing app, no stored key: gate → "have" → enter existing key → register → test → sync (§flow 3). */
export const EXISTING_APP_EVENTS: GuidedEvent[] = [
  { type: "SAVED_CREDENTIAL_CHECKED", hasSavedCredential: false },
  READY_SIGNAL,
  { type: "APPLICATION_PATH", choice: "have" },
  { type: "SUBMIT_CREDENTIALS" },
  { type: "CREDENTIAL_REGISTERED" },
  { type: "TEST_RESULT", status: "SUCCESS", reasonCode: null },
  { type: "SYNC_RESULT", status: "SUCCESS" },
];

/** Existing app but the Secret cannot be produced → credential recovery (§flow 4). */
export const SECRET_LOST_EVENTS: GuidedEvent[] = [
  { type: "SAVED_CREDENTIAL_CHECKED", hasSavedCredential: false },
  READY_SIGNAL,
  { type: "APPLICATION_PATH", choice: "have" },
  { type: "SECRET_UNAVAILABLE" },
];
