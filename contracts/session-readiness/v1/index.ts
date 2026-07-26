/**
 * **Session readiness — internal state contract (v1).**
 *
 * NOT an Action Window wire contract: nothing here crosses the FE ↔ Runtime socket, and it is versioned
 * separately on purpose. It is the pure, channel-neutral vocabulary that per-channel OBSERVE-ONLY probes
 * project their session-liveness into, so the Agent can decide — pull-first, once a day — whether a channel's
 * session is usable and, if not, offer the seller exactly one action. See `./readiness` for the full doc.
 */
export * from "./readiness";
