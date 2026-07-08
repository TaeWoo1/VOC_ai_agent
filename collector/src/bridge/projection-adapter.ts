/**
 * **Projection CDP adapter (slice §C).** A transport-neutral wrapper around the EXISTING owned real
 * Chrome + CDP runtime (`progressive-reconnect-chrome.ts` already holds a `CDPSession`). It drives
 * `Page.startScreencast` idempotently, acks frames, and dispatches only reviewed input via `Input.*`.
 *
 * It never launches a browser, never replaces real Chrome with bundled Chromium/Electron, and never emits a
 * reserved/fixture event as a real browser event. The CDP session is injected (`CdpLike`) so the adapter is
 * unit-tested with a fake and, in the agent, bound to the real `ctx.newCDPSession(page)`.
 *
 * Sanitization: it emits pixel frames + coarse device dimensions only. It converts normalized [0,1] input to
 * page CSS px locally (via `projection-input`) and never returns page coordinates/URLs/DOM to a caller.
 */

import { PROJECTION_MAX_FRAME_BYTES } from "./projection-protocol";
import type { ProjectionInput } from "./projection-protocol";
import { classifyProjectionInput, normalizedToCss, type Viewport, type InputClassification } from "./projection-input";

/** The minimal CDP surface the adapter needs — satisfied by Playwright's CDPSession and by test fakes. */
export interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: "Page.screencastFrame", cb: (ev: ScreencastFrameEvent) => void): void;
  off(event: "Page.screencastFrame", cb: (ev: ScreencastFrameEvent) => void): void;
}

export interface ScreencastFrameEvent {
  /** base64 image payload (CDP delivers base64). */
  data: string;
  metadata: { deviceWidth?: number; deviceHeight?: number; pageScaleFactor?: number; offsetTop?: number };
  sessionId: number;
}

/** A sanitized frame handed to the transport: raw pixel bytes + coarse device dimensions. Never logged. */
export interface AdapterFrame {
  seq: number;
  bytes: Buffer;
  deviceWidth: number;
  deviceHeight: number;
}

export interface ProjectionAdapterOptions {
  format?: "jpeg";
  quality?: number;
  everyNthFrame?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Called for each decoded, size-checked frame. Oversize frames are dropped before this fires. */
  onFrame: (frame: AdapterFrame) => void;
  /** Optional: report a dropped oversize frame (counter only, no bytes). */
  onOversizeDropped?: () => void;
}

export type InputDispatch = { accepted: true } | { accepted: false; reason: string };

const DEFAULTS = { format: "jpeg" as const, quality: 50, everyNthFrame: 6, maxWidth: 1280, maxHeight: 720 };

export class ProjectionAdapter {
  private readonly cdp: CdpLike;
  private readonly opts: Required<Omit<ProjectionAdapterOptions, "onOversizeDropped">> & { onOversizeDropped?: () => void };
  private started = false;
  private seq = 0;
  private lastDeviceWidth = DEFAULTS.maxWidth;
  private lastDeviceHeight = DEFAULTS.maxHeight;
  private readonly boundOnFrame: (ev: ScreencastFrameEvent) => void;

  constructor(cdp: CdpLike, options: ProjectionAdapterOptions) {
    this.cdp = cdp;
    this.opts = {
      format: options.format ?? DEFAULTS.format,
      quality: options.quality ?? DEFAULTS.quality,
      everyNthFrame: options.everyNthFrame ?? DEFAULTS.everyNthFrame,
      maxWidth: options.maxWidth ?? DEFAULTS.maxWidth,
      maxHeight: options.maxHeight ?? DEFAULTS.maxHeight,
      onFrame: options.onFrame,
      onOversizeDropped: options.onOversizeDropped,
    };
    this.boundOnFrame = (ev) => void this.handleFrame(ev);
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** The CSS viewport the adapter maps normalized input into (last frame's device dimensions). */
  get viewport(): Viewport {
    return { width: this.lastDeviceWidth, height: this.lastDeviceHeight };
  }

  /** Start the screencast. Idempotent — a second call while started is a no-op. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.cdp.on("Page.screencastFrame", this.boundOnFrame);
    const params: Record<string, unknown> = {
      format: this.opts.format,
      quality: this.opts.quality,
      maxWidth: this.opts.maxWidth,
      maxHeight: this.opts.maxHeight,
      everyNthFrame: this.opts.everyNthFrame,
    };
    await this.cdp.send("Page.startScreencast", params);
  }

  /** Stop the screencast. Idempotent — safe to call when already stopped or after detach. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.cdp.off("Page.screencastFrame", this.boundOnFrame);
    try {
      await this.cdp.send("Page.stopScreencast");
    } catch {
      /* session may already be gone (detach/close) — stop is best-effort */
    }
  }

  private async handleFrame(ev: ScreencastFrameEvent): Promise<void> {
    // Ack every frame so CDP keeps flowing; ack even if we drop the payload (backpressure is at the transport).
    try {
      await this.cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId });
    } catch {
      /* detached — the next recoverable/terminal path handles it */
    }
    if (!this.started) return;
    if (typeof ev.metadata?.deviceWidth === "number") this.lastDeviceWidth = ev.metadata.deviceWidth;
    if (typeof ev.metadata?.deviceHeight === "number") this.lastDeviceHeight = ev.metadata.deviceHeight;
    const bytes = Buffer.from(ev.data, "base64");
    if (bytes.length > PROJECTION_MAX_FRAME_BYTES) {
      this.opts.onOversizeDropped?.();
      return;
    }
    this.seq = (this.seq + 1) >>> 0;
    this.opts.onFrame({ seq: this.seq, bytes, deviceWidth: this.lastDeviceWidth, deviceHeight: this.lastDeviceHeight });
  }

  /**
   * Validate + dispatch a single reviewed input. Returns accepted/rejected (reason). Coordinate conversion is
   * done here in the agent; page coordinates are never returned to the caller. Rejects when not started.
   */
  async dispatchInput(input: ProjectionInput, modifiers: { meta?: boolean; ctrl?: boolean } = {}): Promise<InputDispatch> {
    if (!this.started) return { accepted: false, reason: "not_started" };
    const cls: InputClassification = classifyProjectionInput(input, modifiers);
    if (!cls.allow) return { accepted: false, reason: cls.reason };
    try {
      await this.send(input);
      return { accepted: true };
    } catch {
      return { accepted: false, reason: "not_started" };
    }
  }

  private async send(input: ProjectionInput): Promise<void> {
    const vp = this.viewport;
    switch (input.kind) {
      case "pointer_move": {
        const p = normalizedToCss(input.x, input.y, vp);
        if (!p) return;
        await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
        return;
      }
      case "pointer_down": {
        const p = normalizedToCss(input.x, input.y, vp);
        if (!p) return;
        await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 });
        return;
      }
      case "pointer_up": {
        const p = normalizedToCss(input.x, input.y, vp);
        if (!p) return;
        await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 0 });
        return;
      }
      case "wheel": {
        const p = normalizedToCss(input.x, input.y, vp);
        if (!p) return;
        await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: input.dx ?? 0, deltaY: input.dy });
        return;
      }
      case "key_down":
        await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: input.key, ...(input.code ? { code: input.code } : {}) });
        return;
      case "key_up":
        await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: input.key, ...(input.code ? { code: input.code } : {}) });
        return;
      case "text":
        await this.cdp.send("Input.insertText", { text: input.text });
        return;
    }
  }
}
