/**
 * Answering "어느 상품이?" on the product axis — the dimension, and the rows it produces.
 *
 * <b>Why this file exists.</b> A9/C5 taught the run to tell "상품" (a kind) from "판도리 일체형 종이컵
 * 수거함" (a thing), which stopped the wrong narrowing. It did not make the right answer possible: asked
 * "최근 부정적인 리뷰가 있는 상품을 알려줘", the Operator still read the org's issue list and answered
 * with issues — "접착 탈락에 리뷰 근거가 19건" — while the seller had asked WHICH PRODUCTS. Every number
 * in that answer was true and none of them was about a product
 * (`docs/agent_real_validation_v1.md` §16.7, defect B1).
 *
 * <b>A category mention says the axis; it does not narrow the scope.</b> That is the line this module
 * holds. `PRODUCT: INSTANCE` ⇒ the run is about one product and there is nothing to group. `PRODUCT:
 * CATEGORY`, or the seller's own "상품별" / "…있는 상품을" ⇒ the run stays ORG-scoped and the ANSWER is
 * grouped by product. No resolver is called either way — a grouped run learns its product ids from
 * evidence rows, never from a lookup of the word "상품" (C5).
 *
 * <b>An instance always wins.</b> When the run names or resolves one product, grouping is `NONE` —
 * whatever else the sentence contains. "판도리 일체형 종이컵 수거함 상품의 리뷰" carries the head noun
 * "상품" and is not a request for a ranking; treating it as one would answer a question about one
 * product with a list of others, which is A1 wearing a new hat.
 *
 * <b>Rows are not entities.</b> A grouped row carries a canonical `productId` and never enters
 * `state.entities`. A resolved entity narrows the whole run's scope (`scope/EvidenceScope.needScopeOf`),
 * so writing eleven of them into a run that grouped eleven products would make every org-wide read in
 * the same answer illegal. The ids stay inside the rows, where they identify a row.
 */
import type { EntityKind, InvestigationPlan } from "../plan/InvestigationPlan";
import { asksForAxis, namesCategoryHead, namesInstance } from "../plan/EntityRole";
import type { EventRange } from "../scope/EvidenceTime";
import { eventRange } from "../scope/EvidenceTime";

/**
 * The axis (or axes) an answer is grouped along.
 *
 * <b>The channel axis arrived when something could fill it.</b> This type read `"NONE" | "PRODUCT"`
 * with a note saying a `CHANNEL` value would be "a dimension nothing could ever fill" — true while no
 * evidence row carried a channel. `get_channel_coverage` carries one per row, so the axis now has a
 * source and is added; `PRODUCT_CHANNEL` is the cross of the two, not a third thing.
 *
 * <b>Combining is not the same as choosing.</b> A run may be asked for both axes at once ("채널별
 * 상품 문제"), and collapsing that to one would silently answer half the question. Use
 * {@link groupsBy} rather than comparing this value, so a new combination cannot quietly disable an
 * axis that was already working.
 */
export type GroupingDimension = "NONE" | "PRODUCT" | "CHANNEL" | "PRODUCT_CHANNEL";

/** Whether this dimension includes an axis. The only sanctioned way to read a {@link GroupingDimension}. */
export function groupsBy(dimension: GroupingDimension, axis: "PRODUCT" | "CHANNEL"): boolean {
  if (dimension === "PRODUCT_CHANNEL") {
    return true;
  }
  return dimension === axis;
}

/** Compose two axis verdicts into one dimension. */
export function combineDimensions(product: boolean, channel: boolean): GroupingDimension {
  if (product && channel) return "PRODUCT_CHANNEL";
  if (product) return "PRODUCT";
  return channel ? "CHANNEL" : "NONE";
}

