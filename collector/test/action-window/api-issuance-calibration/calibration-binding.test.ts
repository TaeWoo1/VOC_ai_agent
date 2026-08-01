/**
 * The Node capture CHANNEL (`createCaptureChannel`) driven with FAKE `source` objects — no browser. It proves
 * the fail-closed validation that keeps a stray/hostile capture out: an off-host frame, an off-target tab, a
 * stale nonce, and duplicate events are all rejected; the frame category is re-derived authoritatively; the
 * click-observed flag is threaded; a throwing `source.frame.url()` is swallowed (no crash); and a stored raw
 * capture feeds the frozen gate to the right resolution. The channel NEVER reads a value — only structure moves.
 */
import { describe, expect, it } from "vitest";
import {
  createCaptureChannel,
  type CaptureBindingSource,
  type CaptureChannel,
} from "../../../src/action-window/api-issuance-calibration/calibration-binding";
import { sanitizeCapture } from "../../../src/action-window/api-issuance-calibration/calibration";

const API_CENTER = "https://apicenter.commerce.naver.com/ko/x";
const AUTH_HOST = "https://nid.naver.com/login";
const OFF_HOST = "https://ads.example.com/frame";

function payload(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tagName: "button",
    role: "button",
    inputType: undefined,
    isReadOnly: false,
    isCredentialValueElement: false,
    ancestryTags: ["div", "body"],
    siblingIndex: 0,
    siblingCount: 2,
    boundingBox: { x: 0, y: 0, w: 50, h: 20 },
    stableAttributes: [{ name: "id", value: "btnX" }],
    candidateSelector: 'button[id="btnX"]',
    matchCount: 1,
    viewport: { w: 1000, h: 800 },
    operatorClickObserved: false,
    frameCategory: "top",
    ...o,
  };
}

/** A top-frame source at the given host: `mainFrame()` returns the SAME frame ref. */
function topSource(host = API_CENTER): CaptureBindingSource {
  const frame = { url: () => host };
  return { frame, page: { mainFrame: () => frame } };
}

/** A child-frame source: `mainFrame()` returns a DIFFERENT object than `source.frame`. */
function childSource(host = API_CENTER): CaptureBindingSource {
  const frame = { url: () => host };
  return { frame, page: { mainFrame: () => ({}) } };
}

function activeChannel(isActive = true): CaptureChannel {
  return createCaptureChannel({ urlCategory: "api_center_host", isActivePage: () => isActive });
}

describe("createCaptureChannel — host allow-list", () => {
  it("accepts an api-center-host frame", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(API_CENTER), payload({ stageNonce: "n1" }));
    expect(ch.takeCaptureFor("n1")).not.toBeNull();
  });

  it("accepts a naver-auth-host frame", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "app_list" as never); // kind is opaque to the channel
    ch.onCapture(topSource(AUTH_HOST), payload({ stageNonce: "n1" }));
    expect(ch.takeCaptureFor("n1")).not.toBeNull();
  });

  it("rejects an off-host frame", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(OFF_HOST), payload({ stageNonce: "n1" }));
    expect(ch.takeCaptureFor("n1")).toBeNull();
  });
});

describe("createCaptureChannel — active-tab, nonce, and first-valid gates", () => {
  it("rejects a capture from a non-active tab", () => {
    const ch = activeChannel(false);
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(), payload({ stageNonce: "n1" }));
    expect(ch.takeCaptureFor("n1")).toBeNull();
  });

  it("rejects a stale-nonce capture (a prior stage's event)", () => {
    const ch = activeChannel();
    ch.setActiveStage("n2", "api_group");
    ch.onCapture(topSource(), payload({ stageNonce: "n1" })); // stale
    expect(ch.takeCaptureFor("n2")).toBeNull();
    expect(ch.takeCaptureFor("n1")).toBeNull();
  });

  it("rejects a capture when no stage is active", () => {
    const ch = activeChannel();
    ch.onCapture(topSource(), payload({ stageNonce: "n1" }));
    expect(ch.takeCaptureFor("n1")).toBeNull();
  });

  it("keeps the FIRST valid capture per nonce and ignores later duplicates", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(), payload({ stageNonce: "n1", candidateSelector: 'button[id="first"]' }));
    ch.onCapture(topSource(), payload({ stageNonce: "n1", candidateSelector: 'button[id="second"]' }));
    expect(ch.takeCaptureFor("n1")?.raw.candidateSelector).toBe('button[id="first"]');
  });
});

