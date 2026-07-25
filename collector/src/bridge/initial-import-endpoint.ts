/**
 * **Initial-review-import ↔ Bridge passthrough endpoint (ISOLATED, v2).** The import-side sibling of
 * `action-window-endpoint.ts` (v1 export) and `reply-submission-endpoint.ts` (v2 reply), binding the **v2**
 * Action Window transport to the existing authenticated `/bridge/ws` socket as an OPAQUE carrier. A separate
 * module so neither existing endpoint is touched; the three differ only in what rides inside the payload,
 * which the Bridge never inspects.
 *
 * Carrier shapes (identical framing to the other two; older clients ignore unknown `type`s):
 *   - both directions: `{ type: "aw", payload: string }` — payload is a serialized v2 Aw*Frame;
 *   - agent → client on attach: `{ type: "aw_session", carrier, transportVersion, runId, channelCode }`.
 *     `carrier` is `import` here, and it is the ONLY field separating this from the reply carrier:
 *     `transportVersion` is 1 in both v1 and v2 (it versions the identical framing) and `channelCode` is
 *     `naver` on both. Without it, a frontend expecting reply-submission runs would attach to an import
 *     agent, build a correctly-versioned client, and sit dormant.
 *
 * **Why this endpoint re-arms and the other two do not.** An export or reply agent hosts exactly one run for
 * its lifetime. An onboarding import is inherently a SEQUENCE — range discovery, then one run per monthly
 * segment, each authorized by its own single-use launch ref — and the seller works through them in one
 * sitting without restarting their agent. So {@link InitialImportEndpoint.armRun} replaces the announced run
 * identity and re-announces it to attached clients. Run identity is still minted by the Runtime and never by
 * the FE; what the FE supplies is the launch ref inside `START_RUN`, which the server resolves.
 *
 * Security + sanitization are fully inherited (origin-allowlist + ticket + pairing at the Bridge; frames
 * carry only enums/counts/opaque refs from the v2 contract). The endpoint logs only booleans/counts, never a
 * frame body and never a launch ref — a ref is a run authorization, so it is treated like a credential.
 */
import { WebSocket } from "ws";
import { AW_CARRIER_IMPORT } from "../../../contracts/action-window/aw-carrier-kind";
import {
  ACTION_WINDOW_TRANSPORT_VERSION,
  deserializeFrame,
  serializeFrame,
  type AwClientFrame,
  type AwServerFrame,
  type AwServerTransport,
} from "../../../contracts/action-window/v2/transport";
import type { AwCarrierEndpoint } from "./aw-carrier";
import { log } from "../log";

/** Agent → client announcement of the hosted import run. Values are sanitized. */
export interface ImportAwSessionAnnouncement {
  type: "aw_session";
  /** Always `import` for this endpoint. An export- or reply-expecting client must fail closed on it. */
  carrier: typeof AW_CARRIER_IMPORT;
  transportVersion: number;
  runId: string;
  channelCode: string;
}

export interface InitialImportEndpointDeps {
  /** Opaque run identity of the currently hosted import run. */
  runId: string;
  /** Sanitized channel identity (SEMANTIC_CODE, e.g. `naver`). */
  channelCode: string;
}

export class InitialImportEndpoint implements AwCarrierEndpoint {
  private runId: string;
  private channelCode: string;
  private announcing = true;
  private readonly sockets = new Set<WebSocket>();
  private readonly listeners = new Set<(frame: AwClientFrame) => void>();
  private replyTarget: WebSocket | null = null;

  constructor(deps: InitialImportEndpointDeps) {
    this.runId = deps.runId;
    this.channelCode = deps.channelCode;
  }

