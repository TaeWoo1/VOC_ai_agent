/**
 * **Is a located element actually LOOKABLE-AT, or is something painted over it?** One in-page hit test.
 *
 * The 2026-08-12 live walk advanced step ⑦ the moment `Access Key` painted — and it painted while WING's own
 * `발급 완료` dialog was still open on top of it. So the walk told the seller to copy keys they could not see,
 * and put step ⑧'s ring on a row behind a modal. "The marker is visible" was true and was not the question.
 *
 * The question is a HIT TEST: at the marker's own coordinates, is the marker what the page would hand to a click?
 * `document.elementFromPoint` answers it for whatever is on top, which is why this needs no knowledge of the
 * dialog at all — no label, no class, no `role`, nothing to calibrate and nothing to drift. Anything WING draws
 * over the credentials is caught by the same test.
 *
 * **Outside the viewport is NOT occluded.** A marker scrolled below the fold has nothing on top of it; it is
 * simply not scrolled to, and step ⑧ scrolls to its ring anyway. Treating that as "covered" would stall the walk
 * on the ordinary case in order to catch the exceptional one, so the two are reported as different facts.
 *
 * Value-free: integers and booleans. No text, no coordinates, no tag of whatever is on top — knowing that
 * SOMETHING covers the marker is the whole decision, and naming it would be a reading of a page we do not read.
 */

/** How the marker's own box is sampled: its centre, plus four inset corners. */
export const OCCLUSION_SAMPLE_COUNT = 5;

/** How far inside the box the corner samples sit, in CSS px, so a 1px border is not what gets hit-tested. */
const CORNER_INSET_PX = 3;

export interface OcclusionReading {
  /** Painting matches for the fixed label. Everything below is present only when this is exactly 1. */
  readonly visibleCount: number;
  readonly hiddenCount: number;
  /** Whether any sample point fell inside the viewport at all. */
  readonly inViewport?: boolean;
  /** Sample points that were inside the viewport and could therefore be tested. */
  readonly sampled?: number;
  /** …of those, how many hit something that is neither the marker, its ancestor, nor its descendant. */
  readonly covered?: number;
}

/**
 * The verdict the walk acts on.
 *  - `CLEAR` — one painting match, and the page would hand it (or its own box) back at its own coordinates.
 *  - `COVERED` — one painting match, and most of it belongs to something else right now.
 *  - `NOT_VISIBLE` — the label matched nothing that paints.
 *  - `UNREADABLE` — the page did not answer in the declared shape. Never folded into `NOT_VISIBLE`: the walk
 *    treats them the same way (it does not advance) and a reader diagnosing a stall needs to tell them apart.
 */
export type OcclusionVerdict = "CLEAR" | "COVERED" | "NOT_VISIBLE" | "UNREADABLE";

/** Fold a raw page answer into {@link OcclusionReading}, dropping anything not of the declared shape. */
export function sanitizeOcclusionReading(raw: unknown): OcclusionReading | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const int = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
  const visibleCount = int(row["visibleCount"]);
  const hiddenCount = int(row["hiddenCount"]);
  if (visibleCount === undefined || hiddenCount === undefined) return null;
  if (visibleCount !== 1) return { visibleCount, hiddenCount };
  const sampled = int(row["sampled"]);
  const covered = int(row["covered"]);
  return {
    visibleCount,
    hiddenCount,
    ...(typeof row["inViewport"] === "boolean" ? { inViewport: row["inViewport"] } : {}),
    ...(sampled !== undefined ? { sampled } : {}),
    ...(covered !== undefined && sampled !== undefined && covered <= sampled ? { covered } : {}),
  };
}

/**
 * Decide from a reading. **Fail-closed in both directions that matter**: an unreadable page and a marker whose
 * samples could not be taken both refuse to say `CLEAR`, and a marker that is off-screen is `CLEAR` because
 * nothing is on top of it.
 *
 * The threshold is a MAJORITY of the testable points rather than any one of them. A single covered point is a
 * tooltip or a sticky header clipping a corner, which is not a reason to hold the walk; a dialog over the
 * credentials covers the middle and most of the box, which is.
 */
export function occlusionVerdict(reading: OcclusionReading | null): OcclusionVerdict {
  if (!reading) return "UNREADABLE";
  if (reading.visibleCount !== 1) return "NOT_VISIBLE";
  if (reading.inViewport !== true || reading.sampled === undefined || reading.sampled === 0) return "CLEAR";
  const covered = reading.covered ?? 0;
  return covered * 2 >= reading.sampled ? "COVERED" : "CLEAR";
}

/**
 * Build the hit-test body for one fixed label. Shares the match and `paints()` rules with
 * `buildFixedLabelLocateScript` verbatim, so "the marker is visible" means the same thing in both.
 */
export function buildFixedLabelOcclusionScript(input: { candidateQuery: string; exactText: string }): string {
  return `(function () {
  /* wing-marker-occlusion (value-free OUTPUT: { visibleCount, hiddenCount, inViewport?, sampled?, covered? }) */
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var INSET = ${CORNER_INSET_PX};
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accName(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && norm(al).length) { return norm(al); }
    /* text read ONLY to compare against a KNOWN fixed label; nothing derived from it is returned. */
    return norm(el.textContent || '');
  }
  function paints(node) {
    if (!node || !node.getClientRects) { return false; }
    var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
    if (cs && cs.display === 'contents') { return node.childElementCount > 0; }
    var rects = node.getClientRects();
    if (!rects || rects.length === 0) { return false; }
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!r && r.width > 0 && r.height > 0;
  }
  /* The hit is OURS if it is the marker, something inside it, or something the marker sits inside — a text node's
     wrapper and the cell that holds it are both the marker as far as "can the seller see it" is concerned. */
  function isOurs(hit, el) {
    if (!hit) { return false; }
    if (hit === el) { return true; }
    if (el.contains && el.contains(hit)) { return true; }
    if (hit.contains && hit.contains(el)) { return true; }
    return false;
  }
  var want = norm(${JSON.stringify(input.exactText)});
  var cands; try { cands = slice(document.querySelectorAll(${JSON.stringify(input.candidateQuery)})); } catch (e) { cands = []; }
  var matches = [], CAP = 4000;
  for (var i = 0; i < cands.length && i < CAP; i++) { if (accName(cands[i]) === want) { matches.push(cands[i]); } }
  var visible = [];
  for (var v = 0; v < matches.length; v++) { if (paints(matches[v])) { visible.push(matches[v]); } }
  var out = { visibleCount: visible.length, hiddenCount: matches.length - visible.length };
  if (visible.length !== 1) { return out; }
  var el = visible[0];
  var r = el.getBoundingClientRect();
  var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
  var pts = [
    [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
    [r.left + INSET, r.top + INSET],
    [r.right - INSET, r.top + INSET],
    [r.left + INSET, r.bottom - INSET],
    [r.right - INSET, r.bottom - INSET]
  ];
  var sampled = 0, covered = 0;
  for (var p = 0; p < pts.length; p++) {
    var x = pts[p][0], y = pts[p][1];
    if (x < 0 || y < 0 || x > vw || y > vh) { continue; }
    sampled++;
    var hit = null;
    try { hit = document.elementFromPoint(x, y); } catch (e) { hit = null; }
    /* A null hit inside the viewport means the page handed back nothing at all there — not a covering element.
       Counted as ours, so an unusual layout does not read as a dialog. */
    if (hit && !isOurs(hit, el)) { covered++; }
  }
  out.inViewport = sampled > 0;
  out.sampled = sampled;
  out.covered = covered;
  return out;
})()`;
}
