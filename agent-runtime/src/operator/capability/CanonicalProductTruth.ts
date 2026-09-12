/**
 * <b>The Canonical Product Source becomes the authority for what the PRODUCT does.</b>
 *
 * Until now every product sentence was re-derived, on the turn that asked, from whatever the code, the
 * registries and this deployment's switches happened to say — and that is how a live-proven Cafe24
 * review path came back as 「구체 절차는 모른다」 in an environment whose connector was off, and how a QA
 * publish flag being off was rendered as a product specification. The ledger under
 * `backend/src/main/resources/product-truth/` is the answer to that: 83 items a person read and
 * approved, loaded here through one read.
 *
 * <b>What this file is, and what it deliberately is not.</b> It is a SELECTOR and a RENDERER. It picks
 * which reviewed items a turn may stand on and turns them into Korean lines. It decides nothing about
 * the answer — the model writes that — and it computes no capability of its own.
 *
 * <b>Selection reads closed tokens, never the seller's words.</b> The signals are the planner's own
 * {@code capabilityAspect}, the channel token it resolved, and the conversation's focus. There is no
 * Korean word list here, and {@code semanticOwnership.test.ts} forbids one in a module downstream of
 * the planner for exactly the reason it would fail here: a word table that guesses the category would
 * be a second planner, and it would guess wrong silently. Where the signal is absent the selection
 * WIDENS — an unrecognised product question gets the narrative, the features, the invariants and both
 * future layers — because the failure direction of a selector must be "too much context", never
 * "answered a narrower question than the one asked".
 *
 * <b>Evidence is carried and never spoken.</b> {@code LIVE_PROVEN} and {@code IMPLEMENTED} are our
 * words; what a seller needs is the Korean sentence the ledger already writes — 「실제 몰에 댓글을
 * 게시한 적이 없습니다」. So an item whose evidence is below LIVE_PROVEN and whose limitations do not
 * say so is DROPPED rather than sent: {@link admits}. The enum itself never reaches a fact line, and a
 * test asserts that on the rendered text.
 *
 * <b>The ledger is not the runtime.</b> Nothing here reads a flag, a connection or a schedule. Those
 * are the overlay, they are composed beside these lines by `ProductFactSheet`, and neither layer
 * overwrites the other.
 */
import type {
  CanonicalCapability, CanonicalFeature, CanonicalProductTruth, CanonicalRoadmapItem,
  CanonicalSubtype,
} from "../../spring/types";
import { INTERNAL_PATTERNS, INTERNAL_WORD } from "../../conversation/groundedAnswer";
import type { CapabilityAspect } from "./ProductSelfKnowledge";
import type { OperatingObject } from "./ProductTruth";
import { OBJECT_WORD } from "./ProductTruth";

/** The five kinds of knowledge the ledger holds, as the selector's own closed vocabulary. */
export type KnowledgeCategory =
  | "CAPABILITY"
  | "FEATURE"
  | "INVARIANT"
  | "NARRATIVE"
  | "DIRECTION"
  | "ROADMAP";

/** How much of a channel's rows a turn gets. */
export type CapabilityDepth = "NONE" | "SUMMARY" | "DETAIL";

/**
 * <b>The planner's capability aspect — the type itself, not a copy of its spelling.</b>
 *
 * It used to be a second union written out here, and the two drifted the day they were written: this
 * file said {@code OVERVIEW} where the planner says {@code PRODUCT_OVERVIEW}, so every 「뭘 할 수
 * 있어?」 missed its own branch and fell to the default — the widest selection in the file. A mirrored
 * vocabulary is a copy, and this one went stale before it shipped, so there is no mirror any more and a
 * new planner token is a compile error here until this file says what to do with it.
 *
 * `null` is not another value — it is every product question that is not one of these, which is the
 * majority and the reason this lane exists.
 */
export type CapabilityAspectToken = CapabilityAspect;

export interface CanonicalSelection {
  readonly aspect: CapabilityAspectToken | null;
  /** Closed channel token, or null when the sentence named none. */
  readonly channel: string | null;
  /** The object this thread is standing on, when it is standing on one. */
  readonly focusObject: OperatingObject | null;
}

