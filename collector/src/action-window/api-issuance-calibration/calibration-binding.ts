/**
 * **API-center calibration — the Node capture CHANNEL (validate + move structure, never a value).**
 *
 * The browser-side init script ({@link buildCalibrationInitScript}) pushes a STRUCTURAL capture to Node via
 * `BrowserContext.exposeBinding`. This module is the Node handler for those two bindings. It is a PURE Node
 * validator: it never drives a page, never awaits, and never touches a field value — it only decides whether
 * an already-structural payload may be adopted, and moves it. Testable WITHOUT a real browser via a fake
 * `source` (see `calibration-binding.test.ts`).
 *
 * Fail-closed validation on every capture (silently ignore on any failure, NEVER throw — a rejected binding
 * call must not crash the operator's session):
 *  - **host allow-list** — the frame's URL must classify to `api_center_host` / `naver_auth_host`; an
 *    off-host frame (e.g. an ad iframe) is rejected;
 *  - **active-tab only** — `isActivePage(source.page)` must be true, so a capture from a stale/popup tab in
 *    the same dedicated context is rejected;
 *  - **active stage + nonce** — an active stage must exist AND `payload.stageNonce` must equal its nonce, so
 *    a stale/late event from a finished stage is rejected;
 *  - **first valid per nonce** — once a capture is stored for a nonce, later duplicates (across tabs/frames)
 *    are ignored (first valid wins).
 * The frame category is re-derived AUTHORITATIVELY from `source.frame === source.page.mainFrame()` (falling
 * back to the payload's own claim only when `mainFrame` is unavailable), so a child-frame capture cannot lie
 * about being top-frame. No `.value` is ever read here — the module only relays structure.
 */
import type { CalibrationTargetKind, RawAttribute, RawTargetCapture } from "./calibration";
import { classifyUrlCategory, type ApiCenterUrlCategory } from "../../cli/observe-api-center";

/** The `source` Playwright hands an `exposeBinding` handler (the subset this module reads). */
export interface CaptureBindingSource {
  frame: { url(): string };
  /** The Playwright `Page` the binding fired in; `mainFrame()` (when present) authoritatively identifies top. */
  page: { mainFrame?: () => unknown } | unknown;
}

/** The current stage the init script pulls via the stage binding (or null when no stage is active). */
export interface ActiveStage {
  nonce: string;
  kind: CalibrationTargetKind;
}

/** A first-valid capture the orchestrator later drains for a nonce. */
export interface CaptureRecord {
  raw: RawTargetCapture;
  frameCategory: "top" | "child";
  operatorClickObserved: boolean;
}

export interface CaptureChannelOptions {
  /** The screened entry host category (always an allowed host); reserved for parity/diagnostics. */
  urlCategory: ApiCenterUrlCategory;
  /** Whether the page a capture fired in is the newest/active API-center tab (off-target tabs are rejected). */
  isActivePage(page: unknown): boolean;
}

export interface CaptureChannel {
  /** Node sets the current stage before announcing it (so a hotkey during the stage is adoptable). */
  setActiveStage(nonce: string, kind: CalibrationTargetKind): void;
  /** Node clears the current stage once it resolves (so a late hotkey for the finished stage finds none). */
  clearActiveStage(): void;
  /** The `__soCalStage__` binding handler — a read-only pull of the current stage (or null). */
  onStageQuery(): ActiveStage | null;
  /** The `__soCalCapture__` binding handler — validate + store the FIRST valid capture per nonce. */
  onCapture(source: unknown, payload: unknown): void;
  /** Drain the stored capture for a nonce (null when none was collected). */
  takeCaptureFor(nonce: string): CaptureRecord | null;
}

const ALLOWED_HOSTS: readonly ApiCenterUrlCategory[] = ["api_center_host", "naver_auth_host"];

