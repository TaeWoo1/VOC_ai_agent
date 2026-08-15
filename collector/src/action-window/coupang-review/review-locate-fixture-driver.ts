/**
 * **A locate driver with no browser** — the dev boot's stand-in, and the tests' one.
 *
 * The frontend of a locate run has four faces to build (searching, rung, not on this page, two matches), and
 * three of them are states a real WING screen only reaches by accident. Scripting them here is how the
 * surface gets developed and regression-tested without opening a marketplace at all.
 *
 * It is not a simulation of Coupang. It answers with the verdicts it was handed, in order, repeating the last
 * one — which is exactly what the retry loop needs to be exercised against (park, park, then found).
 */
import type { ReviewLocateResult } from "./coupang-wing-review-reader-driver";
import type { ReviewLocateProbeDriver } from "./review-locate-driver";
import type { ReviewLocateTarget, ReviewLocateVerdict } from "./review-locate";

export interface ScriptedLocateAnswer {
  readonly verdict: ReviewLocateVerdict;
  /**
   * How long this read takes. A real WING read is hundreds of milliseconds, and everything that can go wrong
   * between two presses goes wrong DURING one — so a driver that always answers instantly cannot express the
   * failures worth testing.
   */
  readonly delayMs?: number;
  /** Defaults to true for `LOCATED` and false otherwise — the only combination a real driver produces. */
  readonly highlighted?: boolean;
  readonly matches?: number;
  readonly rowsConsidered?: number;
}

export class ReviewLocateFixtureDriver implements ReviewLocateProbeDriver {
  private readonly script: ScriptedLocateAnswer[];
  private index = 0;
  /** Every target it was asked about, so a test can prove the resolved one is what reached the driver. */
  readonly seen: ReviewLocateTarget[] = [];
  /**
   * What happened, IN ORDER (`ring` / `clear`). Counts cannot express "the ring came off AFTER it was drawn",
   * and that ordering is the whole question when a read is still in flight at the moment a run ends.
   */
  readonly trace: string[] = [];
  cleared = 0;
  cleanedUp = false;
  raised = 0;
  private closeSurface: (() => void) | null = null;
  private readonly closed: Promise<void>;

  constructor(script: readonly ScriptedLocateAnswer[] = [{ verdict: "LOCATED" }]) {
    this.script = script.length > 0 ? [...script] : [{ verdict: "LOCATED" }];
    this.closed = new Promise<void>((resolve) => {
      this.closeSurface = resolve;
    });
  }

  /** DEV/TEST: pretend the seller closed the window this run was reading. */
  closeWindow(): void {
    this.closeSurface?.();
  }

  async locate(target: ReviewLocateTarget): Promise<ReviewLocateResult> {
    this.seen.push(target);
    const answer = this.script[Math.min(this.index, this.script.length - 1)]!;
    this.index += 1;
    if (answer.delayMs) await new Promise<void>((r) => setTimeout(r, answer.delayMs));
    const highlighted = answer.highlighted ?? answer.verdict === "LOCATED";
    if (highlighted) this.trace.push("ring");
    return {
      verdict: answer.verdict,
      matchedRowIndex: answer.verdict === "LOCATED" ? 0 : null,
      rowsConsidered: answer.rowsConsidered ?? 10,
      matches: answer.matches ?? (answer.verdict === "LOCATED" ? 1 : answer.verdict === "AMBIGUOUS" ? 2 : 0),
      highlighted,
    };
  }

  async clearHighlight(): Promise<number> {
    this.cleared += 1;
    this.trace.push("clear");
    return 1;
  }

  async cleanup(): Promise<void> {
    this.cleanedUp = true;
  }

  async focusSurface(): Promise<boolean> {
    this.raised += 1;
    return true;
  }

  whenSurfaceClosed(): Promise<void> {
    return this.closed;
  }
}