/**
 * Which axis this run should answer along.
 *
 * Two ways in, one vocabulary (`plan/EntityRole.ts` owns every category word in the repository):
 *
 *  1. the planner declared a PRODUCT CATEGORY mention — "상품별", "전체 상품". A category mention is a
 *     statement about what the seller is asking FOR, which is exactly what an axis is.
 *  2. the seller's own sentence asks for the axis — the head noun wearing an axis particle
 *     ({@link asksForAxis}). Needed because the axis is often the one thing the planner does not
 *     mention: over three live samples of "최근 부정적인 리뷰가 있는 상품을 알려줘" on 2026-08-24 the
 *     planner declared `PERIOD` and `ISSUE` entities and <b>no PRODUCT entity at all</b>, three times
 *     out of three. Reading the seller's words with the same closed table is not re-interpreting the
 *     planner's free text; it is reading the only place the word appears.
 */
export function groupingOf(plan: InvestigationPlan, goalText?: string): GroupingDimension {
  return combineDimensions(asksFor("PRODUCT", plan, goalText), asksFor("CHANNEL", plan, goalText));
}

/**
 * Does this run ask to be grouped along one axis?
 *
 * <b>An instance always cancels its own axis, and only its own.</b> Naming one product is a scope, so
 * there is nothing to rank; naming one CHANNEL is also a scope — and the scope gate already enforces
 * it ({@code CHANNEL_MISMATCH}) — but neither cancels the OTHER axis. "네이버에서 어느 상품이
 * 문제야?" is one channel and every product, and folding the channel instance into the product axis
 * would answer a different question than the one asked.
 */
function asksFor(axis: EntityKind & ("PRODUCT" | "CHANNEL"), plan: InvestigationPlan,
                 goalText?: string): boolean {
  if (namesInstance(plan, [axis])) {
    return false;
  }
  const declared = plan.entities.unresolved.some(
    (e) => e.role === "CATEGORY" && namesCategoryHead(axis, e.mention),
  );
  return declared || asksForAxis(axis, plan.userGoal) || asksForAxis(axis, goalText ?? "");
}

/** Which mention kinds would name this dimension's axes. Exposed for the log line and the tests. */
export function axisKindsOf(dimension: GroupingDimension): readonly EntityKind[] {
  const kinds: EntityKind[] = [];
  if (groupsBy(dimension, "PRODUCT")) kinds.push("PRODUCT");
  if (groupsBy(dimension, "CHANNEL")) kinds.push("CHANNEL");
  return kinds;
}

/** Back-compat for callers that only ever cared about the product axis. */
export function axisKindOf(dimension: GroupingDimension): EntityKind | null {
  return groupsBy(dimension, "PRODUCT") ? "PRODUCT" : null;
}

/**
 * One product's slice of one issue, as the evidence summary returns it.
 *
 * `events` is non-null only when the caller could prove the issue's dates ARE this product's — see
 * {@link groupByProduct}. A slice never carries the issue's span otherwise.
 */
export interface IssueSlice {
  readonly issueId: string;
  readonly issueTitle: string;
  readonly productId: string;
  readonly productName: string | null;
  readonly count: number;
  readonly issueTotal: number;
  readonly events: EventRange | null;
}

/**
 * One row of a grouped answer — the contract §6 of the package asks for, as a type.
 *
 * `label` may be null and is never invented: the catalogue holds no name for some product ids in the
 * demo org (three of eleven, live 2026-08-24), and a row without a name is reported as an unnamed
 * product rather than dropped or given the id to read.
 */
export interface GroupedProductRow {
  /** Canonical product identity. The same id the product screen uses. */
  readonly productId: string;
  /** Human-readable label, from the catalogue (C1). Null when the catalogue holds none. */
  readonly label: string | null;
  /** This product's OWN count, summed from its own slices. Never an issue's or the org's total (C4). */
  readonly count: number;
  /** How many distinct issues contributed, and which — provenance for the sentence. */
  readonly issueIds: readonly string[];
  /** The largest single contribution, so a row can name its dominant problem without a second read. */
  readonly topIssueTitle: string | null;
  readonly topIssueCount: number;
  /**
   * When this product's rows happened — non-null ONLY when every contributing slice could be dated
   * exactly. See {@link groupByProduct}.
   */
  readonly events: EventRange | null;
  /** Present only when the evidence itself carried one. Nothing here infers a channel. */
  readonly channelCode: string | null;
}

