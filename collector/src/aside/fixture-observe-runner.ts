/**
 * **The helper's side of the unattended lane: ask if there is work, do exactly that work, report a token.**
 *
 * This is the only loop in this product that acts with nobody watching, so what it CANNOT do is the design:
 *
 *  - it cannot be told where to go. The backend hands back a recipe NAME, never a URL. Each name is resolved
 *    HERE to a route this build published — the loopback fixture through `validateFixtureObserveWorkflow`, the
 *    Coupang 리뷰 목록 through the product's own WING classifier — and a name this build does not publish is
 *    refused without running anything. There is no field in either direction through which a third target
 *    could be expressed.
 *  - it cannot be told what to do. There is no prompt, script or step list on the wire — each program is built
 *    from a frozen recipe, and `aside-guard.test.ts` holds every file here to the same closed vocabulary.
 *  - it cannot report prose. The outcome is one of four closed tokens plus a count and a digest. No page text
 *    ever leaves this machine.
 *  - it cannot invent an empty surface. A run that could not read returns a failure token, never `OBSERVED 0` —
 *    the distinction the whole scheduled proof rests on, and the reason a signed-out marketplace reports
 *    absence rather than a store with no reviews.
 */
import { createHash } from "node:crypto";
import {
  buildFixtureObservePlan,
  buildFixtureObserveProgram,
  parseFixtureObserveResult,
} from "./fixture-observe-executor";
import {
  FIXTURE_OBSERVE_RECIPE_ID,
  fixtureObserveWorkflow,
  validateFixtureObserveWorkflow,
} from "./fixture-observe-workflow";
import { COUPANG_REVIEW_OBSERVE_RECIPE_ID, runCoupangReviewObservation } from "./coupang-observe-runner";
import {
  NAVER_REVIEW_OBSERVE_RECIPE_ID,
  runNaverReviewObservation,
  type NaverDeliveryRequest,
  type NaverDeliveryResponse,
} from "./naver-review-observe-runner";
import {
  NAVER_PRODUCT_INQUIRY_OBSERVE_RECIPE_ID,
  runNaverProductInquiryObservation,
  type NaverInquiryDeliveryRequest,
  type NaverInquiryDeliveryResponse,
} from "./naver-product-inquiry-observe-runner";
import type {
  ReviewHandoffRequest,
  ReviewHandoffResponse,
} from "../action-window/coupang-review/review-handoff-client";
import { runAsideRepl } from "./aside-cli";

/** What the backend publishes and this helper accepts. Anything else is refused without running. */
export type FixtureJobOutcome =
  | "OBSERVED"
  | "SURFACE_UNREADABLE"
  | "EXECUTOR_UNAVAILABLE"
  | "REFUSED"
  /** A marketplace sign-in wall. Never produced by the loopback recipe. */
  | "AUTH_REQUIRED"
  /** A marketplace page the backend could not prove was this account's store. Never produced by the loopback recipe. */
  | "STORE_UNRESOLVED";

/** Why one cycle ended. Closed, and logged as-is: an operator reads these, never a page's words. */
export type FixtureCycleResult =
  | { kind: "NO_WORK" }
  | { kind: "REPORTED"; outcome: FixtureJobOutcome; observedCount: number | null }
  | { kind: "UNREACHABLE" };

export interface FixtureObserveRunnerOptions {
  /** The backend that granted this helper's device token. A token is never presented to a different origin. */
  readonly baseUrl: string;
  readonly token: string;
  /** This helper's own bridge port — the surface it serves to itself. */
  readonly bridgePort: number;
  readonly asideCli?: string;
  readonly asideAccount?: string;
  readonly fetchImpl?: typeof fetch;
  /** Injected for tests; production runs the real closed-vocabulary wrapper. */
  readonly runProgram?: typeof runAsideRepl;
  /**
   * Where a marketplace reading is handed back, when this helper carries that lane at all.
   *
   * <p><b>Absent is a refusal, not a fallback.</b> A helper this deployment did not configure for the
   * marketplace lane reports `REFUSED` for a marketplace recipe without opening anything — the second place
   * that decision is enforced, after the backend's own gate, because the machine that would do the reading
   * should be able to say no by itself.
   */
  readonly reviewHandoff?: (request: ReviewHandoffRequest) => Promise<ReviewHandoffResponse>;
  /**
   * Whether this helper carries the NAVER Seller Center review lane (experimental/QA rollout). Absent or false is a
   * refusal for that recipe without opening anything — the machine's own no, after the backend's gate.
   */
  readonly naverReviewLane?: boolean;
  /** Injected for tests; production runs the real NAVER review observation. */
  readonly runNaverReview?: typeof runNaverReviewObservation;
  /**
   * Whether this helper carries the NAVER Seller Center 상품 문의 lane (experimental/QA rollout). Absent or false is a
   * refusal for that recipe without opening anything.
   */
  readonly naverProductInquiryLane?: boolean;
  /** Injected for tests; production runs the real NAVER product inquiry observation. */
  readonly runNaverProductInquiry?: typeof runNaverProductInquiryObservation;
}

