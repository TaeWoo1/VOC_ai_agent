/**
 * **Acquisition supervision — internal state contract (v1).**
 *
 * NOT an Action Window wire contract: nothing here crosses the FE ↔ Runtime socket, and it is versioned
 * separately on purpose. It is the pure, channel-neutral vocabulary a supervisor uses — once per-channel
 * session readiness is known — to resolve HOW a `(channel × capability)` is acquired (reusing the Action
 * Window `ExecutionMode`) and to decide WHETHER to start or ask the seller for exactly one thing. See
 * `./acquisition` for the full doc.
 */
export * from "./acquisition";
export * from "./reliability";