export interface SelectionPlan {
  readonly categories: readonly KnowledgeCategory[];
  readonly capabilityDepth: CapabilityDepth;
  /** Only these channels' rows, or null for every channel in the ledger. */
  readonly channel: string | null;
  readonly focusObject: OperatingObject | null;
  /**
   * <b>Which items of a chosen layer may travel, for the layers narrow enough to say.</b>
   *
   * A category absent from this map is unrestricted — which is the important direction: a roadmap item
   * added next month travels to the question about roadmaps without anyone remembering to list it, and
   * only the layers that were deliberately narrowed stay narrow. A category present is answered by
   * exactly the named reviewed items: 「판매자센터랑 뭐가 달라?」 stands on the narrative written to
   * answer it, not on nine invariants and eight features sent in case one of them helps.
   *
   * The entries are ledger ids — closed tokens, the same ones the trace logs — so this stays a
   * selection over identifiers and never becomes a second reader of the seller's sentence. An id that
   * has left the ledger selects nothing, and a test pins that every id named here exists.
   */
  readonly onlyIds: Readonly<Partial<Record<KnowledgeCategory, readonly string[]>>> | null;
  /**
   * The capability axes a summary keeps, when the question is about one of them. `null` keeps the
   * depth's own default. 「지금 자동으로 가져오고 있어?」 is a question about ACQUISITION, and sending
   * 「답변 보내기」 rows beside it is how a state question got answered with a capability catalogue.
   */
  readonly capabilityAxes: readonly string[] | null;
  /**
   * <b>Whether this deployment's live state belongs in the answer.</b>
   *
   * Almost always yes — a capability that is built and a capability that is switched on here are
   * different sentences, and the overlay is what keeps them apart. The exception is a question that is
   * not about now: 「판매자센터랑 뭐가 달라?」 answered with 「지금 이 환경에서는 초안까지만…」 has
   * finished with a fact about this QA host rather than about the product, and 「앞으로 뭐 할 거야?」 has
   * the same shape. Those two ask what the product IS and what it WILL BE; neither asks what it is
   * doing at this moment.
   */
  readonly runtimeOverlay: boolean;
}

/** One selected fact: the ledger id it came from, its category, and the line the model reads. */
export interface CanonicalFact {
  readonly id: string;
  readonly category: KnowledgeCategory;
  readonly text: string;
}

const AXIS_WORD: Readonly<Record<string, string>> = {
  ACQUISITION: "가져오기",
  READ: "읽기",
  DRAFT: "답변 초안",
  EXECUTION: "답변 보내기",
};

/** The axes a summary keeps. The two a channel actually differs on; READ and DRAFT follow from them. */
const SUMMARY_AXES: ReadonlySet<string> = new Set(["ACQUISITION", "EXECUTION"]);

/** Evidence strong enough to need no spoken caveat. Everything weaker must carry its own. */
const PROVEN = "LIVE_PROVEN";

/**
 * <b>Which kinds of knowledge this turn may stand on.</b>
 *
 * Read the table as the answer to "what did the planner tell us about the question". A named channel
 * with a channel aspect is the one case narrow enough to send a channel's own rows in full; the
 * connection aspects need acquisition and connection state and nothing about drafting; and a question
 * the planner could not place gets everything that is not per-channel detail, because guessing which
 * of six categories a seller meant is exactly the failure this selection must not have.
 */
