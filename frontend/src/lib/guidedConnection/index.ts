// NAVER Guided Connection (G3) — pure module barrel. UI imports the guided-journey state, copy,
// and fixtures from here; nothing in this folder touches the DOM, the network, or a secret.
export * from "./types";
export * from "./state";
export * from "./copy";
export {
  NAVER_LIKE_TEMPLATE,
  READY_SIGNAL,
  HAPPY_PATH_EVENTS,
  ZERO_COUNT_SYNC_EVENTS,
  INVALID_CREDENTIAL_EVENTS,
} from "./fixtures";
