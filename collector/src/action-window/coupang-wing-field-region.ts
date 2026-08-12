/**
 * **What a fixed WING label's REGION looks like — structure only, never content.** Pure: types + a sanitizer.
 *
 * Two live defects on 2026-08-12 need the same thing, and neither can be fixed by guessing at it:
 *
 *  1. **step ⑦ rings `확인` while 업체명 · URL · IP are still empty.** The seller follows the ring and presses the
 *     control that issues a key against an unfilled form. Deciding "is the form ready" means knowing which INPUT
 *     each of those three labels names — and every measurement so far has read the LABELS
 *     (`stage2.vendor_info.baseline` is a `DT`), never what they are attached to.
 *  2. **step ⑧ anchors on the credential table's HEADER.** `Access Key` matched a `TH`, so the ring landed on a
 *     header cell and the advance fired off a marker that paints behind WING's own 발급 완료 dialog. Anchoring on
 *     the RESULT instead means knowing the header's containing structure, which nothing has ever read.
 *
 * So this is a CENSUS, taken before either rule is written: for a fixed label that resolves uniquely, how is it
 * associated with a region, and what does that region contain — as counts and tag names.
 *
 * **What crosses the boundary.** Tag names, integers, and fixed association enums. No text, no attribute value,
 * no field value, no selector, no id, no class. {@link FieldRegionReading.filledTextInputCount} is the one field
 * that derives from a value at all, and only its EMPTINESS does: the page computes `value.trim().length > 0` and
 * returns how many inputs satisfied it. That is the same shape as the consent-aggregate read, and like it, it
 * gets its own declared capability rather than riding along with the structural ones.
 *
 * **It is never taken on a credential.** {@link FieldRegionRequest.readFilled} is opt-in per candidate and the
 * credential candidates never set it — a count of non-empty key fields is still a reading of the key fields, and
 * the walk's whole claim is that nothing looks at them. `coupang-wing-field-region.test.ts` pins that.
 */

/** How a label was tied to the region that holds its input. A fixed enum — it names no element. */
export const FIELD_REGION_ASSOCIATIONS = [
  /** `<label for=…>` → the element with that id. The only association WING itself declares. */
  "LABEL_FOR",
  /** A `<dt>` naming the `<dd>` that follows it — the shape `업체명` was measured in (`observedTag: "DT"`). */
  "DT_NEXT_DD",
  /** A `<th>` naming the `<td>` beside it — the shape a credential row would take. */
  "TH_NEXT_TD",
  /** The label WRAPS its input (`<label>업체명<input/></label>`). */
  "LABEL_WRAPS",
  /** Nothing structural tied the label to a region. Reported, never guessed past. */
  "NONE",
] as const;
export type FieldRegionAssociation = (typeof FIELD_REGION_ASSOCIATIONS)[number];

/** How many ancestor tag names a reading carries. Enough to see a `TH → TR → THEAD → TABLE` chain, and no more. */
export const FIELD_REGION_ANCESTOR_DEPTH = 6;

/** One candidate to census. `readFilled` is opt-in and must stay off for anything credential-shaped. */
export interface FieldRegionRequest {
  readonly id: string;
  readonly candidateQuery: string;
  readonly exactText: string;
  /**
   * Whether to count how many of the region's text inputs are NON-EMPTY. Off by default, because it is the one
   * field here that touches a value at all. Never set for a credential candidate.
   */
  readonly readFilled?: boolean;
}

