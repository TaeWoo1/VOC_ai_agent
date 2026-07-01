/**
 * ESM+ REVIEW header-LABEL quarantine capture (Slice 2b) — the SOLE handler of literal headers.
 *
 * Grounding `ReviewRowMapper` aliases needs the *real* ESM+ REVIEW header strings, which the
 * sanitized discovery captures deliberately never recorded. Under the adopted, one-time,
 * header-label-only Policy-A carve-out (see `docs/esmplus-review-data-policy.md` →
 * "Policy A — narrow header-label carve-out"), this module — and ONLY this module — writes the
 * literal header labels, and writes them to a single gitignored LOCAL artifact for operator
 * review. Everything it RETURNS is sanitized: category + NFC/NFD form + a count bucket + booleans,
 * never a literal label. `JSON.stringify` of a `SanitizedHeaderLabelCapture` is leak-free by
 * construction.
 *
 * HARD scope (mirrors the carve-out):
 *   - Header labels only. It consumes `WorkbookShape.headers` (the reader's INPUT-ONLY header row,
 *     read via `readWorkbookShape` which reads NO data-row values) — so no cell value is ever seen.
 *   - The literal labels go ONLY to the injected artifact writer, whose default targets the
 *     gitignored `findings/*.local.md` quarantine. They are NEVER returned, logged, or printed.
 *   - No upload, no DB/status/capability write, no scheduler/manualSync, no browser, no wall-clock.
 *
 * The filesystem write is injectable (`HeaderArtifactIo`) so the capture is hermetically testable
 * with an in-memory fake; the default `io` is backed by `node:fs`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  categorizeHeader,
  rowCountBucket,
  type HeaderCategory,
  type RowCountBucket,
  type WorkbookShape,
} from "./esm-review-schema-shape";

/** Fixed basename of the local quarantine artifact — gitignored (`findings/*.local.md`). */
export const HEADER_LABEL_ARTIFACT_BASENAME = "esm-review-header-labels.local.md";

/** Pure: the artifact path under a caller-provided findings dir. The module never hardcodes a root. */
export function headerLabelArtifactPath(findingsDir: string): string {
  return join(findingsDir, HEADER_LABEL_ARTIFACT_BASENAME);
}

/** Injectable artifact writer — default is `node:fs`-backed; tests pass an in-memory fake. */
export interface HeaderArtifactIo {
  writeArtifact(path: string, contents: string): void;
}

/** The real `node:fs`-backed writer used when none is injected. Overwrites (written once). */
export const defaultHeaderArtifactIo: HeaderArtifactIo = {
  writeArtifact(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
  },
};

/**
 * Coarse Unicode normalization FORM of a header — a form label, never the text (Policy-A safe).
 * `"ascii"` = normalization-invariant (no decomposable chars, e.g. plain ASCII / CJK ideographs).
 * The NFC/NFD signal de-risks `FileParser`'s no-NFC gap before the Slice-3 alias edit.
 */
export type HeaderNormalizationForm = "ascii" | "nfc" | "nfd" | "other";

/** Pure: classify a header's normalization form by comparing it to its NFC and NFD forms. */
export function normalizationForm(raw: string): HeaderNormalizationForm {
  const nfc = raw.normalize("NFC");
  const nfd = raw.normalize("NFD");
  if (nfc === nfd) return "ascii"; // invariant under normalization — nothing decomposes
  if (raw === nfc) return "nfc";
  if (raw === nfd) return "nfd";
  return "other"; // present in some mixed/other form
}

/** Sanitized per-header metadata — candidate category + normalization form, NEVER the raw label. */
export interface SanitizedHeaderMeta {
  category: HeaderCategory;
  normalizationForm: HeaderNormalizationForm;
}

/**
 * The ONLY shape this module RETURNS — fully sanitized. The literal labels live solely in the
 * artifact write; nothing here can echo one. Count is a coarse BUCKET per the adopted protocol.
 */
export interface SanitizedHeaderLabelCapture {
  workbookReadable: boolean;
  headerCountBucket: RowCountBucket;
  perHeader: SanitizedHeaderMeta[];
  labelsCapturedToLocalArtifact: boolean;
  /** Fixed location category — never the raw path. */
  artifactPathCategory: "findings_local_quarantine";
  /** Invariants, asserted explicitly so the honest posture is machine-checkable. */
  rawHeaderLeak: false;
  schemaMappingConfirmed: false;
  dedupKeyConfirmed: false;
}

/** Escape a header for a markdown table cell (the artifact is the one place labels appear). */
function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

/** Render the LOCAL quarantine artifact — the sole surface that carries literal labels. */
function renderArtifact(labels: readonly string[], meta: readonly SanitizedHeaderMeta[]): string {
  return [
    "# ESM+ REVIEW header labels — LOCAL quarantine artifact",
    "",
    "> Adopted Policy-A carve-out: literal header labels, for operator review ONLY.",
    "> Do NOT commit, stage, upload, or paste into logs / docs / diffs / tests / chat.",
    "> Gitignored (findings/*.local.md). Delete after grounding the ReviewRowMapper aliases.",
    "",
    `Header count: ${labels.length}`,
    "",
    "| # | header label | category | normalization |",
    "|---|---|---|---|",
    ...labels.map((h, i) => `| ${i + 1} | ${escapeCell(h)} | ${meta[i]!.category} | ${meta[i]!.normalizationForm} |`),
    "",
  ].join("\n");
}

/**
 * Capture the workbook's header LABELS to the local quarantine artifact and return a SANITIZED
 * summary. Consumes `shape.headers` (INPUT-ONLY literal labels) — writes them once via `io`, and
 * returns only category / form / bucket / booleans. An unreadable or header-less workbook writes
 * nothing and reports `labelsCapturedToLocalArtifact:false` (fail-closed, observable).
 */
export function captureHeaderLabels(
  shape: WorkbookShape,
  opts: { artifactPath: string; io?: HeaderArtifactIo },
): SanitizedHeaderLabelCapture {
  const io = opts.io ?? defaultHeaderArtifactIo;
  const labels = shape.workbookReadable
    ? shape.headers.map((h) => h.trim()).filter((h) => h.length > 0)
    : [];
  const perHeader: SanitizedHeaderMeta[] = labels.map((h) => ({
    category: categorizeHeader(h),
    normalizationForm: normalizationForm(h),
  }));

  let captured = false;
  if (labels.length > 0) {
    io.writeArtifact(opts.artifactPath, renderArtifact(labels, perHeader));
    captured = true;
  }

  return {
    workbookReadable: shape.workbookReadable,
    headerCountBucket: rowCountBucket(labels.length),
    perHeader,
    labelsCapturedToLocalArtifact: captured,
    artifactPathCategory: "findings_local_quarantine",
    rawHeaderLeak: false,
    schemaMappingConfirmed: false,
    dedupKeyConfirmed: false,
  };
}
