// Consumer import proof (frontend).
//
// The frontend consumes the shared Action Window contract SOURCE directly and
// re-exports it here for FE code to import from a single local path. The frontend
// must NOT define its own copy of any protocol type, enum, command, event, or
// View Model — this file is the only bridge, and it only re-exports.
export * from "../../../../contracts/action-window/v1/index";
