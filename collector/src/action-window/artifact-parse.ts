/**
 * **Action Window artifact PARSE gate — "is this actually a workbook?", answered in booleans.**
 *
 * The D-021 quarantine verdict answers a *structural* question: ZIP local-header magic plus the
 * `[Content_Types].xml` entry NAME within the head of the file. A payload can satisfy both and not
 * be a workbook at all — the pre-spine synthetic fixture was exactly such a payload, and it
 * validated clean while no parser on earth could read it. `valid` therefore never implied
 * *ingestible*, and nothing downstream noticed.
 *
 * This module closes that gap by actually walking the container: the ZIP central directory, the
 * workbook part, and the first worksheet, via the proven dependency-free reader
 * (`../xlsx/workbook-shape-read`, `node:zlib` only — this module touches no filesystem, no network,
 * no browser).
 *
 * **What gates and what does not.**
 * - `parseOk` = the bytes are a readable workbook with at least one worksheet. A run whose artifact
 *   fails this is `ARTIFACT_INVALID`: the seller is told the received file could not be read and to
 *   download it again, which is both true and actionable.
 * - `dataRowPresent` is **observed and NON-GATING**, deliberately. A valid workbook with only a
 *   header row is a real, *legitimate* seller outcome — an export of a quiet date range — and a real
 *   one was observed in the wild. Failing the run on it would tell a seller their correct export was
 *   broken. This follows the D-025 category: the Runtime observes and logs; it does not gate.
 *
 * **Sanitization.** The verdict is booleans ONLY ({@link ARTIFACT_PARSE_VERDICT_KEYS}). Headers,
 * cell values, sheet names, counts, and reader-risk tokens never leave this module — the underlying
 * reader resolves a header row internally, and none of it is returned, logged, or persisted.
 */
import { workbookShapeFromBuffer } from "../xlsx/workbook-shape-read";

/**
 * Sanitized parse verdict — booleans only, allow-listed by {@link ARTIFACT_PARSE_VERDICT_KEYS}.
 *
 * `parseOk` is the fail-closed conjunction of the two structural facts that make a file *readable*
 * as a workbook. `dataRowPresent` is carried alongside it as an OBSERVATION and is deliberately
 * absent from that conjunction.
 */
export interface ArtifactParseVerdict {
  /** The bytes are a ZIP container whose workbook part parsed. */
  workbookReadable: boolean;
  /** At least one worksheet exists in the workbook. */
  sheetPresent: boolean;
  /** At least one row beyond the header row. **Observed only — never gates.** */
  dataRowPresent: boolean;
  /** `workbookReadable && sheetPresent`. Parseability, and nothing else. */
  parseOk: boolean;
}

/** Exact key allow-list — used by the offline no-leak test. */
export const ARTIFACT_PARSE_VERDICT_KEYS: ReadonlyArray<keyof ArtifactParseVerdict> = [
  "workbookReadable",
  "sheetPresent",
  "dataRowPresent",
  "parseOk",
];

/** A verdict in which nothing could be established — every field false. */
function allFalse(): ArtifactParseVerdict {
  return { workbookReadable: false, sheetPresent: false, dataRowPresent: false, parseOk: false };
}

/**
 * Parse-check artifact bytes. Never throws: any malformed, truncated, non-ZIP, ZIP64, or
 * non-workbook payload comes back as a false verdict rather than an error, so a hostile artifact
 * can never surface an exception (whose message could carry content) into the run.
 *
 * `rowCount` from the reader counts `<row>` elements INCLUDING the header, so "at least one data
 * row" is `rowCount >= 2`.
 */
export function artifactParseVerdict(bytes: Uint8Array): ArtifactParseVerdict {
  try {
    const shape = workbookShapeFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const workbookReadable = shape.workbookReadable;
    const sheetPresent = shape.sheetCount >= 1 && shape.selectedSheetIndex !== null;
    return {
      workbookReadable,
      sheetPresent,
      dataRowPresent: shape.rowCount >= 2,
      parseOk: workbookReadable && sheetPresent,
    };
  } catch {
    return allFalse();
  }
}
