// Single import bridge to the shared, normative Action Window contract.
//
// FE consumes the contract SOURCE directly and never redefines protocol types,
// enums, envelopes, validators, or the View Model. All FE modules import from
// here (or straight from the contract) — this file only re-exports.
export * from "../../../../contracts/action-window/v1/index";
// R2: the additive transport framing (Action Window frames riding inside Local
// Agent Bridge v1). Same canonical source, still zero drift — no FE-local copy.
export * from "../../../../contracts/action-window/v1/transport";