describe("createCaptureChannel — authoritative frame category + click threading", () => {
  it("derives top when source.frame === source.page.mainFrame()", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(), payload({ stageNonce: "n1", frameCategory: "child" })); // payload lies "child"
    expect(ch.takeCaptureFor("n1")?.frameCategory).toBe("top"); // Node re-derives authoritatively
  });

  it("derives child when source.frame !== source.page.mainFrame()", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(childSource(), payload({ stageNonce: "n1", frameCategory: "top" }));
    expect(ch.takeCaptureFor("n1")?.frameCategory).toBe("child");
  });

  it("falls back to the payload's own frameCategory when mainFrame is unavailable", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    const frame = { url: () => API_CENTER };
    ch.onCapture({ frame, page: {} }, payload({ stageNonce: "n1", frameCategory: "child" }));
    expect(ch.takeCaptureFor("n1")?.frameCategory).toBe("child");
  });

  it("threads operatorClickObserved through", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(), payload({ stageNonce: "n1", operatorClickObserved: true }));
    expect(ch.takeCaptureFor("n1")?.operatorClickObserved).toBe(true);
  });
});

describe("createCaptureChannel — never throws on a hostile source", () => {
  it("swallows a throwing source.frame.url() (no adoption, no throw)", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    const throwingSource = {
      frame: {
        url: () => {
          throw new Error("Target page, context or browser has been closed");
        },
      },
      page: { mainFrame: () => ({}) },
    } as unknown as CaptureBindingSource;
    expect(() => ch.onCapture(throwingSource, payload({ stageNonce: "n1" }))).not.toThrow();
    expect(ch.takeCaptureFor("n1")).toBeNull();
  });

  it("swallows a malformed payload (never throws)", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    expect(() => ch.onCapture(topSource(), null)).not.toThrow();
    expect(() => ch.onCapture(topSource(), "not-an-object")).not.toThrow();
    expect(ch.takeCaptureFor("n1")).toBeNull();
  });
});

describe("createCaptureChannel — a stored raw capture feeds the frozen gate to the right resolution", () => {
  it("matchCount 1 → resolved with a raw selector entry", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(), payload({ stageNonce: "n1", matchCount: 1, candidateSelector: 'button[id="one"]', stableAttributes: [{ name: "id", value: "one" }] }));
    const rec = ch.takeCaptureFor("n1")!;
    const { sanitized, raw } = sanitizeCapture(rec.raw);
    expect(sanitized.resolution).toBe("resolved");
    expect(raw?.selector).toBe('button[id="one"]');
  });

  it("matchCount ≥2 → unresolved_multiple, no raw entry", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "api_group");
    ch.onCapture(topSource(), payload({ stageNonce: "n1", matchCount: 3, candidateSelector: 'button[id="many"]', stableAttributes: [{ name: "id", value: "many" }] }));
    const rec = ch.takeCaptureFor("n1")!;
    const { sanitized, raw } = sanitizeCapture(rec.raw);
    expect(sanitized.resolution).toBe("unresolved_multiple");
    expect(raw).toBeNull();
  });

  it("a credential-value element → excluded with an empty selector, no raw entry", () => {
    const ch = activeChannel();
    ch.setActiveStage("n1", "credentials");
    ch.onCapture(
      topSource(),
      payload({ stageNonce: "n1", tagName: "input", inputType: "password", isCredentialValueElement: true, candidateSelector: "", stableAttributes: [], matchCount: 0 }),
    );
    const rec = ch.takeCaptureFor("n1")!;
    expect(rec.raw.candidateSelector).toBe(""); // credential value never seeds a selector
    const { sanitized, raw } = sanitizeCapture(rec.raw);
    expect(sanitized.resolution).toBe("excluded_credential_value");
    expect(raw).toBeNull();
  });
});