export function planSelection(selection: CanonicalSelection): SelectionPlan {
  const { aspect, channel, focusObject } = selection;
  switch (aspect) {
    case "CHANNEL_ACTION":
      return {
        categories: ["CAPABILITY", "INVARIANT"],
        capabilityDepth: channel ? "DETAIL" : "SUMMARY",
        channel, focusObject, onlyIds: null, capabilityAxes: null, runtimeOverlay: true,
      };
    case "AFTER_CONNECT":
      return {
        categories: ["CAPABILITY", "FEATURE", "INVARIANT"],
        capabilityDepth: channel ? "DETAIL" : "SUMMARY",
        channel, focusObject, onlyIds: null, capabilityAxes: null, runtimeOverlay: true,
      };
    case "SUPPORTED_CHANNELS":
    case "HOW_TO_CONNECT":
      // <b>The file path is part of the answer to 「어떻게 넣어?」.</b> It used to be missing: this plan
      // takes no FEATURE layer, so 「파일로 올릴 수도 있어?」 was answered from the channel rows alone and
      // could only speak about the objects those rows happen to mention. The feature row is the ledger's
      // own statement of which objects a file may carry, and one named item is the whole addition.
      return {
        categories: ["CAPABILITY", "FEATURE", "INVARIANT"], capabilityDepth: "SUMMARY",
        channel, focusObject: null, onlyIds: { FEATURE: ["FEATURE.MANUAL_FILE_ACQUISITION"] },
        capabilityAxes: null, runtimeOverlay: true,
      };
    case "PRODUCT_OVERVIEW":
      return {
        categories: ["NARRATIVE", "FEATURE", "INVARIANT", "CAPABILITY"],
        capabilityDepth: "SUMMARY", channel: null, focusObject: null, onlyIds: null,
        capabilityAxes: null, runtimeOverlay: true,
      };
    case "PRODUCT_DIFFERENCE":
      // <b>The question is answered by the narrative written to answer it.</b> Sending the channel grid
      // as well does not make the answer more complete — it makes it a different answer, because a
      // seller asking how this differs from their seller center is not asking which axis Coupang
      // supports. What stands beside the narrative is the small set that keeps the difference honest:
      // the features that ARE the difference (the company's own basis, repeated problems, the report,
      // what gets prepared before it is asked for) and the two invariants that stop it becoming a
      // brochure — what this works on at all, and that a person still approves.
      return {
        categories: ["NARRATIVE", "FEATURE", "INVARIANT"], capabilityDepth: "NONE",
        channel: null, focusObject: null, onlyIds: DIFFERENCE_ITEMS,
        capabilityAxes: null, runtimeOverlay: false,
      };
    case "FUTURE_DIRECTION":
      // The two layers that are ABOUT what does not exist yet, and one current-truth line so the answer
      // can say what today is without listing it: `INVARIANT.OPERATING_OBJECTS` is the ledger's own
      // sentence for what the product operates on now. The roadmap items carry their own qualifiers, so
      // nothing here needs the capability grid to keep a plan from reading as a feature.
      return {
        categories: ["DIRECTION", "ROADMAP", "INVARIANT"], capabilityDepth: "NONE",
        channel: null, focusObject: null, onlyIds: FUTURE_ITEMS,
        capabilityAxes: null, runtimeOverlay: false,
      };
    case "COLLECTION_STATE":
      // <b>A question about NOW, answered mostly by the overlay.</b> What the ledger contributes is the
      // one line that keeps the two apart — a capability that exists is not a capability that is
      // running — and the acquisition rows, so the answer can say which channels could be collected
      // automatically at all. Nothing about drafting or sending belongs in it.
      return {
        categories: ["CAPABILITY", "INVARIANT"], capabilityDepth: "SUMMARY",
        channel, focusObject: null,
        onlyIds: { INVARIANT: ["INVARIANT.CAPABILITY_VS_STATE", "INVARIANT.ABSENCE"] },
        capabilityAxes: ["ACQUISITION"], runtimeOverlay: true,
      };
    case "DAILY_OPERATION":
      // 「매일 들어와야 해?」 is answered by the loop this product is built around, by what it prepares
      // before it is asked to, and by whether that is switched on here — not by this seller's inquiry
      // count, which is what the question came back with.
      return {
        categories: ["NARRATIVE", "FEATURE", "CAPABILITY", "INVARIANT"], capabilityDepth: "SUMMARY",
        channel: null, focusObject: null, onlyIds: DAILY_ITEMS,
        capabilityAxes: ["ACQUISITION"], runtimeOverlay: true,
      };
    case "TEAM_ACCESS":
      // Answered by one feature and the roadmap item that says what does not exist yet. The channel
      // grid has nothing to do with whether two people can share a login, and neither does the rest of
      // the product tour — sending them is how this question came back at 79 lines.
      return {
        categories: ["FEATURE", "ROADMAP", "INVARIANT"], capabilityDepth: "NONE",
        channel: null, focusObject: null, onlyIds: TEAM_ITEMS,
        capabilityAxes: null, runtimeOverlay: false,
      };
    case "SECURITY_AND_DATA":
      // The four reviewed items that can be checked, and the invariant whose whole job is to stop the
      // answer widening past them into backups, retention and deletion.
      return {
        categories: ["FEATURE", "INVARIANT"], capabilityDepth: "NONE",
        channel: null, focusObject: null, onlyIds: SECURITY_ITEMS,
        capabilityAxes: null, runtimeOverlay: false,
      };
    default:
      // Everything else a seller can ask about the product. Both future layers are here on purpose: a
      // question the planner could not place is one we know nothing about, and answering it from the
      // current-truth layers alone would be answering a narrower question than the one asked.
      return {
        categories: ["NARRATIVE", "FEATURE", "INVARIANT", "DIRECTION", "ROADMAP", "CAPABILITY"],
        capabilityDepth: "SUMMARY", channel, focusObject, onlyIds: null,
        capabilityAxes: null, runtimeOverlay: true,
      };
  }
}

