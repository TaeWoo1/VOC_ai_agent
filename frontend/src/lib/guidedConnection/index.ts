// NAVER Guided Connection (G3) — pure module barrel. UI imports the guided-journey state, copy,
// tutorial content, capability overlay, and fixtures from here; nothing in this folder touches the
// DOM, the network, or a secret.
export * from "./types";
export * from "./state";
export * from "./copy";
export * from "./persistence";
export * from "./tutorial";
export * from "./reviewCapability";
export * from "./walkthrough";
export {
  NAVER_LIKE_TEMPLATE,
  HAPPY_PATH_EVENTS,
  ZERO_COUNT_SYNC_EVENTS,
  INVALID_CREDENTIAL_EVENTS,
  SAVED_CREDENTIAL_REUSE_EVENTS,
  SAVED_KEY_INCOMPLETE_EVENTS,
  EXISTING_APP_EVENTS,
  SECRET_LOST_EVENTS,
} from "./fixtures";
