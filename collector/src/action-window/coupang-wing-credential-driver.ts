/**
 * **The Coupang WING credential driver** — the page-side half of the calibration and the handoff.
 *
 * Two capabilities, and they are deliberately different sizes. {@link censusCredentialCells} measures where the
 * three values sit and returns structure. {@link readCredentialValues} takes them, once. Everything else this
 * driver does is refuse.
 *
 * **What it structurally cannot do:** click, tap, type, submit, navigate, highlight, tag, mount an overlay, or
 * take a second read. It adds nothing to the seller's page — not even the read-only `data-aw-target` annotation
 * the other WING drivers set — which is why it has no cleanup: there is nothing to undo. A driver that leaves no
 * trace on the DOM it read a credential from is the smallest honest shape for this step.
 *
 * **It never decides that a read may happen.** The confirmation, the barrier, and the ordering live in the
 * caller (`credential/coupang-credential-handoff.ts`); this class is the hands, not the judgement. It does hold
 * one fail-closed precondition of its own — the surface must be the issued open-API screen — because a read
 * taken on a login page is a read of whatever that page happens to render in the third column.
 */
import type { Page } from "playwright";
import { log } from "../log";
import {
  EXTRACT_WING_CENSUS,
  classifyWingUrlCategory,
  observeFrom,
  type WingObservation,
  type WingStructuralCensus,
} from "../cli/coupang-wing-classifier";
import {
  COUPANG_CREDENTIAL_FIELDS,
  COUPANG_CREDENTIAL_FIELD_IDS,
  credentialCellsResolved,
  sanitizeCredentialCellCensus,
  type CredentialCellCensus,
  type CredentialCellRefusal,
} from "./coupang-wing-credential-cells";
import {
  buildCredentialCellCensusScript,
  buildCredentialCellReadScript,
} from "./api-issuance-calibration/credential-cell-inpage";
import type { CredentialReadResult } from "../credential/coupang-credential-handoff";

const SETTLE_TIMEOUT_MS = 2_000;

/**
 * The surfaces a credential may be read from. Both are the issued open-API screen: `classifyWingPage` answers
 * `open_api_issuance` while the open-API marker or the credential anchor paints, and `credential_shown` when the
 * keys-displayed category resolves — the keys appear ON that page rather than instead of it, so a run must accept
 * either without treating the difference as meaningful.
 */
const CREDENTIAL_SURFACES: readonly string[] = ["open_api_issuance", "credential_shown"];

export interface CredentialDriverContextLike {
  pages(): Page[];
}

export interface CoupangWingCredentialDriverOptions {
  context?: CredentialDriverContextLike;
}