/**
 * The reviewed items a 「무엇이 다른가」 answer stands on. Ids, not words — and each one is here because
 * it answers that question, not because it might.
 */
const DIFFERENCE_ITEMS: SelectionPlan["onlyIds"] = {
  NARRATIVE: ["NARRATIVE.SELLER_CENTER_DIFFERENCE", "NARRATIVE.WHAT_IT_IS"],
  // What the difference actually IS: the company's own basis under an answer, the repeated problem
  // nobody had time to notice, the report, and work prepared before it is asked for.
  FEATURE: ["FEATURE.KNOWLEDGE", "FEATURE.IMPROVEMENT_OPPORTUNITY", "FEATURE.PROACTIVE_OPERATIONS",
            "FEATURE.REPORTING"],
  // The two that keep a difference answer from becoming a brochure: what this works on at all, and
  // that a person still approves what reaches a customer.
  INVARIANT: ["INVARIANT.OPERATING_OBJECTS", "INVARIANT.APPROVAL_BOUNDARY"],
};

/**
 * The 「앞으로」 answer: DIRECTION and ROADMAP whole — they are the answer, and a new item must not need
 * an edit here to be included — plus the one current-truth line that lets the answer say what today is
 * without listing today.
 */
const FUTURE_ITEMS: SelectionPlan["onlyIds"] = {
  INVARIANT: ["INVARIANT.OPERATING_OBJECTS"],
};

/**
 * 「직원이랑 같이 써도 돼?」: what an account IS today, what has not been built, and the boundary that
 * says what the answer may not become.
 */
const TEAM_ITEMS: SelectionPlan["onlyIds"] = {
  FEATURE: ["FEATURE.ACCOUNT_AND_ORGANIZATION"],
  ROADMAP: ["ROADMAP.TEAM_ACCESS"],
  INVARIANT: ["INVARIANT.ORG_ISOLATION"],
};

/**
 * 「우리 회사 자료는 안전하게 관리돼?」: the three things that can be checked, and the one that says
 * everything else is a deployment fact rather than a product promise. Without that last item the
 * answer drifts into backups and retention, which is the failure this question is most exposed to.
 */
const SECURITY_ITEMS: SelectionPlan["onlyIds"] = {
  FEATURE: ["FEATURE.CHANNEL_CREDENTIAL_STORAGE", "FEATURE.HELPER_DEVICE_ACCESS",
            "FEATURE.ACCOUNT_AND_ORGANIZATION"],
  INVARIANT: ["INVARIANT.ORG_ISOLATION", "INVARIANT.SECURITY_CLAIM_LIMIT", "INVARIANT.DATA_BOUNDARY"],
};

/**
 * 「어떻게 쓰게 되는가」: the daily loop, the work prepared before it is asked for, and the two lines
 * that say where the person still stands and that being built is not being switched on.
 */