interface ClaimResponse {
  jobId: string | null;
  recipe: string | null;
  /**
   * Present only for a recipe that reads a marketplace: the opaque per-account id the review handoff is keyed
   * by, and a DIGEST of that account's own vendor code. Never the code, never a credential, and neither of them
   * a target — the route still comes from the recipe's own bound workflow, screened here before anything opens.
   */
  accountSlot?: string | null;
  expectedStoreFingerprint?: string | null;
}

/** SHA-256 of the surface's own refs, sorted. Ids we published to ourselves — never a customer's words. */
export function digestOfRefs(refs: readonly string[]): string {
  return createHash("sha256").update([...refs].sort().join("\n"), "utf8").digest("hex");
}

async function claim(opts: FixtureObserveRunnerOptions): Promise<ClaimResponse | null> {
  const send = opts.fetchImpl ?? fetch;
  try {
    const res = await send(`${opts.baseUrl}/api/helper-devices/jobs/claim`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return null;
    return (await res.json()) as ClaimResponse;
  } catch {
    // The backend is unreachable. Not a failed observation — no job was ever taken.
    return null;
  }
}

async function report(
  opts: FixtureObserveRunnerOptions,
  jobId: string,
  outcome: FixtureJobOutcome,
  observedCount: number | null,
  contentDigest: string | null,
): Promise<boolean> {
  const send = opts.fetchImpl ?? fetch;
  try {
    const res = await send(`${opts.baseUrl}/api/helper-devices/jobs/${jobId}/report`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
      body: JSON.stringify({ outcome, observedCount, contentDigest }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Hand a NAVER review reading in for the job this helper holds — to the same origin, with the same device token, as
 * the claim. Any non-2xx or malformed answer is «not delivered», never a partial success.
 */
async function deliverNaverReviews(
  opts: FixtureObserveRunnerOptions,
  jobId: string,
  request: NaverDeliveryRequest,
): Promise<NaverDeliveryResponse | null> {
  const send = opts.fetchImpl ?? fetch;
  try {
    const res = await send(`${opts.baseUrl}/api/helper-devices/jobs/${jobId}/naver-reviews`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<NaverDeliveryResponse>;
    if (typeof body.identityVerdict !== "string" || typeof body.received !== "number"
        || typeof body.inserted !== "number" || typeof body.changed !== "number"
        || typeof body.skipped !== "number" || typeof body.failed !== "number") {
      return null;
    }
    return body as NaverDeliveryResponse;
  } catch {
    return null;
  }
}

/** The inquiry sibling of {@link deliverNaverReviews}: same origin, same token, same «not delivered» rule. */
async function deliverNaverProductInquiries(
  opts: FixtureObserveRunnerOptions,
  jobId: string,
  request: NaverInquiryDeliveryRequest,
): Promise<NaverInquiryDeliveryResponse | null> {
  const send = opts.fetchImpl ?? fetch;
  try {
    const res = await send(`${opts.baseUrl}/api/helper-devices/jobs/${jobId}/naver-product-inquiries`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<NaverInquiryDeliveryResponse>;
    if (typeof body.identityVerdict !== "string" || typeof body.received !== "number"
        || typeof body.inserted !== "number" || typeof body.changed !== "number"
        || typeof body.skipped !== "number" || typeof body.failed !== "number"
        || (body.coverage !== null && typeof body.coverage !== "string")) {
      return null;
    }
    return body as NaverInquiryDeliveryResponse;
  } catch {
    return null;
  }
}

/**
 * One cycle: ask, and if there is work, do it and report. Never throws — an unattended loop that can throw is
 * an unattended loop that stops.
 */
export async function runFixtureObserveCycle(opts: FixtureObserveRunnerOptions): Promise<FixtureCycleResult> {
  const claimed = await claim(opts);
  if (claimed === null) return { kind: "UNREACHABLE" };
  if (!claimed.jobId) return { kind: "NO_WORK" };

  // The marketplace lane: the seller's own store screen instead of one we serve ourselves. Routed by NAME to a
  // runner that resolves its own bound route and screens it locally — this function never learns a URL.
  if (claimed.recipe === COUPANG_REVIEW_OBSERVE_RECIPE_ID) {
    if (!opts.reviewHandoff) {
      await report(opts, claimed.jobId, "REFUSED", null, null);
      return { kind: "REPORTED", outcome: "REFUSED", observedCount: null };
    }
    const observed = await runCoupangReviewObservation({
      expectedStoreFingerprint: claimed.expectedStoreFingerprint ?? null,
      accountSlot: claimed.accountSlot ?? null,
      handoff: opts.reviewHandoff,
      ...(opts.asideCli ? { asideCli: opts.asideCli } : {}),
      ...(opts.asideAccount ? { asideAccount: opts.asideAccount } : {}),
    });
    await report(opts, claimed.jobId, observed.outcome, observed.observedCount, observed.contentDigest);
    return { kind: "REPORTED", outcome: observed.outcome, observedCount: observed.observedCount };
  }

  // The NAVER Seller Center review lane. Same shape: a NAME routed to a runner that resolves its own bound route.
  // Its rows go to the backend for THIS job only, where the store is judged; the report that follows is a token.
  if (claimed.recipe === NAVER_REVIEW_OBSERVE_RECIPE_ID) {
    if (!opts.naverReviewLane) {
      await report(opts, claimed.jobId, "REFUSED", null, null);
      return { kind: "REPORTED", outcome: "REFUSED", observedCount: null };
    }
    const jobId = claimed.jobId;
    const observed = await (opts.runNaverReview ?? runNaverReviewObservation)({
      deliver: (request) => deliverNaverReviews(opts, jobId, request),
      ...(opts.asideCli ? { asideCli: opts.asideCli } : {}),
      ...(opts.asideAccount ? { asideAccount: opts.asideAccount } : {}),
    });
    await report(opts, jobId, observed.outcome, observed.observedCount, observed.contentDigest);
    return { kind: "REPORTED", outcome: observed.outcome, observedCount: observed.observedCount };
  }

  // The NAVER Seller Center 상품 문의 lane. Same shape as the review lane: a NAME routed to a runner that resolves its own
  // bound route; rows go to the backend for THIS job only, where the store and the coverage are judged.
  if (claimed.recipe === NAVER_PRODUCT_INQUIRY_OBSERVE_RECIPE_ID) {
    if (!opts.naverProductInquiryLane) {
      await report(opts, claimed.jobId, "REFUSED", null, null);
      return { kind: "REPORTED", outcome: "REFUSED", observedCount: null };
    }
    const jobId = claimed.jobId;
    const observed = await (opts.runNaverProductInquiry ?? runNaverProductInquiryObservation)({
      deliver: (request) => deliverNaverProductInquiries(opts, jobId, request),
      ...(opts.asideCli ? { asideCli: opts.asideCli } : {}),
      ...(opts.asideAccount ? { asideAccount: opts.asideAccount } : {}),
    });
    await report(opts, jobId, observed.outcome, observed.observedCount, observed.contentDigest);
    return { kind: "REPORTED", outcome: observed.outcome, observedCount: observed.observedCount };
  }

  // A recipe this build does not publish is refused WITHOUT running anything. The helper is the second place
  // this is checked (the job schema is the first), because the machine that would run it should refuse it.
  if (claimed.recipe !== FIXTURE_OBSERVE_RECIPE_ID) {
    await report(opts, claimed.jobId, "REFUSED", null, null);
    return { kind: "REPORTED", outcome: "REFUSED", observedCount: null };
  }

  const workflow = fixtureObserveWorkflow(opts.bridgePort);
  if (validateFixtureObserveWorkflow(workflow).length > 0) {
    // Our own surface did not pass our own screen. Refuse rather than open something unscreened.
    await report(opts, claimed.jobId, "REFUSED", null, null);
    return { kind: "REPORTED", outcome: "REFUSED", observedCount: null };
  }

  const run = opts.runProgram ?? runAsideRepl;
  const program = buildFixtureObserveProgram(buildFixtureObservePlan(workflow));
  const outcome = await run(program, {
    ...(opts.asideCli ? { command: opts.asideCli } : {}),
    ...(opts.asideAccount ? { account: opts.asideAccount } : {}),
    timeoutMs: workflow.settleTimeoutMs + 15_000,
  });

  if (outcome.kind !== "RESULT") {
    await report(opts, claimed.jobId, "EXECUTOR_UNAVAILABLE", null, null);
    return { kind: "REPORTED", outcome: "EXECUTOR_UNAVAILABLE", observedCount: null };
  }
  const parsed = parseFixtureObserveResult(outcome.result);
  if (parsed === null) {
    // An answer we cannot read is not a reading of an empty surface.
    await report(opts, claimed.jobId, "SURFACE_UNREADABLE", null, null);
    return { kind: "REPORTED", outcome: "SURFACE_UNREADABLE", observedCount: null };
  }
  if (!parsed.ok) {
    const failed: FixtureJobOutcome = parsed.code === "SURFACE_UNREADABLE"
      ? "SURFACE_UNREADABLE"
      : "EXECUTOR_UNAVAILABLE";
    await report(opts, claimed.jobId, failed, null, null);
    return { kind: "REPORTED", outcome: failed, observedCount: null };
  }
  const count = parsed.items.length;
  await report(opts, claimed.jobId, "OBSERVED", count, digestOfRefs(parsed.items.map((i) => i.ref)));
  return { kind: "REPORTED", outcome: "OBSERVED", observedCount: count };
}

export interface FixtureObserveLoop {
  stop(): void;
}

/**
 * Poll for work on a timer. The interval is the only thing scheduled here — WHEN an observation happens is the
 * backend's decision (its window), not this loop's; the helper merely offers to be useful.
 */
export function startFixtureObserveLoop(
  opts: FixtureObserveRunnerOptions & { intervalMs?: number; onCycle?: (r: FixtureCycleResult) => void },
): FixtureObserveLoop {
  const intervalMs = Math.max(5_000, opts.intervalMs ?? 30_000);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return; // one cycle at a time: this helper is one desk
    busy = true;
    void runFixtureObserveCycle(opts)
      .then((result) => opts.onCycle?.(result))
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
  };
}
