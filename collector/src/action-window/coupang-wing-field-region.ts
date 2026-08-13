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
  /**
   * Whether to census the region's painting descendants BY TAG — see {@link FieldRegionReading.regionTagCounts}.
   *
   * Opt-in for cost rather than for exposure: it walks the whole region instead of four fixed queries, and only
   * the measurement that needs it should pay. It reads strictly less than the counts beside it — tag names, and
   * how many of each.
   */
  readonly readTagCounts?: boolean;
}

/** How many DISTINCT tag names a region census carries. A region with more shapes than this is not a form row. */
export const FIELD_REGION_TAG_CENSUS_LIMIT = 16;

/**
 * **How many buttons WING's `API 호출 IP` region has when nothing is registered — MEASURED, not assumed.**
 *
 * One: the `추가` control itself. Registering an address adds its own remove control beside the chip, so the
 * region carries one button per registered entry ON TOP of this baseline.
 */
export const VENDOR_IP_REGION_BASELINE_BUTTON_COUNT = 1;

/**
 * **Does this region hold at least one REGISTERED IP entry?**
 *
 * The rule this replaced counted `entryRowCount` — `li` / `tr` / `option` — and read **zero on both sides of the
 * registration**, so the guided walk's step ⑥ could never advance. The 2026-08-13 live sitting
 * (`wt-017b33239e33`, READ_ONLY, operator-confirmed at every checkpoint) measured the same region before and
 * after the operator pressed `추가`:
 *
 * | signal          | before | after |
 * |-----------------|--------|-------|
 * | `entryRowCount` | 0      | **0** |
 * | `buttonCount`   | 1      | **2** |
 * | `BUTTON`        | 1      | **2** |
 * | `DIV`           | 2      | **3** |
 * | `SPAN`          | 4      | **6** |
 * | `INPUT`         | 1      | 1     |
 * | `STRONG`        | 2      | 2     |
 *
 * A registered entry is a `div` chip carrying its own remove `button` — which is why a row count cannot see it
 * and a button count can. The 업체명 and URL regions were byte-identical across the same pair while the operator
 * typed into both, so the signal is specific to REGISTRATION rather than to typing.
 *
 * `entryRowCount` is kept as an alternative, not replaced by one: a WING layout that did render rows would still
 * be honoured, and keeping it costs a comparison. Both fail closed — an unmeasured count is not a registration.
 *
 * n=1: one sitting, one address. Registering a second should read `buttonCount: 3`; nothing here depends on
 * that, since the rule asks only whether the count has risen above the baseline.
 */
export function vendorIpEntryRegistered(reading: {
  readonly buttonCount?: number;
  readonly entryRowCount?: number;
}): boolean {
  if ((reading.entryRowCount ?? 0) >= 1) return true;
  return (reading.buttonCount ?? 0) > VENDOR_IP_REGION_BASELINE_BUTTON_COUNT;
}

/** One tag name and how many of it paint inside a region. No text, no attribute, no order dependence. */
export interface RegionTagCount {
  readonly tag: string;
  readonly count: number;
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
  /**
   * **Every painting descendant of the region, counted by TAG NAME.** Present only when the request asks for it.
   *
   * The instrument for a question the four counts above could not answer: on 2026-08-13 the walk read `IP 주소`
   * as not-ready while the seller's screen showed the address REGISTERED — as a removable chip, which is not one
   * of the `li` / `tr` / `option` that {@link entryRowCount} counts. What a registered entry does to this region
   * has never been read, and `entryRowCount` alone cannot say: it reports the same zero for "nothing registered"
   * and "registered as something I do not count".
   *
   * Taken BEFORE and AFTER the seller presses 추가, the difference between two of these names the shape.
   *
   * Sorted by tag name so two readings can be compared directly, and capped at
   * {@link FIELD_REGION_TAG_CENSUS_LIMIT} distinct tags. Tag names and integers — the same alphabet as
   * {@link ancestorTags}, which is to say strictly less than the emptiness count beside it.
   */
  readonly regionTagCounts?: readonly RegionTagCount[];
}