/** Best-effort numeric coercion (a malformed payload field falls back rather than poisoning the capture). */
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function box(v: unknown): RawTargetCapture["boundingBox"] {
  const b = (v ?? {}) as Record<string, unknown>;
  return { x: num(b.x, 0), y: num(b.y, 0), w: num(b.w, 0), h: num(b.h, 0) };
}

function viewport(v: unknown): RawTargetCapture["viewport"] {
  const vp = (v ?? {}) as Record<string, unknown>;
  return { w: num(vp.w, 0), h: num(vp.h, 0) };
}

/** Pass stable attributes through as-is (structure only). The frozen gate screens sensitive values later. */
function attrs(v: unknown): RawAttribute[] {
  return Array.isArray(v) ? (v as RawAttribute[]) : [];
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Build the capture channel. The two binding handlers ({@link CaptureChannel.onStageQuery} /
 * {@link CaptureChannel.onCapture}) close over a single mutable active stage + a first-valid store, so the
 * CLI can register them once on the context and mutate the stage per surface.
 */
export function createCaptureChannel(opts: CaptureChannelOptions): CaptureChannel {
  let active: ActiveStage | null = null;
  const store = new Map<string, CaptureRecord>();

  const deriveFrameCategory = (source: CaptureBindingSource, payloadClaim: unknown): "top" | "child" => {
    try {
      const page = source.page as { mainFrame?: () => unknown };
      if (typeof page?.mainFrame === "function") {
        return page.mainFrame() === source.frame ? "top" : "child";
      }
    } catch {
      /* fall through to the payload's own claim */
    }
    return payloadClaim === "child" ? "child" : "top";
  };

  return {
    setActiveStage(nonce, kind) {
      active = { nonce, kind };
    },
    clearActiveStage() {
      active = null;
    },
    onStageQuery() {
      return active;
    },
    onCapture(source, payload) {
      try {
        const src = source as CaptureBindingSource;
        const p = (payload ?? {}) as Record<string, unknown>;

        // Host allow-list — a URL read can throw on a closing frame; treat that as off-host (reject).
        let host: ApiCenterUrlCategory = "unknown";
        try {
          host = classifyUrlCategory(src.frame.url());
        } catch {
          return;
        }
        if (!ALLOWED_HOSTS.includes(host)) return;

        // Active-tab only.
        if (!opts.isActivePage(src.page)) return;

        // Active stage + matching nonce (stale/late event from a prior stage rejected).
        const stage = active;
        if (!stage) return;
        if (p.stageNonce !== stage.nonce) return;

        // First valid per nonce only (duplicate events across tabs/frames — first valid wins).
        if (store.has(stage.nonce)) return;

        const frameCategory = deriveFrameCategory(src, p.frameCategory);
        const raw: RawTargetCapture = {
          targetKind: stage.kind, // authoritative — from the active stage, never the payload's claim
          tagName: typeof p.tagName === "string" ? p.tagName : "",
          role: strOrUndef(p.role),
          inputType: strOrUndef(p.inputType),
          isReadOnly: p.isReadOnly === true,
          isCredentialValueElement: p.isCredentialValueElement === true,
          ancestryTags: Array.isArray(p.ancestryTags) ? (p.ancestryTags as string[]) : [],
          siblingIndex: num(p.siblingIndex, 0),
          siblingCount: num(p.siblingCount, 1),
          boundingBox: box(p.boundingBox),
          stableAttributes: attrs(p.stableAttributes),
          candidateSelector: typeof p.candidateSelector === "string" ? p.candidateSelector : "",
          matchCount: num(p.matchCount, 0),
          viewport: viewport(p.viewport),
        };

        store.set(stage.nonce, { raw, frameCategory, operatorClickObserved: p.operatorClickObserved === true });
      } catch {
        /* fail-closed — a validation/coercion failure silently ignores the capture, never throws */
      }
    },
    takeCaptureFor(nonce) {
      return store.get(nonce) ?? null;
    },
  };
}