  /** The Runtime end the import session binds to (same interface the v2 loopback implements). */
  readonly transport: AwServerTransport = {
    send: (frame) => this.sendFrame(frame),
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  onClientConnected(ws: WebSocket): void {
    this.sockets.add(ws);
    if (this.announcing) this.announce(ws);
    log("aw_import_client_attached", { clients: this.sockets.size, announced: this.announcing });
  }

  /**
   * Host a NEW import run — the next segment in the sequence, or the discovery run that precedes the plan.
   *
   * Re-announces to every attached client so a frontend that is already connected learns the new run
   * identity without reconnecting; otherwise it would keep addressing commands to the finished run and its
   * `expectedRevision` would never line up again.
   */
  armRun(runId: string, channelCode?: string): void {
    this.runId = runId;
    if (channelCode !== undefined) this.channelCode = channelCode;
    log("aw_import_run_armed", { clients: this.sockets.size, announced: this.announcing });
    if (!this.announcing) return;
    for (const ws of this.sockets) this.announce(ws);
  }

  /** DEV/TEST: pause/resume the `aw_session` announcement (models the agent being down/up). */
  setAnnouncing(on: boolean): void {
    this.announcing = on;
    log("aw_import_dev_announcing", { on });
  }

  isAnnouncing(): boolean {
    return this.announcing;
  }

  hostedRunId(): string {
    return this.runId;
  }

  onClientDisconnected(ws: WebSocket): void {
    this.sockets.delete(ws);
  }

  /** An opaque `{type:"aw"}` carrier payload from an authenticated socket. Malformed frames are dropped. */
  onClientPayload(ws: WebSocket, payload: string): void {
    let frame: AwClientFrame | null = null;
    try {
      const parsed = deserializeFrame(payload);
      if (parsed.kind === "aw_command" || parsed.kind === "aw_resync") frame = parsed;
    } catch {
      frame = null;
    }
    if (!frame) {
      log("aw_import_frame_malformed", { dropped: true });
      return;
    }
    this.replyTarget = ws;
    try {
      for (const listener of [...this.listeners]) listener(frame);
    } finally {
      this.replyTarget = null;
    }
  }

  /**
   * Deliver a client frame to every Runtime listener WITHOUT a socket.
   *
   * Exists for one caller: {@link ImportSegmentHost} has to replay the `START_RUN` that triggered it into
   * the session it then built, because the client sent that command once and must not have to send it twice
   * just because the runtime needed to resolve a launch ref first. It is deliberately not a general inbound
   * path — {@link onClientPayload} is, and it requires an authenticated socket. Nothing here originates a
   * frame; it only re-delivers one that already arrived over an authenticated socket.
   */
  replayClientFrame(frame: AwClientFrame): void {
    for (const listener of [...this.listeners]) listener(frame);
  }

  clientCount(): number {
    return this.sockets.size;
  }

  /**
   * How many Runtime-side listeners are attached.
   *
   * A measurement seam for the one invariant a sequence of runs can quietly break: exactly ONE hosted session
   * may be subscribed at a time (plus the host itself). A finished session left attached keeps answering
   * commands and publishing its own views, and the symptom — a frontend seeing interleaved state from two runs
   * — appears only on the second segment, which is past where an offline test usually looks.
   */
  runtimeListenerCount(): number {
    return this.listeners.size;
  }

  close(): void {
    this.sockets.clear();
    this.listeners.clear();
  }

  private announce(ws: WebSocket): void {
    const announcement: ImportAwSessionAnnouncement = {
      carrier: AW_CARRIER_IMPORT,
      type: "aw_session",
      transportVersion: ACTION_WINDOW_TRANSPORT_VERSION,
      runId: this.runId,
      channelCode: this.channelCode,
    };
    this.sendRaw(ws, JSON.stringify(announcement));
  }

  private sendFrame(frame: AwServerFrame): void {
    const text = JSON.stringify({ type: "aw", payload: serializeFrame(frame) });
    // A command ack / resync reply answers ONE socket's request; everything else is run state that every
    // attached client needs.
    const directed =
      frame.kind === "aw_command_result" || frame.kind === "aw_resync_result" ? this.replyTarget : null;
    if (directed) {
      this.sendRaw(directed, text);
      return;
    }
    for (const ws of this.sockets) this.sendRaw(ws, text);
  }

  private sendRaw(ws: WebSocket, text: string): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}
