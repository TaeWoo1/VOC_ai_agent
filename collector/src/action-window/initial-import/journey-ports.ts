/**
 * **The journey's two ports — the FE-independent boundary. Pure interfaces.**
 *
 * The Agent Runtime owns the journey; the front end is one CLIENT of it. These two ports are the whole surface
 * across which anyone drives or watches a journey, so the runtime never depends on React, a component, an open
 * browser tab, or the Bridge/WebSocket transport in particular — those become ADAPTERS of these ports, one of
 * several. A headless test adapter is another. See `docs/action-window-runtime/agent-first-ui-light-adr.md`.
 *
 * This module imports no FE, no React, no browser, and no network — only the sanitized observation/command
 * shapes. A source guard pins that the kernel, graph, projection, and this port module stay FE-free.
 */
import type { JourneyObservation } from "./journey-projection";

/**
 * **Projection port** — the sink sanitized observations are pushed to. OBSERVE-ONLY: an implementation reports,
 * it never drives a run, mints a ticket, opens a browser, or ingests. `JourneyShadow` is one implementation.
 */
export interface JourneyProjectionPort {
  observe(obs: JourneyObservation): void | Promise<void>;
}

/** A journey command someone issues. Adapters turn it into whatever the concrete transport requires. */
export type JourneyCommand =
  | {
      readonly kind: "START_SEGMENT";
      /** The run this command addresses (the runtime-announced id). */
      readonly runId: string;
      /** The single-use authorization for the segment — the backend mints it; only a client may hold one. */
      readonly launchRef: string;
      readonly channelCode: string;
      readonly expectedRevision?: number;
    }
  | { readonly kind: "REQUEST_STEP_RECHECK"; readonly runId: string; readonly expectedRevision: number }
  | { readonly kind: "CANCEL_RUN"; readonly runId: string; readonly expectedRevision: number };

/**
 * **Command port** — the boundary through which journey commands are issued. The existing Bridge/FE transport
 * is ONE adapter of this (`TransportJourneyCommandPort`); a headless test adapter is another. Nothing about
 * issuing a command requires a rendered UI.
 */
export interface JourneyCommandPort {
  send(command: JourneyCommand): void | Promise<void>;
}
