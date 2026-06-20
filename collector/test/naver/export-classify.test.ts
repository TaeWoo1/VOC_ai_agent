import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPORT_ACTION_PLAN_KEYS,
  planExportAction,
  type ExportLayout,
} from "../../src/naver/export-classify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../../fixtures");
const read = (name: string): string => readFileSync(resolve(fixtures, name), "utf8");

const COUNT_BUCKETS = ["none", "one", "few", "some", "many"];
const LAYOUTS: ExportLayout[] = ["SYNC_DOWNLOAD", "ASYNC_JOB_DETECTED", "LAYOUT_UNRECOGNIZED"];

// Same fake PII embedded in probe_hostile.html — the planner must never echo any of it,
// and (the new risk vs. the probe) must never echo a trigger SELECTOR string either.
const HOSTILE_STRINGS = [
  "달빛코스메틱",
  "seller-admin@example-store.co.kr",
  "홍길동",
  "정말 최악이에요 환불해주세요",
  "ORD-998877",
  "SECRETTOKEN12345",
];

describe("planExportAction — pure no-click layout planner", () => {
  it("classifies a top-document visible+enabled Excel/download button as SYNC_DOWNLOAD", () => {
    const plan = planExportAction(read("export_top_doc_excel_button.html"));
    expect(plan.layout).toBe("SYNC_DOWNLOAD");
    expect(plan.hasActionableExportCandidate).toBe(true);
    expect(plan.actionableExportCandidateCount).toBe("one");
    expect(plan.asyncMarkerPresent).toBe(false);
    expect(COUNT_BUCKETS).toContain(plan.triggerSelectorCount);
    expect(plan.triggerSelectorCount).not.toBe("none");
  });

  it("counts multiple actionable candidates (anchor + role=button) as SYNC_DOWNLOAD", () => {
    const plan = planExportAction(read("export_top_doc_anchor_rolebutton.html"));
    expect(plan.layout).toBe("SYNC_DOWNLOAD");
    expect(plan.hasActionableExportCandidate).toBe(true);
    expect(plan.actionableExportCandidateCount).toBe("few"); // 2 candidates → "few"
  });

  it("classifies a download-center/job page as ASYNC_JOB_DETECTED (async wins over a sync control)", () => {
    const plan = planExportAction(read("export_async_job.html"));
    expect(plan.layout).toBe("ASYNC_JOB_DETECTED");
    expect(plan.asyncMarkerPresent).toBe(true);
  });

  it("classifies a disabled-only export control as LAYOUT_UNRECOGNIZED with no actionable candidate", () => {
    const plan = planExportAction(read("export_disabled_button.html"));
    expect(plan.layout).toBe("LAYOUT_UNRECOGNIZED");
    expect(plan.hasActionableExportCandidate).toBe(false);
    expect(plan.actionableExportCandidateCount).toBe("none");
    expect(plan.asyncMarkerPresent).toBe(false);
  });

  it("classifies export wording in non-interactive copy as LAYOUT_UNRECOGNIZED", () => {
    const plan = planExportAction(read("export_text_only_no_control.html"));
    expect(plan.layout).toBe("LAYOUT_UNRECOGNIZED");
    expect(plan.hasActionableExportCandidate).toBe(false);
  });

  it("is deterministic", () => {
    const html = read("export_top_doc_excel_button.html");
    expect(planExportAction(html)).toEqual(planExportAction(html));
  });
});

describe("planExportAction — sanitized output contract", () => {
  const samples = [
    "export_top_doc_excel_button.html",
    "export_top_doc_anchor_rolebutton.html",
    "export_async_job.html",
    "export_disabled_button.html",
    "export_text_only_no_control.html",
  ];

  it("emits exactly the allow-listed keys, with enum/bucket/boolean leaves only", () => {
    for (const name of samples) {
      const plan = planExportAction(read(name));
      expect(Object.keys(plan).sort()).toEqual([...EXPORT_ACTION_PLAN_KEYS].sort());
      expect(LAYOUTS).toContain(plan.layout);
      expect(typeof plan.hasActionableExportCandidate).toBe("boolean");
      expect(typeof plan.asyncMarkerPresent).toBe("boolean");
      expect(COUNT_BUCKETS).toContain(plan.actionableExportCandidateCount);
      expect(COUNT_BUCKETS).toContain(plan.triggerSelectorCount);
    }
  });

  it("never leaks raw HTML, PII, or a trigger selector string", () => {
    const serialized = JSON.stringify(planExportAction(read("probe_hostile.html")));
    for (const s of HOSTILE_STRINGS) expect(serialized).not.toContain(s);
    // The raw trigger selectors (which can embed ids/keywords) must never appear —
    // only their bucketed COUNT is exposed.
    expect(serialized).not.toContain("data-export");
    expect(serialized).not.toContain("has-text");
    expect(serialized).not.toContain("aria-label");
    expect(serialized).not.toContain("엑셀");
    expect(serialized).not.toContain("button");
  });
});

describe("export-classify.ts — purity source guard (no browser/click/download/save path)", () => {
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "export-classify.ts");
  const code = stripComments(readFileSync(SRC_PATH, "utf8"));

  for (const token of [
    "page.",
    ".click(",
    ".fill(",
    ".press(",
    "dispatchEvent",
    "waitForEvent",
    "saveAs",
    "runExport",
    "writeStatus",
  ]) {
    it(`executable source contains no \`${token}\``, () => {
      expect(code.includes(token)).toBe(false);
    });
  }

  it("imports no browser / live / fs / network module", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/from\s+["']playwright["']/.test(imports)).toBe(false);
    expect(/from\s+["']\.\.\/profile["']/.test(imports)).toBe(false);
    expect(/from\s+["']node:fs["']/.test(imports)).toBe(false);
    expect(/from\s+["']node:https?["']/.test(imports)).toBe(false);
  });

  it("reuses the pure classification exports from review-export (allowed — pure, no click)", () => {
    expect(/from\s+["']\.\/review-export["']/.test(code)).toBe(true);
    expect(/classifyExportPage/.test(code)).toBe(true);
    expect(/findExportCandidates/.test(code)).toBe(true);
    expect(/buildTriggerSelectors/.test(code)).toBe(true);
  });
});
