/**
 * Building evidence, and turning it into the digest the judge is allowed to see.
 *
 * <b>The digest is the tighter of the two contracts.</b> An {@link EvidenceRef} lives in memory and is
 * returned to an authorized operator UI; a digest LEAVES for a vendor. So `digestFor` emits
 * `key=value` metadata only, in the shape the backend's `EvidenceDigestFloor` admits — and if this
 * function ever emitted a sentence, that floor would refuse the request rather than let it through.
 * Two independent checks on the same property, on both sides of the hop.
 */
import { createHash } from "node:crypto";
import type { EvidenceKind, EvidenceLocator, EvidenceRef } from "./OperatorState";
import type { AttentionCoverage } from "../../spring/types";
import type { EventRange } from "../scope/EvidenceTime";
import { eventRangeToken, observationDate } from "../scope/EvidenceTime";

/**
 * A stable digest of the arguments a tool was called with.
 *
 * Hashed rather than kept, and this is one of the few places in the repository where hashing IS the
 * privacy measure: unlike `IssueSignature` (closed vocabulary, so hashing buys nothing) a tool's
 * arguments are open-ended, and a future tool could take a parameter that turns out to be content.
 * Eight hex characters is enough to tell two calls apart within one run.
 */
export function callDigest(toolName: string, args: Record<string, unknown>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash("sha256").update(`${toolName}:${canonical}`).digest("hex").slice(0, 8);
}

/**
 * Mints run-scoped evidence ids (`e1`, `e2`, …) and holds the refs a run has accumulated.
 *
 * <b>Every ref gets an observation time and no ref gets an event time by default.</b> A read always
 * happened at a time, so `asOf` is knowable for all of them and the builder fills it in; when the rows
 * happened is a property of the SOURCE, so `events` stays null until a call site can name it from the
 * data. The asymmetry is the point — see `scope/EvidenceTime.ts`.
 */
export class EvidenceBuilder {
  private next = 1;
  private readonly refs: EvidenceRef[] = [];
  private readonly observedAt: string;

  /** @param referenceDate the run's as-of date; the day of the read when the request named none. */
  constructor(referenceDate?: string | null) {
    this.observedAt = observationDate(referenceDate);
  }

  add(input: {
    kind: EvidenceKind;
    sourceTool: string;
    args: Record<string, unknown>;
    locator: EvidenceLocator;
    /** Override the run's observation date — for a stored snapshot that carries its own as-of. */
    asOf?: string | null;
    /** The rows' own span. Pass it ONLY from the data; never from the request or the clock. */
    events?: EventRange | null;
    coverage?: AttentionCoverage;
    provenance: string;
  }): EvidenceRef {
    const ref: EvidenceRef = {
      evidenceId: `e${this.next++}`,
      kind: input.kind,
      sourceTool: input.sourceTool,
      sourceCall: callDigest(input.sourceTool, input.args),
      locator: input.locator,
      asOf: input.asOf === undefined ? this.observedAt : input.asOf,
      events: input.events ?? null,
      // Default COVERED only where a source genuinely has no coverage question (a server-side count of
      // the whole org). Anything product- or account-scoped must pass its real verdict.
      coverage: input.coverage ?? "COVERED",
      provenance: input.provenance,
    };
    this.refs.push(ref);
    return ref;
  }

  all(): EvidenceRef[] {
    return [...this.refs];
  }
}

/**
 * The digest for one finding's evidence — one line per ref, `key=value` tokens only.
 *
 * A value is sanitized to the charset the backend's floor accepts: whitespace and quotes are what turn
 * a value into a phrase, so they are stripped rather than escaped. A label that loses characters to
 * this is a label that was about to become prose.
 */
export function digestFor(refs: readonly EvidenceRef[]): string {
  return refs.map(digestLine).join("\n");
}

function digestLine(ref: EvidenceRef): string {
  const parts = [ref.evidenceId, `kind=${token(ref.kind)}`, `coverage=${token(ref.coverage)}`];
  const l = ref.locator;
  if (l.severity) parts.push(`severity=${token(l.severity)}`);
  if (l.label) parts.push(`label=${token(l.label)}`);
  if (l.count != null) parts.push(`count=${Math.trunc(l.count)}`);
  if (l.channelCode) parts.push(`channel=${token(l.channelCode)}`);
  if (l.productName) parts.push(`product=${token(l.productName)}`);
  if (ref.asOf) parts.push(`asOf=${token(ref.asOf)}`);
  // The two times reach the judge under two names, so a model cannot read freshness as recency either.
  if (ref.events) parts.push(`events=${token(eventRangeToken(ref.events))}`);
  parts.push(`source=${token(ref.sourceTool)}`);
  return parts.join(" ");
}

/** Keep only characters the backend's `EvidenceDigestFloor` treats as a value. */
function token(value: string): string {
  const kept = value.replace(/[^\p{L}\p{N}_:./|+,%-]/gu, "");
  return kept.length > 0 ? kept : "unknown";
}
