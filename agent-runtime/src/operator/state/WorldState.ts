/**
 * <b>What is true about this seller, decided once per turn, before anything is planned.</b>
 *
 * Agent Procedure Layer v1 — the first of the two seams the architecture audit
 * (`docs/agent_runtime_architecture_audit_v1.md`) found missing. The audit's measurement, in one line:
 * the planner could not see whether this seller had connected anything, and the answer layer read the
 * same coverage table in FOUR places, each deriving its own verdict.
 *
 * <b>What this is not.</b> Not a context object, not a cache, not a place to put facts «in case someone
 * needs them». It holds exactly what a {@link import("../procedure/Procedure").Procedure} needs to
 * decide whether it can run and, when it cannot, why — nothing else. Rows, ids, customer text, per-object
 * capability and freshness stay where they are: they are answers to per-object questions and are read by
 * the lane that asks them.
 *
 * <b>Assembled from the source of truth, never invented.</b> `readiness` comes from
 * `GET /api/channels/coverage`; `anchor` and `activeTask` come from the conversation the store already
 * holds. A coverage read that failed is `UNKNOWN` and claims nothing — telling a connected seller they
 * have no channels is the one error they cannot check.
 *
 * <b>The raw rows travel with it</b> so that the lanes which need one channel's row (the acquisition
 * step) read the turn's own snapshot rather than making a second, independently-timed request. That is
 * not convenience: two reads of the same table in one turn is how a card once said 「8월 27일 기준」 next
 * to a sentence saying 「8월 20일 기준」.
 */
import type { ChannelCoverageRow } from "../../spring/types";
import type { ActiveTask, WorkingSetView } from "../../conversation/contract";
import type { SellerReadiness } from "../capability/SellerReadiness";
import { UNKNOWN_READINESS, sellerReadinessOf } from "../capability/SellerReadiness";

/** The kind of object the conversation is standing on. The ids stay in the working set. */
export type WorldAnchorKind = "INQUIRY" | "REVIEW" | "PRODUCT";

export interface WorldState {
  /** Whether operational rows can exist for this organisation at all. */
  readonly readiness: SellerReadiness;
  /** Which kind of object is anchored, or null. Selection decides which procedure a sentence is about. */
  readonly anchor: WorldAnchorKind | null;
  /** The step of a procedure already in flight, as the previous turn recorded it. */
  readonly activeTask: ActiveTask | null;
  /** The coverage snapshot this world was derived from — one read, shared by every lane that needs a row. */
  readonly coverage: readonly ChannelCoverageRow[] | null;
}

export const UNKNOWN_WORLD: WorldState = {
  readiness: UNKNOWN_READINESS, anchor: null, activeTask: null, coverage: null,
};

/** The anchored object's kind, from the working set the conversation already persists. */
function anchorOf(set: WorkingSetView | null): WorldAnchorKind | null {
  if (!set) return null;
  if (set.selectedObject) return set.selectedObject.kind;
  return set.kind === "INQUIRIES" && set.selectedInquiry ? "INQUIRY" : null;
}

export function worldStateOf(
  coverage: readonly ChannelCoverageRow[] | null,
  conversation: { readonly workingSet: WorkingSetView | null; readonly activeTask?: ActiveTask | null },
): WorldState {
  return {
    readiness: sellerReadinessOf(coverage),
    anchor: anchorOf(conversation.workingSet),
    activeTask: conversation.activeTask ?? null,
    coverage,
  };
}

/**
 * <b>The one closed token the PLANNER is told about this seller.</b>
 *
 * The audit measured why it has to exist: for 「뭐부터 하면 되냐고」 the plan for an organisation with
 * ZERO connected channels and the plan for one with three were the same shape — needs, specialists and
 * tools within one of each other — because nothing distinguished them on the wire. A planner that cannot
 * see the difference cannot design a different investigation, and the whole cost of that plan was spent
 * finding out that three empty reads were empty.
 *
 * <b>What travels is a single enum value and nothing else.</b> No channel name, no count, no id, no row,
 * no customer word — the same closed-vocabulary shape as `직전 작업 집합`, which is what the payload floor
 * of `POST /api/agent/plan` already permits ({@code AgentPlanPayloadFloorTest} asserts it on the
 * serialized bytes). `UNKNOWN` sends nothing: a state we failed to read is not a state to assert.
 *
 * <b>Nothing downstream depends on the planner honouring it.</b> The answer for a seller who has
 * connected nothing is decided by the procedure layer from this same world, whatever the plan says. This
 * line is an economy, never a correctness path — which is also why it carries no instruction: the prompt
 * belongs to the backend and a caller that writes instructions into `priorContext` is a second prompt.
 */
export function worldTokenFor(world: WorldState): string | null {
  return world.readiness.kind === "UNKNOWN" ? null : `판매자 상태: ${world.readiness.kind}`;
}