const DAILY_ITEMS: SelectionPlan["onlyIds"] = {
  NARRATIVE: ["NARRATIVE.DAILY_LOOP", "NARRATIVE.TARGET_SELLER"],
  FEATURE: ["FEATURE.PROACTIVE_OPERATIONS", "FEATURE.IMPROVEMENT_OPPORTUNITY", "FEATURE.REPORTING"],
  INVARIANT: ["INVARIANT.APPROVAL_BOUNDARY", "INVARIANT.CAPABILITY_VS_STATE"],
};

/**
 * <b>The reviewed items this turn may stand on, as Korean lines.</b>
 *
 * @param names the seller-facing channel names this deployment offers, keyed by code — read from the
 *     coverage snapshot the turn already holds, so a canonical row and a connection line cannot call
 *     one channel two things.
 */
export function selectCanonicalFacts(
  ledger: CanonicalProductTruth, plan: SelectionPlan, names: Readonly<Record<string, string>>,
): CanonicalFact[] {
  const out: CanonicalFact[] = [];
  const has = (c: KnowledgeCategory) => plan.categories.includes(c);
  // A category the plan did not narrow keeps every item; a category it named keeps exactly those.
  const wants = (c: KnowledgeCategory, id: string) => {
    const only = plan.onlyIds?.[c];
    return only == null || only.includes(id);
  };

  if (has("NARRATIVE")) {
    for (const n of ledger.narratives) {
      if (!wants("NARRATIVE", n.id)) continue;
      out.push(...assemble(n.id, "NARRATIVE", `${n.title} —`, [{ prefix: "", items: [n.body] }]));
    }
  }
  if (has("FEATURE")) {
    for (const f of ledger.features) {
      if (!wants("FEATURE", f.id)) continue;
      if (!admits(f.status, f.evidence, f.limitations)) continue;
      out.push(...assemble(f.id, "FEATURE", `${f.title} —`, [
        { prefix: "", items: f.sellerFacingNotes },
        limits(f.limitations),
      ]));
    }
  }
  if (has("INVARIANT")) {
    for (const i of ledger.invariants) {
      if (!wants("INVARIANT", i.id)) continue;
      // <b>An invariant's `notThis` is written for two readers and only one of them is here.</b> Some
      // lines are Korean guardrails a seller-facing sentence genuinely needs (「이 네 가지밖에 하지
      // 않는다고 말하지 마라」); others name our own enum values, because whoever wrote them was
      // talking to whoever edits the ledger. The second kind is dropped rather than the whole list:
      // see {@link sellerSafe}.
      out.push(...assemble(i.id, "INVARIANT", `${i.title} —`, [
        { prefix: "", items: [i.body] },
        { prefix: "주의:", items: sellerSafe(i.notThis) },
      ]));
    }
  }
  if (has("CAPABILITY") && plan.capabilityDepth !== "NONE") {
    out.push(...capabilityFacts(ledger.capabilities, plan, names));
  }
  if (has("DIRECTION")) {
    for (const d of ledger.directions) {
      if (!wants("DIRECTION", d.id)) continue;
      out.push(...assemble(d.id, "DIRECTION",
        `제품 방향(이미 정한 방식이고, 지금 되는 기능에 대한 설명이 아닙니다) — ${d.title}:`,
        [{ prefix: "", items: [d.body] }]));
    }
  }
  if (has("ROADMAP")) {
    for (const r of ledger.roadmap) {
      if (!wants("ROADMAP", r.id)) continue;
      out.push(...roadmap(r));
    }
  }
  return out;
}

/* ─────────────────────────────── rendering ─────────────────────────────── */

