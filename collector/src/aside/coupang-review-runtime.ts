/**
 * **The program that runs INSIDE Aside's browser for a Coupang WING 리뷰 read — one function, shipped by
 * `toString()`.** The acquisition sibling of `export-runtime.ts`, and deliberately smaller than it.
 *
 * NAVER's lane ends in a file; this one ends in a reading. So nothing about the export contract is reused —
 * there is no download, no host path, no custody. What crosses back is what the page printed, and the two
 * scripts that read it are **not written here**: they arrive on the plan, already authored and unit-tested
 * elsewhere in this repository (`review-row-inpage.ts` and `wing-identity-inpage.ts`). This file forwards
 * them and never composes page code of its own — `aside-guard.test.ts` asserts that by refusing any
 * `document.`, any `querySelector`, and any long string literal in this file.
 *
 * That is the whole answer to "why is `.evaluate(` allowed here when the provider forbids it everywhere
 * else": a review list cannot be read without running a reader in the page, and the fence that matters is not
 * *whether* script runs but *whose* script runs. The ban is now narrower and stronger — arbitrary evaluate is
 * still impossible, because the only arguments are two named plan fields.
 *
 * **It cannot turn a page.** There is no pager step, no click, no `goto` after the entry URL. That is not
 * restraint, it is the seam: `ReviewAcquisitionProbeDriver` has no verb for a page turn, and this program
 * fills that seam.
 *
 * Order is the point: **authentication, then identity, then rows.** A page is not read until the store it
 * belongs to has been established, so a browser signed into the wrong seller never reaches a review.
 *
 * No closure. Nothing here may reference an import or a module-level identifier — the text is evaluated where
 * none of them exist. Plain JavaScript semantics only.
 */

/** The minimal tab surface this runtime needs. Aside's own tab object satisfies it. */
export interface ReviewRuntimeTabLike {
  evaluate<T = unknown>(script: string): Promise<T>;
  waitForLoadState?(state?: string, opts?: { timeout?: number }): Promise<void>;
}

/** The ONLY globals the program receives from Aside (discovery §2; `tabs`/`page` deliberately unused). */
export interface ReviewRuntimeEnv {
  openTab(url: string): Promise<ReviewRuntimeTabLike>;
  closeTab(tab: ReviewRuntimeTabLike): Promise<void>;
}

/** The fully resolved plan the Runner builds from a workflow. Values and page scripts only; no functions. */
export interface ReviewRuntimePlan {
  /** The official WING route this run reads. Observed from WING's own menu anchor — never invented. */
  entryUrl: string;
  /** The repository's `buildWingIdentityScript()` output. Forwarded, never authored here. */
  identityScript: string;
  /** The repository's `buildReviewRowReadScript()` output. Forwarded, never authored here. */
  readerScript: string;
  /** A page whose own text matches one of these, with no sign-out word present, is a sign-in wall. */
  authScript: string;
  settleTimeoutMs: number;
}

export type ReviewRuntimeResult =
  | { ok: true; identity: unknown; rows: unknown; elapsedMs: number }
  | {
      ok: false;
      code: "AUTH_REQUIRED" | "UNSUPPORTED_STATE" | "STORE_UNRESOLVED" | "RUNTIME_FAULT";
      stage: "PREPARE" | "AUTH" | "IDENTITY" | "READ";
      elapsedMs: number;
    };

export async function asideCoupangReviewRuntime(
  plan: ReviewRuntimePlan,
  env: ReviewRuntimeEnv,
): Promise<ReviewRuntimeResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const fail = (
    code: Extract<ReviewRuntimeResult, { ok: false }>["code"],
    stage: Extract<ReviewRuntimeResult, { ok: false }>["stage"],
  ): ReviewRuntimeResult => ({ ok: false, code, stage, elapsedMs: elapsed() });

  let tab: ReviewRuntimeTabLike | null = null;
  try {
    try {
      tab = await env.openTab(plan.entryUrl);
    } catch (e) {
      return fail("UNSUPPORTED_STATE", "PREPARE");
    }
    const opened = tab;
    if (typeof opened.waitForLoadState === "function") {
      try {
        await opened.waitForLoadState("networkidle", { timeout: plan.settleTimeoutMs });
      } catch (e) {
        /* best-effort: an unsettled page is decided by the reads below, not by a timer */
      }
    }

    // 1. Authentication. A sign-in wall is a stop, never a thing to solve or type into.
    let auth: { signedIn: boolean } | null = null;
    try {
      auth = await opened.evaluate(plan.authScript);
    } catch (e) {
      return fail("RUNTIME_FAULT", "AUTH");
    }
    if (!auth || auth.signedIn !== true) return fail("AUTH_REQUIRED", "AUTH");

    // 2. Identity. Read here, judged by the Runner — the comparison needs a value this program must not hold.
    let identity: unknown = null;
    try {
      identity = await opened.evaluate(plan.identityScript);
    } catch (e) {
      return fail("RUNTIME_FAULT", "IDENTITY");
    }
    if (!identity) return fail("STORE_UNRESOLVED", "IDENTITY");

    // 3. Rows — only now, and only the one page this tab is showing.
    let rows: unknown = null;
    try {
      rows = await opened.evaluate(plan.readerScript);
    } catch (e) {
      return fail("RUNTIME_FAULT", "READ");
    }
    return { ok: true, identity, rows, elapsedMs: elapsed() };
  } finally {
    if (tab !== null) {
      try {
        await env.closeTab(tab);
      } catch (e) {
        /* a tab that will not close is not a failed read */
      }
    }
  }
}
