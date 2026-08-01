/**
 * The PURE calibration gate (`src/action-window/api-issuance-calibration/calibration.ts`) — offline, no
 * browser. Locks the acceptance rules a reviewer must trust: match-count → resolution, sensitive-value
 * fail-close, credential-value exclusion, the sanitized/raw split, and the opaque structural signature.
 */
import { describe, it, expect } from "vitest";
import {
  CALIBRATION_STAGES,
  CALIBRATION_TARGET_KINDS,
  looksSensitive,
  pageSignature,
  sanitizeCapture,
  stageIsOptional,
  stageTargetKind,
  structuralSignature,
  summarize,
  type CalibrationStage,
  type RawTargetCapture,
  type SanitizedTargetCandidate,
} from "../../../src/action-window/api-issuance-calibration/calibration";
import type { ApiCenterSignals } from "../../../src/cli/observe-api-center";

const HEX16 = /^[0-9a-f]{16}$/;

function cap(o: Partial<RawTargetCapture> = {}): RawTargetCapture {
  return {
    targetKind: "api_group",
    tagName: "button",
    role: "button",
    inputType: undefined,
    isReadOnly: false,
    isCredentialValueElement: false,
    ancestryTags: ["div", "section", "body"],
    siblingIndex: 0,
    siblingCount: 3,
    boundingBox: { x: 10, y: 10, w: 100, h: 40 },
    stableAttributes: [{ name: "id", value: "apiGroupAdd" }],
    candidateSelector: 'button[id="apiGroupAdd"]',
    matchCount: 1,
    viewport: { w: 1280, h: 800 },
    ...o,
  };
}

const SIGNALS: ApiCenterSignals = {
  urlCategory: "api_center_host",
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCountBucket: "none",
  editableTextInputCountBucket: "none",
  readonlyFieldCountBucket: "none",
  listLikeContainerCountBucket: "few",
};

describe("4-stage contract (return_path removed)", () => {
  it("walks exactly the four surfaces, in order, with return_path gone", () => {
    expect([...CALIBRATION_STAGES]).toEqual(["app_list", "app_detail_anchor", "api_group", "credentials"]);
    expect(CALIBRATION_STAGES).not.toContain("return_path" as unknown as CalibrationStage);
  });

  it("only app_detail_anchor is optional; every other stage requires a capture", () => {
    expect(stageIsOptional("app_detail_anchor")).toBe(true);
    for (const s of ["app_list", "api_group", "credentials"] as const) {
      expect(stageIsOptional(s)).toBe(false);
    }
  });

  it("stageTargetKind: app_list branches open vs create by app existence; the rest are fixed", () => {
    expect(stageTargetKind("app_list", true)).toBe("open_app");
    expect(stageTargetKind("app_list", false)).toBe("create_app");
    expect(stageTargetKind("app_detail_anchor", true)).toBe("app_detail_anchor");
    expect(stageTargetKind("app_detail_anchor", false)).toBe("app_detail_anchor");
    expect(stageTargetKind("api_group", true)).toBe("api_group");
    expect(stageTargetKind("credentials", true)).toBe("credentials");
  });

  it("CALIBRATION_TARGET_KINDS carries no `return` kind", () => {
    expect(CALIBRATION_TARGET_KINDS).toContain("app_detail_anchor");
    expect(CALIBRATION_TARGET_KINDS).not.toContain("return" as never);
    expect([...CALIBRATION_TARGET_KINDS].sort()).toEqual(
      ["api_group", "app_detail_anchor", "create_app", "credentials", "open_app"],
    );
  });

  it("sanitizes an app_detail_anchor capture like any resolved control (anchor is a real target kind)", () => {
    const r = sanitizeCapture(
      cap({
        targetKind: "app_detail_anchor",
        tagName: "h1",
        role: "heading",
        stableAttributes: [{ name: "id", value: "appDetailTitle" }],
        candidateSelector: 'h1[id="appDetailTitle"]',
        matchCount: 1,
      }),
    );
    expect(r.sanitized.targetKind).toBe("app_detail_anchor");
    expect(r.sanitized.resolution).toBe("resolved");
    expect(r.raw?.selector).toBe('h1[id="appDetailTitle"]');
  });
});

describe("sanitizeCapture — match count decides resolution", () => {
  it("matchCount 1 → resolved (with a raw artifact entry)", () => {
    const r = sanitizeCapture(cap({ matchCount: 1 }));
    expect(r.sanitized.resolution).toBe("resolved");
    expect(r.raw).not.toBeNull();
  });

  it("matchCount 0 → unresolved_none, no raw entry", () => {
    const r = sanitizeCapture(cap({ matchCount: 0 }));
    expect(r.sanitized.resolution).toBe("unresolved_none");
    expect(r.raw).toBeNull();
    expect(r.sanitized.confidence).toBe("low");
  });

  it("matchCount ≥2 → unresolved_multiple, no raw entry (never guesses)", () => {
    const r = sanitizeCapture(cap({ matchCount: 4 }));
    expect(r.sanitized.resolution).toBe("unresolved_multiple");
    expect(r.raw).toBeNull();
  });
});

