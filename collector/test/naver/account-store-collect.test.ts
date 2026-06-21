import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "account-store-collect.ts");

/** Remove block + line comments so the guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

const code = stripComments(readFileSync(SRC_PATH, "utf8"));

// Isolate the scanSelectionCandidates body (which IS the frame.evaluate callback). A named
// inner helper here is the storage-collect bug: under tsx/esbuild keepNames it becomes
// `__name(...)`, undefined in the page sandbox → `ReferenceError: __name is not defined`.
const fnStart = code.indexOf("async function scanSelectionCandidates");
const fnEnd = code.indexOf("async function scanFrameSafe");
const scanFn = code.slice(fnStart, fnEnd);
const evalIdx = scanFn.indexOf("frame.evaluate(");
const evaluateBody = scanFn.slice(evalIdx);

describe("account-store-collect — strictly READ-ONLY / NO-CLICK boundary", () => {
  it("never drives the page (no click/fill/press/select/check/dispatch/download)", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap|focus)\s*\(/.test(code)).toBe(false);
    expect(/waitForEvent\s*\(/.test(code)).toBe(false);
    expect(/saveAs/.test(code)).toBe(false);
  });

  it("never triggers/captures an export, uploads, or writes status", () => {
    expect(code.includes("runExport")).toBe(false);
    expect(code.includes("uploadReviewFile")).toBe(false);
    expect(/\bupload\w*\s*\(/.test(code)).toBe(false);
    expect(code.includes("writeStatus")).toBe(false);
  });

  it("never selects/navigates after reading (no goto/selectOption)", () => {
    expect(/\.goto\s*\(/.test(code)).toBe(false);
  });

  it("prints nothing itself — only returns the sanitized decision/signals to the caller", () => {
    expect(/console\.(log|error|info|warn)\s*\(/.test(code)).toBe(false);
  });

  it("delegates the decision + sanitization entirely to the pure resolver", () => {
    expect(code.includes("decideAccountStoreAction(")).toBe(true);
    expect(code.includes("classifyAccountStoreSurface(")).toBe(true);
    expect(code.includes("pickCandidateIdentity(")).toBe(true);
    expect(code.includes("resolverSurfaceFromVerdict(")).toBe(true);
  });
});

describe("account-store-collect — frame/popup aware, degrades safely", () => {
  it("enumerates frames and detects popup presence via context.pages()", () => {
    expect(/page\.frames\s*\(/.test(code)).toBe(true);
    expect(/page\.mainFrame\s*\(/.test(code)).toBe(true);
    expect(/ctx\.pages\s*\(\)\.length\s*>\s*1/.test(code)).toBe(true);
  });

  it("per-frame scan degrades to [] on a detached/navigating frame (never aborts)", () => {
    expect(/catch\s*\{\s*return\s*\[\]/.test(code)).toBe(true);
  });
});

describe("account-store-collect — the frame.evaluate callback has NO named inner helper (the __name bug)", () => {
  it("isolates the scanSelectionCandidates evaluate callback", () => {
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(evalIdx).toBeGreaterThanOrEqual(0);
    expect(/frame\.evaluate\s*\(/.test(evaluateBody)).toBe(true);
  });

  it("never references the esbuild keepNames helper `__name(`", () => {
    expect(code.includes("__name(")).toBe(false);
  });

  it("has no named arrow/function helper inside the evaluate callback", () => {
    expect(/const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(evaluateBody)).toBe(
      false,
    );
    expect(/\bfunction\s+[A-Za-z_$]/.test(evaluateBody)).toBe(false);
  });

  it("enumerates the DOM with plain inline loops", () => {
    expect(/for\s*\(\s*const\s+el\s+of\s+nodes\s*\)/.test(evaluateBody)).toBe(true);
  });
});

describe("account-store-collect — the candidate SHAPE diagnostic stays sanitized", () => {
  it("the in-page shape object is typed `RawCandidateShape`, so the compiler forbids raw values", () => {
    // RawCandidateShape's fields are all boolean/number/enum — annotating the in-page object
    // with it makes any `hasIdAttr: el.getAttribute('id')` (a string value) a TYPE ERROR.
    expect(/const\s+shape\s*:\s*RawCandidateShape\s*=/.test(evaluateBody)).toBe(true);
  });

  it("derives presence as BOOLEANS (hasAttribute), never returning the attribute value", () => {
    expect(/hasIdAttr:\s*el\.hasAttribute\("id"\)/.test(evaluateBody)).toBe(true);
    expect(/hasClassAttr:\s*el\.hasAttribute\("class"\)/.test(evaluateBody)).toBe(true);
    expect(/hasValueAttr:\s*el\.hasAttribute\("value"\)/.test(evaluateBody)).toBe(true);
    expect(/hasOnClickAttr:\s*el\.hasAttribute\("onclick"\)/.test(evaluateBody)).toBe(true);
  });

  it("emits an href CATEGORY + path-segment COUNT, never the raw href", () => {
    expect(evaluateBody.includes("hrefCategory")).toBe(true);
    expect(evaluateBody.includes("hrefPathSegmentCount")).toBe(true);
    // No shape field carries the raw href / class / id / name / value string.
    expect(/\bhref:\s*href\b/.test(evaluateBody)).toBe(false);
    expect(/className:/.test(evaluateBody)).toBe(false);
    expect(/idValue:|nameValue:|classValue:|hrefValue:/.test(evaluateBody)).toBe(false);
  });

  it("assembles the sanitized shapes via the PURE buildCandidateShape (counts → buckets)", () => {
    expect(code.includes("buildCandidateShape(")).toBe(true);
    expect(/candidateShapes\b/.test(code)).toBe(true);
  });
});

describe("account-store-collect — the href-structure diagnostic never reads query values", () => {
  it("reads query KEY NAMES only (searchParams.keys()), never values", () => {
    expect(/searchParams\.keys\s*\(/.test(evaluateBody)).toBe(true);
    // No query-value read anywhere in the in-page callback.
    expect(/searchParams\.(get|getAll|entries|values)\s*\(/.test(evaluateBody)).toBe(false);
    expect(/\.search\b/.test(evaluateBody)).toBe(false); // never forwards the raw query string
  });

  it("forwards only raw path segments + query key names (no raw href in the output)", () => {
    // The in-page parts object carries pathSegments + queryKeyNames — nothing else.
    expect(/hrefParts\s*=\s*\{\s*pathSegments:\s*segs\s*,\s*queryKeyNames:\s*keys\s*\}/.test(evaluateBody)).toBe(
      true,
    );
  });

  it("classifies the href structure via the PURE buildHrefStructure (categories/buckets only)", () => {
    expect(code.includes("buildHrefStructure(")).toBe(true);
    expect(/hrefStructures\b/.test(code)).toBe(true);
  });
});

describe("account-store-collect — continuation-card scan stays read-only / no-leak", () => {
  // Isolate the scanContinuationCard body (its own page.evaluate callback).
  const ccStart = code.indexOf("async function scanContinuationCard");
  const ccEnd = code.indexOf("async function scanContinuationCardSafe");
  const ccFn = code.slice(ccStart, ccEnd);
  const ccEvalIdx = ccFn.indexOf("page.evaluate(");
  const ccEval = ccFn.slice(ccEvalIdx);

  it("isolates the continuation-card evaluate callback", () => {
    expect(ccStart).toBeGreaterThanOrEqual(0);
    expect(ccEvalIdx).toBeGreaterThanOrEqual(0);
    expect(/page\.evaluate\s*\(/.test(ccEval)).toBe(true);
  });

  it("the continuation evaluate callback has no named inner helper (the __name bug)", () => {
    expect(/const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(ccEval)).toBe(false);
    expect(/\bfunction\s+[A-Za-z_$]/.test(ccEval)).toBe(false);
    expect(code.includes("__name(")).toBe(false);
  });

  it("never clicks/fills/selects in the continuation scan (read-only)", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(ccFn)).toBe(false);
  });

  it("classifies the card via the PURE classifyContinuationCard (text is hashed, never emitted)", () => {
    expect(code.includes("classifyContinuationCard(")).toBe(true);
    expect(/continuationCard\b/.test(code)).toBe(true);
    // The raw card text is forwarded only as `cardText` for hashing — never logged/printed here.
    expect(/console\.(log|error|info|warn)\s*\(/.test(code)).toBe(false);
  });

  it("derives the continue-control COUNT from the validated safe rule, not a regex or index", () => {
    // The count = number of continueControls matching matchesSafeContinueHypothesis.
    expect(
      /safeContinueControlCount\s*=\s*continueControls\.filter\([\s\S]*matchesSafeContinueHypothesis[\s\S]*\)\.length/.test(
        code,
      ),
    ).toBe(true);
    // ...and it is what feeds the continuation classifier's continueControlCount.
    expect(/continueControlCount:\s*safeContinueControlCount/.test(code)).toBe(true);
    // The old bare continue-text regex is gone from the continuation scan (rule lives in one place).
    expect(ccFn.includes("CONTINUE")).toBe(false);
    // No index-based selection of the continue control.
    expect(/continueControls\[\s*\d/.test(code)).toBe(false);
  });
});

describe("account-store-collect — continue-control diagnostic emits marker BOOLEANS only", () => {
  it("computes the five marker booleans in-page and forwards no raw accessible text", () => {
    // The `acc` string is built in-page for matching but only booleans are returned.
    expect(/continueLike:\s*\/.*\/i?\.test\(acc\)/.test(evaluateBody)).toBe(true);
    expect(/loginLike:/.test(evaluateBody)).toBe(true);
    expect(/commerceLike:/.test(evaluateBody)).toBe(true);
    // The accessible string is never returned as a field.
    expect(/\bacc\s*[,}]/.test(evaluateBody)).toBe(false); // `acc` is never pushed into the output object
  });

  it("assembles continueControls via the PURE buildContinueControl (clickable candidates only)", () => {
    expect(code.includes("buildContinueControl(")).toBe(true);
    expect(/continueControls\b/.test(code)).toBe(true);
    expect(/if\s*\(\s*c\.clickable/.test(code)).toBe(true);
  });

  it("computes negative + positive disambiguation markers in-page (booleans only)", () => {
    for (const m of ["differentAccount", "differentId", "otherLogin", "switchAccount", "logout", "currentAccount", "continueCurrent", "loginCurrent"]) {
      expect(evaluateBody.includes(m)).toBe(true);
    }
    // Still no raw accessible text leaves the page (only `.test(acc)` booleans).
    expect(/\bacc\s*[,}]/.test(evaluateBody)).toBe(false);
  });

  it("measures containment against the matched card element via DOM structure only (no click)", () => {
    expect(/cardEl\b/.test(evaluateBody)).toBe(true);
    expect(/\.contains\(/.test(evaluateBody)).toBe(true); // descendant / common-ancestor checks
    expect(/isWithinContinuationCard\b/.test(evaluateBody)).toBe(true);
    expect(/nearestCardMarkerCategory\b/.test(evaluateBody)).toBe(true);
    // Containment never clicks/focuses/dispatches.
    expect(/\.(click|focus|dispatchEvent|scrollIntoView)\s*\(/.test(evaluateBody)).toBe(false);
  });
});