/** A whole census — one reading per requested candidate, in request order. */
export interface FieldRegionCensus {
  readonly readings: readonly FieldRegionReading[];
}

/**
 * **One level of the anchor's ancestor chain, scored by what it encloses.** The measurement that decides where
 * step ⑧'s ring goes.
 *
 * `tr` framed the header row alone; `table` reached past the keys and swallowed the 연동 정보 block, with the
 * seller's own 업체명 / IP / URL in it. The right region is between the two, and no amount of reading the chain's
 * TAG NAMES says which level it is — `DIV > DIV > DIV` is a real answer and a useless one. What distinguishes
 * the levels is what they CONTAIN, so that is what is counted: how many of the credential labels are inside, and
 * how many of the labels that must stay outside.
 *
 * Counts of matched fixed labels — never their text, never a value, never a selector.
 */
export interface AncestorScopeRow {
  /** 1 = the anchor's parent. The anchor itself is never a row: a label is not a region. */
  readonly depth: number;
  readonly tag: string;
  /** How many of the `mustContain` labels paint inside this ancestor. */
  readonly containCount: number;
  /** How many of the `mustExclude` labels do. The first non-zero level is one level too far. */
  readonly excludeCount: number;
}

export interface AncestorScopeReading {
  /** Whether the anchor label itself resolved to exactly one painting element. Nothing below is read if not. */
  readonly anchorResolved: boolean;
  readonly rows: readonly AncestorScopeRow[];
}

/**
 * The SHALLOWEST ancestor holding every label that must be inside and none that must be outside — or `null` when
 * no level does, which is a real answer and must not be rounded up to "use the closest one that nearly works".
 */
export function chooseAncestorScope(reading: AncestorScopeReading, mustContainCount: number): AncestorScopeRow | null {
  if (!reading.anchorResolved) return null;
  for (const row of [...reading.rows].sort((a, b) => a.depth - b.depth)) {
    if (row.containCount === mustContainCount && row.excludeCount === 0) return row;
  }
  return null;
}

/** Fold a raw ancestor-scope answer into the declared shape, dropping anything else. */
export function sanitizeAncestorScope(raw: unknown): AncestorScopeReading {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (obj["anchorResolved"] !== true) return { anchorResolved: false, rows: [] };
  const rows: AncestorScopeRow[] = [];
  for (const r of Array.isArray(obj["rows"]) ? (obj["rows"] as unknown[]) : []) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const depth = count(row["depth"]);
    const t = tag(row["tag"]);
    const containCount = count(row["containCount"]);
    const excludeCount = count(row["excludeCount"]);
    if (depth === undefined || depth < 1 || t === undefined || containCount === undefined || excludeCount === undefined) continue;
    rows.push({ depth, tag: t, containCount, excludeCount });
  }
  return { anchorResolved: true, rows };
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
 * A region's tag census, folded to pairs of a real tag name and a positive integer — and SORTED, so two readings
 * of the same region taken minutes apart can be compared line by line rather than element by element.
 *
 * Everything else is dropped: a row whose tag does not pass {@link tag} carries no information this census is
 * for, and it is exactly the shape through which page text would have to arrive.
 */
function tagCounts(raw: unknown): readonly RegionTagCount[] {
  if (!Array.isArray(raw)) return [];
  const rows: RegionTagCount[] = [];
  for (const row of raw as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const name = tag((row as { tag?: unknown }).tag);
    const n = count((row as { count?: unknown }).count);
    if (name === undefined || n === undefined || n === 0) continue;
    rows.push({ tag: name, count: n });
  }
  rows.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return rows.slice(0, FIELD_REGION_TAG_CENSUS_LIMIT);
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
      ...(tagCounts(row["regionTagCounts"]).length > 0 ? { regionTagCounts: tagCounts(row["regionTagCounts"]) } : {}),
    };
  });
  return { readings };
}