export interface GroupedProducts {
  readonly rows: readonly GroupedProductRow[];
  /** Rows whose product the catalogue cannot name: how many products, and how many evidence rows. */
  readonly unnamed: { readonly products: number; readonly count: number };
  /** Evidence belonging to no product at all, summed over the slices that were read. */
  readonly unattributed: number;
}

/**
 * Group slices by canonical product.
 *
 * <b>Two products with the same name are two rows; one product seen twice is one row.</b> The key is
 * always the canonical id — the demo org holds ten duplicated titles and one name shared by four
 * products (§13.3) — and a (issue, product) pair is counted once however often it is offered, so a
 * re-read cannot inflate a count.
 *
 * <b>Dates are proven or absent, never borrowed.</b> A slice can be dated exactly when its issue's
 * evidence belongs to that product and nothing else — one product in `byProduct`, zero unattributed —
 * because then the issue's own first/last dates ARE that product's. Anything less and the issue's span
 * would let another product's recent review prove this one's "최근", which is the C4 failure on the
 * temporal axis. So a row carries dates only when EVERY slice behind its count is exact: a partly-dated
 * count would date rows it cannot see.
 */
export function groupByProduct(
  slices: readonly IssueSlice[],
  /** Evidence the scanned issues could attribute to no product at all. Reported, never distributed. */
  unattributed = 0,
): GroupedProducts {
  interface Acc {
    count: number;
    label: string | null;
    issueIds: string[];
    topTitle: string | null;
    topCount: number;
    from: string | null;
    to: string | null;
    allDated: boolean;
  }
  const byProduct = new Map<string, Acc>();
  const counted = new Set<string>();

  for (const slice of slices) {
    const pair = `${slice.issueId}:${slice.productId}`;
    if (counted.has(pair) || slice.count <= 0) {
      continue;
    }
    counted.add(pair);
    const acc = byProduct.get(slice.productId) ?? {
      count: 0, label: null, issueIds: [], topTitle: null, topCount: 0,
      from: null, to: null, allDated: true,
    };
    acc.count += slice.count;
    acc.label = acc.label ?? slice.productName ?? null;
    acc.issueIds.push(slice.issueId);
    if (slice.count > acc.topCount) {
      acc.topCount = slice.count;
      acc.topTitle = slice.issueTitle;
    }
    if (slice.events == null) {
      acc.allDated = false;
    } else {
      acc.from = min(acc.from, slice.events.from);
      acc.to = max(acc.to, slice.events.to);
    }
    byProduct.set(slice.productId, acc);
  }

  const rows: GroupedProductRow[] = [...byProduct.entries()]
    .map(([productId, acc]) => ({
      productId,
      label: acc.label,
      count: acc.count,
      issueIds: acc.issueIds,
      topIssueTitle: acc.topTitle,
      topIssueCount: acc.topCount,
      events: acc.allDated ? eventRange(acc.from, acc.to) : null,
      channelCode: null,
    }))
    // Ranked by the product's OWN number. The issue list's order is by severity and then by the
    // ISSUE's org-wide count, which is not this product's importance (the C4 lesson, one level up).
    .sort((a, b) => b.count - a.count || a.productId.localeCompare(b.productId));

  const unnamedRows = rows.filter((r) => r.label == null);
  return {
    rows,
    unnamed: {
      products: unnamedRows.length,
      count: unnamedRows.reduce((sum, r) => sum + r.count, 0),
    },
    unattributed,
  };
}

/** A row the catalogue could name — the only kind a sentence may be written about. */
export type NamedProductRow = GroupedProductRow & { readonly label: string };

/** The named rows, for stating; the unnamed ones are disclosed as a remainder instead. */
export function namedRows(grouped: GroupedProducts): NamedProductRow[] {
  return grouped.rows.filter((r): r is NamedProductRow => r.label != null);
}

function min(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a < b ? a : b;
}

function max(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}