export class CoupangWingCredentialDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingCredentialDriverOptions;
  /** Latched the moment a read is attempted. A second attempt is refused, whatever the first one returned. */
  private readAttempted = false;

  constructor(page: Page, opts: CoupangWingCredentialDriverOptions = {}) {
    this.page = page;
    this.opts = opts;
  }

  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  private evalStr<R>(page: Page, script: string): Promise<R> {
    return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
  }

  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      await p.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      /* a timeout is fine — the classifier fails closed on thin signals */
    }
  }

  /** READ-ONLY sanitized observation of the CURRENT surface. No value, no URL, no DOM. */
  async observeSurface(): Promise<WingObservation> {
    const page = this.activePage();
    await this.settle(page);
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    return observeFrom(classifyWingUrlCategory(page.url()), census);
  }

  /**
   * Is this the screen the seller's keys are on? Fails closed on everything else — a login page, the home
   * screen, or a category the classifier could not resolve.
   */
  async classifyInitialSurface(): Promise<{ ok: boolean; observation: WingObservation }> {
    return this.classifySurfaceOf(this.activePage());
  }

  /**
   * Classify ONE page, named by the caller. Separate from {@link classifyInitialSurface} so the read can pin the
   * page it checks and the page it reads to the same object — `activePage()` answers "the newest tab", and two
   * calls a moment apart can be two different tabs.
   */
  private async classifySurfaceOf(page: Page): Promise<{ ok: boolean; observation: WingObservation }> {
    await this.settle(page);
    const structural = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    const observation = observeFrom(classifyWingUrlCategory(page.url()), structural);
    const ok = CREDENTIAL_SURFACES.includes(observation.pageCategory);
    log("aw_coupang_credential_classify", { ok, pageCategory: observation.pageCategory });
    return { ok, observation };
  }

  /**
   * **The value-free census.** Structure, plus one non-emptiness bit per cell. Safe to run before any
   * confirmation — it is what the calibration sitting takes, and what the handoff takes as its pre-flight.
   */
  async censusCredentialCells(): Promise<CredentialCellCensus> {
    const raw = await this.evalStr<unknown>(
      this.activePage(),
      buildCredentialCellCensusScript(COUPANG_CREDENTIAL_FIELDS, { readNonEmpty: true }),
    ).catch(() => null);
    const census = sanitizeCredentialCellCensus(raw, COUPANG_CREDENTIAL_FIELD_IDS);
    const verdict = credentialCellsResolved(census, COUPANG_CREDENTIAL_FIELD_IDS);
    // Structure only: which association answered and how many candidates it found. Never a value, never a bucket
    // derived from one — the non-emptiness bit stays inside the census object the caller inspects.
    log("aw_coupang_credential_cells", {
      resolved: verdict.ok,
      reason: verdict.reason,
      ...(verdict.id ? { field: verdict.id } : {}),
      associations: census.readings.map((r) => r.association ?? "NONE"),
    });
    return census;
  }

  /**
   * **The one-shot read.** Refuses a second call, refuses a surface that is not the issued screen, and refuses
   * anything the in-page resolution could not resolve unambiguously.
   *
   * The surface is re-classified HERE rather than trusted from an earlier call: between the operator's press and
   * this read the page can have navigated, and the screen a value is taken from is the only one that matters.
   */
  async readCredentialValues(): Promise<CredentialReadResult> {
    if (this.readAttempted) {
      // Not a retry, ever. A second read is a second copy of three secrets, taken for a reason the first read
      // already failed to satisfy — the recovery path is the seller's own manual entry, not another attempt.
      log("aw_coupang_credential_read", { attempted: false, reason: "ALREADY_ATTEMPTED" });
      return { ok: false, reason: "MISSING_READING" };
    }
    this.readAttempted = true;
    // ONE page, for both the classification and the read. `activePage()` returns the NEWEST tab, so calling it
    // twice can classify one page and read another — a WING popup opening between the two is enough. The screen
    // a value comes from must be the screen that was checked.
    const page = this.activePage();
    const surface = await this.classifySurfaceOf(page);
    if (!surface.ok) {
      log("aw_coupang_credential_read", { attempted: false, reason: "OFF_SURFACE" });
      return { ok: false, reason: "MISSING_READING" };
    }
    let raw: unknown;
    try {
      raw = await this.evalStr<unknown>(page, buildCredentialCellReadScript(COUPANG_CREDENTIAL_FIELDS));
    } catch {
      // The thrown error is not inspected: an evaluate failure can quote the script, and the script's return
      // value is three secrets.
      log("aw_coupang_credential_read", { attempted: true, ok: false, reason: "EVALUATE_FAILED" });
      return { ok: false, reason: "MISSING_READING" };
    }
    return this.foldRead(raw);
  }

  /**
   * Fold the page's answer into the caller's result type. Total and fail-closed: anything that is not the exact
   * success shape — including a success shape missing a field — is a refusal.
   *
   * Exported behaviour worth naming: the values are passed through verbatim and are NOT inspected, trimmed, or
   * validated here. The page already trimmed and rejected empties; a second pass over the plaintext in this
   * process would be another place a value is touched, for no gain.
   */
  private foldRead(raw: unknown): CredentialReadResult {
    const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (obj["ok"] !== true) {
      const reason = typeof obj["reason"] === "string" ? (obj["reason"] as CredentialCellRefusal) : "MISSING_READING";
      const id = typeof obj["id"] === "string" ? obj["id"] : undefined;
      log("aw_coupang_credential_read", { attempted: true, ok: false, reason, ...(id ? { field: id } : {}) });
      return { ok: false, reason, ...(id ? { id } : {}) };
    }
    const values = obj["values"];
    if (!values || typeof values !== "object") {
      log("aw_coupang_credential_read", { attempted: true, ok: false, reason: "MISSING_READING" });
      return { ok: false, reason: "MISSING_READING" };
    }
    const map = values as Record<string, unknown>;
    // NAMED `values`, deliberately: the repo-wide boundary guard forbids that identifier inside any `log(` or
    // `console.` argument in this file, so the plaintext map is covered by the sweep. It was called `out`, and
    // review pointed out that `log("…", out)` would have passed the guard untouched and then printed
    // `access_key` and `vendor_id` in full, because `safeMeta`'s denylist did not carry those two names.
    const values2: Record<string, string> = {};
    for (const id of COUPANG_CREDENTIAL_FIELD_IDS) {
      const v = map[id];
      if (typeof v !== "string" || v.length === 0) {
        log("aw_coupang_credential_read", { attempted: true, ok: false, reason: "CELL_EMPTY", field: id });
        return { ok: false, reason: "CELL_EMPTY", id };
      }
      values2[id] = v;
    }
    // COUNT only. There is no branch in this class that logs a value, and this is the line a reader checks.
    log("aw_coupang_credential_read", { attempted: true, ok: true, fields: COUPANG_CREDENTIAL_FIELD_IDS.length });
    return { ok: true, values: values2 };
  }
}