/**
 * <b>The longest one fact line may be, and why this file has to know it.</b>
 *
 * The backend's request floor caps a single fact at {@code ConverseRequestFloor.MAX_FACT_LENGTH}, and a
 * single over-long line refuses the WHOLE request — so seven reviewed rows pushed every product question
 * onto the deterministic fallback, which is the one failure mode this wiring exists to remove.
 *
 * <b>The answer is a clause boundary, never a truncation.</b> A reviewed sentence is a person's approved
 * wording; cutting one would make this file the author of a claim nobody read. So a long item is emitted
 * as SEVERAL facts split where its own meaning already divides — the capability, then its limitations,
 * then its preconditions — and every part repeats the subject and its clause marker so each stands alone
 * and none of them can be read as belonging to a different row. The ledger id is the same on every part,
 * which is what keeps the trace answering "which reviewed item did this turn stand on".
 *
 * The number is duplicated from the backend on purpose and fenced by a test that sends these exact lines
 * through the real floor ({@code ProductTruthConverseFloorTest}), so the copy cannot rot silently.
 */
const MAX_FACT_CHARS = 400;

/**
 * Clauses that arrive under one marker — 「다만」 for limitations, 「실행하려면:」 for preconditions. The
 * marker is repeated whenever a split opens a new part, because a bare limitation on its own line reads
 * as a capability.
 */
interface ClauseGroup {
  readonly prefix: string;
  readonly items: readonly string[];
}

/**
 * One ledger item as one fact — or as the fewest facts that each fit the floor.
 *
 * Splitting happens only where a line would not fit; an item that fits is byte-identical to what this
 * renderer produced before, which is what makes the change checkable against the recorded payloads.
 */
function assemble(
  id: string, category: KnowledgeCategory, lead: string, groups: readonly ClauseGroup[],
): CanonicalFact[] {
  const head = collapse(lead);
  const parts: string[][] = [];
  let current: string[] = [];
  let length = head.length;
  let openPrefix = "";
  const room = (piece: string) => length + 1 + piece.length <= MAX_FACT_CHARS;

  for (const group of groups) {
    for (const raw of group.items) {
      const clause = collapse(raw);
      if (clause.length === 0) continue;
      const marked = group.prefix && group.prefix !== openPrefix ? `${group.prefix} ${clause}` : clause;
      if (current.length > 0 && !room(marked)) {
        parts.push(current);
        current = [];
        length = head.length;
        openPrefix = "";
        // The new part opens with this group's marker again, whether or not the old part had emitted it.
        const reopened = group.prefix ? `${group.prefix} ${clause}` : clause;
        current.push(reopened);
        length += 1 + reopened.length;
        openPrefix = group.prefix;
        continue;
      }
      current.push(marked);
      length += 1 + marked.length;
      openPrefix = group.prefix;
    }
  }
  if (current.length > 0) parts.push(current);
  if (parts.length === 0) return [{ id, category, text: head }];
  return parts.map((clauses) => ({ id, category, text: `${head} ${clauses.join(" ")}` }));
}

/** Limitations that may be spoken, as their own clause group. */
function limits(limitations: readonly string[]): ClauseGroup {
  return { prefix: "다만", items: sellerSafe(limitations) };
}

function capabilityFacts(
  rows: readonly CanonicalCapability[], plan: SelectionPlan, names: Readonly<Record<string, string>>,
): CanonicalFact[] {
  const out: CanonicalFact[] = [];
  const only = plan.onlyIds?.CAPABILITY;
  const byChannel = plan.channel ? rows.filter((r) => r.channel === plan.channel!.toUpperCase()) : rows;
  const wanted = only == null ? byChannel : byChannel.filter((r) => only.includes(r.id));
  for (const row of wanted) {
    if (plan.capabilityAxes != null) {
      // The question named an axis. The rest of the grid is not a smaller answer, it is another one:
      // 「지금 자동으로 가져오고 있어?」 asks about ACQUISITION, and 「답변 보내기」 rows beside it are how
      // a state question was answered with a capability catalogue.
      if (!plan.capabilityAxes.includes(row.axis)) continue;
    } else if (plan.capabilityDepth === "SUMMARY") {
      // A summary keeps the two axes a channel differs on — unless the thread is standing on an
      // object, in which case that object gets all four and the rest keep the two.
      const inFocus = plan.focusObject != null && row.object === plan.focusObject;
      if (!inFocus && !SUMMARY_AXES.has(row.axis)) continue;
    }
    if (!admits(row.status, row.evidence, row.limitations)) continue;
    out.push(...capabilityFact(row, names));
    // <b>A subtype is not detail to be dropped — it is the answer.</b> NAVER 문의 is PARTIAL precisely
    // because 톡톡 has no path, and a summary that kept only the parent line would be the
    // over-generalisation the ledger's own validator refuses to let anyone write.
    for (const s of row.subtypes) {
      if (!admits(s.status, s.evidence, s.limitations)) continue;
      out.push(...subtypeFact(row, s, names));
    }
  }
  return out;
}