/** One label's structural reading. Every field is a count, a tag name, or a fixed enum. */
export interface FieldRegionReading {
  readonly id: string;
  /** Painting matches for the fixed label. The reading below is present only when this is exactly 1. */
  readonly visibleCount: number;
  /** Matches rejected for not painting — tells "nothing visible matched" from "nothing matched". */
  readonly hiddenCount: number;
  /** MEASURED tag of the unique match. An observation, never an expectation. */
  readonly observedTag?: string;
  /**
   * Ancestor tag names from the match outward, nearest first, capped at {@link FIELD_REGION_ANCESTOR_DEPTH}.
   * This is what says whether `Access Key` sits in a table and how deep — the question step ⑧ turns on.
   */
  readonly ancestorTags?: readonly string[];
  readonly association?: FieldRegionAssociation;
  /** Tag of the region the association led to. Absent when the association is `NONE`. */
  readonly regionTag?: string;
  /** Painting `input` / `textarea` / `select` in the region. */
  readonly inputCount?: number;
  /** …of those, the ones that take typed text (so a checkbox or a radio is not counted as a field to fill). */
  readonly textInputCount?: number;
  /** Painting `button` in the region — for `IP 주소`, this is where `추가` would be. */
  readonly buttonCount?: number;
  /**
   * Painting `li` / `tr` / `option` in the region: a REGISTERED-entry count, which is how "the seller pressed
   * 추가" could be observed without reading what they added.
   */
  readonly entryRowCount?: number;
  /**
   * How many of the region's text inputs hold a non-empty trimmed value. Present ONLY when the request set
   * `readFilled`. The value itself never leaves the page.
   */
  readonly filledTextInputCount?: number;
}

/** A whole census — one reading per requested candidate, in request order. */
export interface FieldRegionCensus {
  readonly readings: readonly FieldRegionReading[];
}

const ASSOCIATIONS: ReadonlySet<string> = new Set<string>(FIELD_REGION_ASSOCIATIONS);

function count(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

/**
 * A tag name, and nothing that is not one. Uppercase ASCII letters and digits only — which `tagName` on an HTML
 * element always is, and which no text, id, class or value can be smuggled through.
 */
function tag(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Z][A-Z0-9]{0,19}$/.test(raw) ? raw : undefined;
}

/**
 * Fold whatever the page returned into the declared shape, dropping everything else.
 *
 * Fail-closed and total: a page that answers with something unexpected produces a reading with `visibleCount: 0`
 * rather than a partially-trusted one, because the calling rule ("is the form ready") must read an unanswered
 * page as NOT ready. The sanitizer is the boundary — it is what makes the in-page script's discipline checkable
 * from a unit test rather than only by reading the script.
 */
export function sanitizeFieldRegionCensus(raw: unknown, requestedIds: readonly string[]): FieldRegionCensus {
  const rows = Array.isArray((raw as { readings?: unknown } | null)?.readings)
    ? ((raw as { readings: unknown[] }).readings as unknown[])
    : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      const id = (row as { id?: unknown }).id;
      if (typeof id === "string") byId.set(id, row as Record<string, unknown>);
    }
  }
  const readings = requestedIds.map((id) => {
    const row = byId.get(id);
    const visibleCount = count(row?.["visibleCount"]) ?? 0;
    const base: FieldRegionReading = { id, visibleCount, hiddenCount: count(row?.["hiddenCount"]) ?? 0 };
    if (!row || visibleCount !== 1) return base;
    const ancestors = Array.isArray(row["ancestorTags"])
      ? (row["ancestorTags"] as unknown[]).map(tag).filter((t): t is string => t !== undefined).slice(0, FIELD_REGION_ANCESTOR_DEPTH)
      : [];
    const assocRaw = row["association"];
    const association: FieldRegionAssociation =
      typeof assocRaw === "string" && ASSOCIATIONS.has(assocRaw) ? (assocRaw as FieldRegionAssociation) : "NONE";
    const observedTag = tag(row["observedTag"]);
    const regionTag = association === "NONE" ? undefined : tag(row["regionTag"]);
    return {
      ...base,
      ...(observedTag ? { observedTag } : {}),
      ...(ancestors.length > 0 ? { ancestorTags: ancestors } : {}),
      association,
      ...(regionTag ? { regionTag } : {}),
      ...(count(row["inputCount"]) !== undefined ? { inputCount: count(row["inputCount"])! } : {}),
      ...(count(row["textInputCount"]) !== undefined ? { textInputCount: count(row["textInputCount"])! } : {}),
      ...(count(row["buttonCount"]) !== undefined ? { buttonCount: count(row["buttonCount"])! } : {}),
      ...(count(row["entryRowCount"]) !== undefined ? { entryRowCount: count(row["entryRowCount"])! } : {}),
      ...(count(row["filledTextInputCount"]) !== undefined
        ? { filledTextInputCount: count(row["filledTextInputCount"])! }
        : {}),
    };
  });
  return { readings };
}