describe("sanitizeCapture — resolved + safe stable id → high confidence + raw entry", () => {
  it("keeps the raw selector only in the raw artifact entry (never on the sanitized candidate)", () => {
    const r = sanitizeCapture(cap({ stableAttributes: [{ name: "id", value: "apiGroupAdd" }], candidateSelector: 'button[id="apiGroupAdd"]' }));
    expect(r.sanitized.resolution).toBe("resolved");
    expect(r.sanitized.confidence).toBe("high");
    expect(r.sanitized.hasStableId).toBe(true);
    expect(r.raw?.selector).toBe('button[id="apiGroupAdd"]');
    // The sanitized candidate never carries the raw selector.
    expect(JSON.stringify(r.sanitized)).not.toContain("apiGroupAdd");
  });

  it("a class/name-only selector resolves at MEDIUM confidence", () => {
    const r = sanitizeCapture(cap({ stableAttributes: [{ name: "class", value: "btn primary" }], candidateSelector: 'button[class="btn primary"]' }));
    expect(r.sanitized.resolution).toBe("resolved");
    expect(r.sanitized.confidence).toBe("medium");
    expect(r.raw).not.toBeNull();
  });
});

describe("sanitizeCapture — sensitive attribute values fail closed", () => {
  const sensitiveValues: Record<string, string> = {
    email: "seller@example.com",
    uuid: "550e8400-e29b-41d4-a716-446655440000",
    numericId: "1002938475",
    jwt: "aaaa.bbbb.cccc",
    secretLike: "abcd1234efgh5678ij",
    overlong: "x".repeat(80),
  };

  for (const [label, value] of Object.entries(sensitiveValues)) {
    it(`drops a sensitive ${label} id → resolved but LOW confidence, no raw entry (value never retained)`, () => {
      const r = sanitizeCapture(cap({ matchCount: 1, stableAttributes: [{ name: "id", value }], candidateSelector: `button[id="${value}"]` }));
      expect(r.sanitized.resolution).toBe("resolved"); // match count is still 1
      expect(r.sanitized.confidence).toBe("low"); // but the only attribute was dropped as sensitive
      expect(r.raw).toBeNull(); // a stripped selector is never persisted
      expect(JSON.stringify(r)).not.toContain(value); // the sensitive value never appears anywhere
    });
  }
});

describe("sanitizeCapture — credential value element is excluded (position only)", () => {
  it("a password input on the credentials target → excluded_credential_value, raw null", () => {
    const r = sanitizeCapture(cap({ targetKind: "credentials", tagName: "input", inputType: "password", isCredentialValueElement: true, candidateSelector: "", stableAttributes: [], matchCount: 0 }));
    expect(r.sanitized.resolution).toBe("excluded_credential_value");
    expect(r.raw).toBeNull();
  });

  it("a readonly value field on the credentials target → excluded_credential_value, raw null", () => {
    const r = sanitizeCapture(cap({ targetKind: "credentials", tagName: "input", isReadOnly: true, candidateSelector: "", stableAttributes: [], matchCount: 0 }));
    expect(r.sanitized.resolution).toBe("excluded_credential_value");
    expect(r.raw).toBeNull();
  });

  it("a non-value control on the credentials target still calibrates normally (e.g. a copy button)", () => {
    const r = sanitizeCapture(cap({ targetKind: "credentials", tagName: "button", stableAttributes: [{ name: "id", value: "copySecretBtn" }], candidateSelector: 'button[id="copySecretBtn"]', matchCount: 1 }));
    expect(r.sanitized.resolution).toBe("resolved");
  });
});

describe("structuralSignature — deterministic, opaque, 16-hex", () => {
  it("is a stable 16-hex hash of the structural shape only", () => {
    const a = structuralSignature("button", ["div", "body"], 0, 3);
    const b = structuralSignature("button", ["div", "body"], 0, 3);
    expect(a).toMatch(HEX16);
    expect(a).toBe(b);
  });

  it("changes when the sibling position changes", () => {
    const first = structuralSignature("button", ["div", "body"], 0, 3);
    const last = structuralSignature("button", ["div", "body"], 2, 3);
    expect(first).not.toBe(last);
  });
});

describe("pageSignature + summarize", () => {
  it("pageSignature emits a sanitized signature with an opaque hash and calibrationPending", () => {
    const ps = pageSignature("app_list", "app_list", SIGNALS);
    expect(ps.signatureHash).toMatch(HEX16);
    expect(ps.calibrationPending).toBe(true);
    expect(ps.stage).toBe("app_list");
    expect(ps.pageCategory).toBe("app_list");
  });

  it("summarize counts resolved vs unresolved targets", () => {
    const resolved = sanitizeCapture(cap({ matchCount: 1 })).sanitized;
    const none = sanitizeCapture(cap({ matchCount: 0 })).sanitized;
    const excluded = sanitizeCapture(cap({ targetKind: "credentials", isCredentialValueElement: true })).sanitized;
    const targets: SanitizedTargetCandidate[] = [resolved, none, excluded];
    const s = summarize([pageSignature("app_list", "app_list", SIGNALS)], targets);
    expect(s.resolvedCount).toBe(1);
    expect(s.unresolvedCount).toBe(2);
    expect(s.pages).toHaveLength(1);
    expect(s.targets).toHaveLength(3);
  });
});

describe("looksSensitive — unit matrix", () => {
  const truthy = ["a@b.com", "550e8400-e29b-41d4-a716-446655440000", "12345", "aaaa.bbbb.cccc", "abcd1234efgh5678ij", "x".repeat(65)];
  const falsy = ["", "add-button", "abc", "123", "api-group", "primary-cta"];

  for (const v of truthy) it(`treats ${JSON.stringify(v).slice(0, 24)} as sensitive`, () => expect(looksSensitive(v)).toBe(true));
  for (const v of falsy) it(`treats ${JSON.stringify(v)} as safe`, () => expect(looksSensitive(v)).toBe(false));
});