function capabilityFact(
  row: CanonicalCapability, names: Readonly<Record<string, string>>,
): CanonicalFact[] {
  const head = `${channelName(row.channel, names)} ${objectWord(row.object)} ${AXIS_WORD[row.axis] ?? row.axis}`;
  return assemble(row.id, "CAPABILITY", `${head} —`, [
    { prefix: "", items: row.sellerFacingNotes },
    limits(row.limitations),
    // The preconditions, as their own clause. They are not limitations — a limitation says what may
    // never be claimed, and these say what has to be true before a path that DOES exist can run.
    { prefix: "실행하려면:", items: row.requirements.map((r) => r.description) },
  ]);
}

function subtypeFact(
  row: CanonicalCapability, s: CanonicalSubtype, names: Readonly<Record<string, string>>,
): CanonicalFact[] {
  const head = `${channelName(row.channel, names)} ${objectWord(row.object)}`
    + ` 가운데 ${s.label} ${AXIS_WORD[row.axis] ?? row.axis}`;
  return assemble(s.id, "CAPABILITY", `${head} —`, [
    { prefix: "", items: s.sellerFacingNotes },
    limits(s.limitations),
  ]);
}

function roadmap(r: CanonicalRoadmapItem): CanonicalFact[] {
  // The hedge travels with the item, always, and it is the ledger's own sentence rather than one
  // written here — a roadmap line that arrives without it is how a direction gets read as a feature.
  // It sits in the LEAD rather than in a clause, so a split repeats it on every part.
  return assemble(r.id, "ROADMAP", `앞으로의 방향(현재 제공되는 기능이 아닙니다) — ${r.title}:`,
    [{ prefix: "", items: [r.summary, r.qualifier] }]);
}

/**
 * <b>An item whose strength is not also stated in Korean does not travel.</b>
 *
 * The ledger says a Cafe24 review comment is `IMPLEMENTED`, and it also says 「실제 몰에 댓글을 게시한
 * 적이 없습니다」. The first is ours and the second is the seller's; sending the capability without the
 * caveat would let an implemented path be answered as a proven one, which is the single way this wiring
 * could make the product overclaim. So the caveat is the admission ticket, and the enum never travels.
 *
 * Only a row that CLAIMS a path needs one. 「그 기능은 없습니다」 is already the whole caveat, and asking
 * a refusal to qualify itself would drop honest rows for no gain.
 */
function admits(status: string, evidence: string, limitations: readonly string[]): boolean {
  if (status !== "SUPPORTED" && status !== "PARTIAL") return true;
  return evidence === PROVEN || limitations.length > 0;
}

/**
 * <b>A line this product would refuse to PRINT is a line it should not READ either.</b>
 *
 * The check is the output guard's own patterns, applied to the input. A fact carrying
 * {@code PREPARE_ONLY} would be rejected on the way out if the model echoed it — so putting it on the
 * way in either wastes a turn or teaches the model a word it must not use, and neither is worth the
 * sentence. Dropping is per LINE: a capability row whose second limitation is engineer-facing keeps
 * its first.
 */
function sellerSafe(lines: readonly string[]): string[] {
  return lines.filter((l) => !INTERNAL_PATTERNS.some((p) => p.test(l)) && !INTERNAL_WORD.test(l));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function channelName(code: string, names: Readonly<Record<string, string>>): string {
  return names[code.toUpperCase()] ?? code;
}

function objectWord(object: string): string {
  return OBJECT_WORD[object as OperatingObject] ?? object;
}
