/**
 * <b>What reviewnary itself is — as facts this deployment can prove, not a brochure.</b>
 *
 * <b>The defect this closes.</b> Measured live on a clean seller (2026-09-07). Three sentences, one
 * conversation:
 *
 * <ul>
 *   <li>「지원하는 이커머스 종류가 뭐가 있지?」 → 「어느 채널에 대한 질문인지 알려주세요 (네이버 · 쿠팡 ·
 *       카페24)」 — a question about which channels exist, answered by asking the seller to name one,
 *       with the answer inside the parenthesis of the refusal.</li>
 *   <li>「연동하고 나면 어떻게 가능한거지?」 → the four-domain card.</li>
 *   <li>「연동하고 나면 뭐가 되냐고」 → 「판매 채널을 연결하는 것부터 하시면 됩니다」.</li>
 * </ul>
 *
 * <b>The trace says it is not the planner.</b> All six sentences of the QA set plan as
 * `EXPLAIN_CAPABILITY` and the planner reads them correctly. What it could not do is say WHICH
 * capability question this is — the axis did not exist — so four of the six arrived with
 * `informationNeeds: []`, and the runtime's proxy for 「이건 우리 자신에 대한 질문이다」 was exactly
 * `informationNeeds.length === 0`. Under that proxy every distinct question about the product
 * collapses onto two fixed answers (the card, then the getting-started card), and a question that the
 * planner had annotated with a need was pushed into the CHANNEL lane and answered with a question.
 *
 * <b>What this file is.</b> The one factual source for questions whose subject is the product. Its
 * inputs are the sources of truth that already exist, and it duplicates none of them:
 *
 * <ul>
 *   <li>what work it does ⇒ {@link capabilityDomains} over the REGISTERED tool catalogue;</li>
 *   <li>the write boundary ⇒ {@link boundarySentence} over the catalogue's own action classes;</li>
 *   <li>which channels, and what each offers ⇒ the turn's `GET /api/channels/coverage` snapshot that
 *       {@link WorldState} already carries — zero extra reads;</li>
 *   <li>what a channel can actually DO ⇒ the same pure resolver every execution path uses
 *       ({@link capabilityOf}) over the same backend reads, which are CHANNEL-keyed and therefore
 *       answerable before anything is connected;</li>
 *   <li>the daily loop ⇒ the {@link ProcedureId} records, named by the procedures that exist.</li>
 * </ul>
 *
 * <b>What it must never become.</b> A written-down feature list, or a reply keyed to an example
 * sentence. Nothing here reads the seller's words: which aspect is being asked is
 * {@link PlanFilters.capabilityAspect}, a closed token the LLM planner fills, and this file turns that
 * token plus real reads into sentences. Add a channel to the coverage table and the answer gains it;
 * turn a capability off in the deployment and the answer loses it, in the same breath as the execution
 * path that would have refused.
 *
 * <b>NO_CHANNEL is about the seller's data, not about us.</b> A shop with nothing connected can still
 * be told what this product is, which channels it supports and what each one will do once connected —
 * every fact above is a fact about the deployment. Only the sentences that describe THIS shop's rows
 * are withheld, and they are the ones {@link SellerReadiness} already gates.
 */
import type { ChannelCoverageRow } from "../../spring/types";
import type { ActionClass } from "../state/OperatorState";
import type { ChannelCapabilitySources, ChannelCapabilityVerdict } from "./ChannelCapability";
import { EXECUTION_REASON, capabilityOf, inquiryExecutionOf } from "./ChannelCapability";
import { capabilityDomains, boundarySentence, CONNECT_ACTION } from "./AssistantCapability";
import type { SellerReadiness } from "./SellerReadiness";
import { delegableWords } from "./SellerReadiness";
import { withObject, withSubject } from "../../korean";

/**
 * <b>Which question about the product this is.</b> A closed token, chosen by the planner.
 *
 * Five, because five different questions were measured and each wants different FACTS — not because
 * five phrasings were collected. `null` is not a sixth value: the caller resolves it from what the
 * plan already carries (a named channel ⇒ CHANNEL_ACTION, otherwise PRODUCT_OVERVIEW), so a backend
 * that predates the field produces byte-identical answers for the shapes that worked before it.
 */
export type CapabilityAspect =
  /** 제품이 무엇이고 무엇을 대신 하는가 — 「뭘 할 수 있어?」 */
  | "PRODUCT_OVERVIEW"
  /** 어떤 판매 채널을 지원하는가 — 「지원하는 이커머스 종류가 뭐가 있지?」 */
  | "SUPPORTED_CHANNELS"
  /** 연결한 뒤 무엇이 일어나는가 — 「연동하고 나면 뭐가 되냐고」 */
  | "AFTER_CONNECT"
  /** 채널·행동별로 어디까지 되는가 — 「쿠팡은 어디까지 가능해?」·「리뷰 답글도 자동으로 보내?」 */
  | "CHANNEL_ACTION"
  /** 어떻게 시작하는가 — 「어떻게 시작해?」 */
  | "HOW_TO_CONNECT";

export const CAPABILITY_ASPECTS: readonly CapabilityAspect[] =
  ["PRODUCT_OVERVIEW", "SUPPORTED_CHANNELS", "AFTER_CONNECT", "CHANNEL_ACTION", "HOW_TO_CONNECT"];

export function capabilityAspectOf(value: string | null | undefined): CapabilityAspect | null {
  return CAPABILITY_ASPECTS.find((a) => a === value) ?? null;
}

/**
 * <b>What the aspect is when the plan did not carry one — the pre-field behaviour, exactly.</b>
 *
 * A backend older than `agent-plan-prompt/v17` sends no aspect, and this deployment is not the only
 * one: an answer that silently changed for those callers would be a second product, not a fallback.
 * The three branches are the three the runtime already had — a named channel was a channel question,
 * a repeat while nothing is connected was 「어떻게 시작해?」, and everything else was the overview card.
 *
 * With the field present this function does not run, which is the point: the planner is reading the
 * sentence, and the runtime is not guessing from conversation shape.
 */
export function fallbackAspect(
  channelNamed: boolean, overviewAlreadyDrawn: boolean, readiness: SellerReadiness,
): CapabilityAspect {
  if (channelNamed) return "CHANNEL_ACTION";
  if (overviewAlreadyDrawn && readiness.kind === "NO_CHANNEL") return "HOW_TO_CONNECT";
  return "PRODUCT_OVERVIEW";
}

/** One product answer: a short headline, the items behind it, and the one next move when there is one. */
export interface SelfAnswer {
  readonly headline: string;
  readonly lines: readonly string[];
  readonly chips: readonly string[];
  readonly link?: { readonly label: string; readonly to: string };
}

/* ─────────────────────────── channels, from the coverage snapshot ─────────────────────────── */

const WORK_WORD: Readonly<Record<string, string>> = { INQUIRY: "문의", REVIEW: "리뷰", ORDER_SUMMARY: "주문" };

export interface ChannelOffer {
  readonly code: string;
  readonly name: string;
  readonly connected: boolean;
  /** The seller-facing names of the data types THIS channel declares — never a written list. */
  readonly works: readonly string[];
}

/**
 * Which channels this deployment can work with, and what each one offers.
 *
 * The rows are the turn's own coverage snapshot, so this costs nothing and cannot disagree with the
 * connection screen. A channel with no offered type is still listed: 「지원한다」 and 「이 채널에서 리뷰를
 * 가져올 수 있다」 are different claims and the second is per-type.
 */
export function channelOffers(coverage: readonly ChannelCoverageRow[] | null): readonly ChannelOffer[] {
  if (!coverage || coverage.length === 0) return [];
  const byCode = new Map<string, { name: string; connected: boolean; works: string[] }>();
  for (const row of coverage) {
    const code = row.channelCode.toUpperCase();
    const entry = byCode.get(code)
      ?? { name: row.channelNameKo ?? row.channelCode, connected: false, works: [] };
    if (row.connected) entry.connected = true;
    const word = WORK_WORD[row.dataType.toUpperCase()];
    if (row.supported && word && !entry.works.includes(word)) entry.works.push(word);
    byCode.set(code, entry);
  }
  return [...byCode.entries()].map(([code, e]) => ({ code, name: e.name, connected: e.connected, works: e.works }));
}

/* ─────────────────────────────── the five answers ─────────────────────────────── */

export interface SelfKnowledgeInputs {
  readonly registeredTools: readonly string[];
  readonly actionClasses: readonly ActionClass[];
  readonly readiness: SellerReadiness;
  readonly coverage: readonly ChannelCoverageRow[] | null;
}

/** 「어떤 채널을 지원해?」 — the deployment's own table, said as channels rather than as a refusal. */
export function supportedChannelsAnswer(input: SelfKnowledgeInputs): SelfAnswer {
  const offers = channelOffers(input.coverage);
  if (offers.length === 0) {
    // An unread coverage table is not proof that nothing is supported. Claim nothing about channels.
    return {
      headline: "지금은 지원 채널 목록을 확인하지 못했습니다.",
      lines: [], chips: [], link: CONNECT_ACTION,
    };
  }
  const names = offers.map((o) => o.name).join(" · ");
  return {
    headline: `${withObject(names)} 지원합니다.`,
    lines: offers.map((o) => {
      const works = o.works.length > 0
        ? `${withObject(o.works.join(" · "))} 가져옵니다`
        : "가져올 수 있는 자료가 아직 없습니다";
      return `${o.name} — ${works}.${o.connected ? " 지금 연결돼 있습니다." : ""}`;
    }),
    chips: [],
    ...(offers.every((o) => !o.connected) ? { link: CONNECT_ACTION } : {}),
  };
}

/**
 * 「연동하고 나면 뭐가 되냐고」 — the data flow and the daily loop, in the order they happen.
 *
 * <b>Not the getting-started card and not the overview card.</b> This is the one question those two
 * were standing in for, and it is the one they answered worst: 「연결부터 하세요」 answers 「어떻게
 * 시작해?」, which is a different sentence. The steps below are the procedures this runtime runs — the
 * loop is described because it exists, and each line names work the tool catalogue can actually do.
 */
export function afterConnectAnswer(
  input: SelfKnowledgeInputs, scoped?: { readonly offer: ChannelOffer; readonly facts: ChannelActionFacts | null },
): SelfAnswer {
  // <b>A named channel narrows this answer rather than being ignored.</b> Live 2026-09-07 the planner
  // read 「네이버 연결하면 정확히 뭘 해줘?」 as AFTER_CONNECT with `channel: NAVER` — which is correct on
  // both axes — and an answer that dropped the channel would describe the loop for a shop that had
  // asked about one store. The words then come from THAT channel's own coverage rows, so a channel
  // with no review path is never promised reviews.
  const words = scoped
    ? (scoped.offer.works.length > 0 ? scoped.offer.works.join(" · ") : null)
    : delegableWords(input.readiness);
  const domains = capabilityDomains(input.registeredTools);
  const offers = scoped ? [scoped.offer.name] : [];
  const has = (short: string) =>
    domains.some((d) => d.short === short) && (!scoped || scoped.offer.works.includes(short) || short === "상품");
  const steps: string[] = [];
  const source = scoped ? scoped.offer.name : "채널";
  steps.push(words
    ? `1. ${source}에서 ${withObject(words)} 정기적으로 가져옵니다 — 판매자님이 매번 누르지 않아도 됩니다.`
    : `1. ${source}에서 자료를 정기적으로 가져옵니다.`);
  if (has("문의")) steps.push("2. 답변이 필요한 문의를 골라, 등록해 두신 기준으로 답변 초안까지 준비해 둡니다.");
  if (has("리뷰")) steps.push(`${steps.length + 1}. 리뷰에서 반복되는 문제를 찾아 모으고, 답글 초안을 준비합니다.`);
  if (has("상품")) steps.push(`${steps.length + 1}. 상품별로 무엇이 쌓이는지, 어떤 답변 기준이 비어 있는지 정리합니다.`);
  steps.push(`${steps.length + 1}. 그날 먼저 하실 일을 여기에 정리해 두고, 물어보시면 근거와 함께 답합니다.`);
  // Where the loop differs per channel — 「가져오기는 자동인가」·「보내기는 되는가」 — the verdicts are
  // the same ones every execution path reads, so the promise here and the refusal there cannot diverge.
  const perChannel = scoped?.facts ? actionLines(scoped.facts) : [];
  return {
    headline: words
      ? `${offers.length > 0 ? `${offers[0]} 연결` : "연결"}하시면 ${withObject(words)} 대신 확인하고, 답변 초안까지 준비해 둡니다.`
      : "연결하시면 판매 자료를 대신 확인하고, 다음에 하실 일까지 준비해 둡니다.",
    lines: [...steps, ...perChannel, boundarySentence(input.actionClasses)],
    chips: [],
    ...(input.readiness.kind === "NO_CHANNEL" ? { link: CONNECT_ACTION } : {}),
  };
}

/* ───────────────────────── what one channel can actually do ───────────────────────── */

export interface ChannelActionFacts {
  readonly code: string;
  readonly name: string;
  /** Whether THIS shop has this channel connected — it decides what an unread verdict means. */
  readonly connected: boolean;
  readonly review: ChannelCapabilityVerdict;
  readonly inquiry: ChannelCapabilityVerdict;
}

/** The sources one channel's verdicts are computed from — all channel-keyed, none needs an account. */
export function channelActionFacts(
  code: string, name: string, sources: ChannelCapabilitySources, connected = false,
): ChannelActionFacts {
  const inquiry = capabilityOf({ channelCode: code, dataType: "INQUIRY", objectKind: "INQUIRY" }, sources);
  return {
    code, name, connected,
    review: capabilityOf({ channelCode: code, dataType: "REVIEW", objectKind: "REVIEW" }, sources),
    inquiry: { ...inquiry, ...acrossSubtypes(code, sources) ?? {} },
  };
}

/**
 * <b>A channel whose source subtypes all agree has an answer, even though no single object was named.</b>
 *
 * {@link inquiryExecutionOf} is per OBJECT and refuses to pick a subtype when a channel has more than
 * one — which is right there: NAVER's 상품문의 and 고객문의 are different endpoints and answering the
 * wrong one sends a reply to a different customer. But this question names no object, and on the live
 * Demo organisation that refusal printed 「지금은 가능한지 확인하지 못했습니다」 for a channel whose two
 * subtypes both carry the same audited transport — an understatement about a capability the record
 * plainly holds.
 *
 * So: one row, or rows that agree, is the channel's answer; rows that disagree stay unknown, and the
 * per-object lane is untouched.
 */
function acrossSubtypes(
  code: string, sources: ChannelCapabilitySources,
): Pick<ChannelCapabilityVerdict, "execution" | "reason" | "reasonKo"> | null {
  const rows = (sources.transports ?? []).filter((r) => r.channelCode.toUpperCase() === code.toUpperCase());
  if (rows.length < 2) return null;
  const verdicts = rows.map((r) => inquiryExecutionOf(code, r.sourceSubtype ?? null, sources));
  const first = verdicts[0]!;
  const agree = verdicts.every((v) => v.execution === first.execution && v.reason === first.reason);
  return agree ? { execution: first.execution, reason: first.reason, reasonKo: first.reasonKo } : null;
}

const ACQUISITION_SENTENCE = (verdict: ChannelCapabilityVerdict): string =>
  verdict.acquisition === "AUTOMATIC"
    ? "자동으로 가져옵니다"
    : verdict.acquisition === "GUIDED_HUMAN_ACTION"
      ? "판매자님이 판매자센터에서 한 번 확인해 주시면 이어서 가져옵니다"
      : "아직 가져올 경로가 없습니다";

/**
 * <b>「확인하지 못했다」 is not 「안 된다」.</b> A review reply verdict is read from the seller's own
 * connected account, so before the first connection the source is absent and the resolver fail-closes
 * to NOT_SUPPORTED with reason `CAPABILITY_UNKNOWN`. Printing that as 「보낼 수 없습니다」 would make the
 * product understate itself to the one seller who is deciding whether to connect — and it would be a
 * claim nobody measured. The two reasons are already distinguished (`reviewDraftPrecondition` splits
 * them for exactly this); this only says them apart.
 */
/**
 * <b>Three refusals, and they are three different sentences.</b>
 *
 * `NOT_SUPPORTED` is one verdict with reasons the seller experiences differently, and collapsing them
 * produced a line that was false for the shop reading it: on the connected Demo organisation
 * 「쿠팡은 어디까지 가능해?」 answered 「연결하신 뒤에 확인해 드릴 수 있습니다」 — to a seller whose 쿠팡
 * has been connected for months, and whose remedy is not connecting anything. The audited transport is
 * `DIRECT_API` and this deployment has execution off; what that seller actually does is copy the draft.
 *
 * So the sentence is chosen by the reason, and 「확인하지 못했다」 says whether connecting would settle
 * it — which is a fact about THIS shop, not about the channel.
 */
const EXECUTION_SENTENCE = (verdict: ChannelCapabilityVerdict, connected: boolean): string =>
  verdict.execution === "API_EXECUTION"
    ? "승인하시면 reviewnary가 채널에 바로 게시하고 결과를 확인합니다"
    : verdict.execution === "GUIDED_BROWSER_EXECUTION"
      ? "reviewnary가 그 자리를 찾아 초안을 채워 두고, 등록 버튼은 판매자님이 누릅니다"
      : verdict.reason === EXECUTION_REASON.CHANNEL_UNSUPPORTED
        ? "이 채널은 외부에서 보내는 길이 없어, 초안을 복사해 판매자센터에 올리시게 됩니다"
        : verdict.reason === EXECUTION_REASON.EXECUTION_DISABLED
          ? "지금은 초안을 복사해 판매자센터에 올리시게 됩니다"
          : connected
            ? "지금은 가능한지 확인하지 못했습니다"
            : "연결하신 뒤에 확인해 드릴 수 있습니다";

/** The four things a seller asks about a channel, in the order the work happens. */
const CAPABILITY_LABELS = ["리뷰 가져오기", "문의 가져오기", "문의 답변 보내기", "리뷰 답글 보내기"] as const;

function sentencesOf(f: ChannelActionFacts): readonly string[] {
  return [
    ACQUISITION_SENTENCE(f.review), ACQUISITION_SENTENCE(f.inquiry),
    EXECUTION_SENTENCE(f.inquiry, f.connected), EXECUTION_SENTENCE(f.review, f.connected),
  ];
}

/**
 * 「쿠팡은 어디까지 가능해?」·「리뷰 답글도 자동으로 보내?」 — the matrix, for the channels asked about.
 *
 * One channel when the sentence named one; every supported channel when it did not, because
 * 「리뷰 답글도 자동으로 보내?」 is a question about all of them and answering for one silently picked
 * would be the same class of defect as answering about the top problem when a named one exists.
 */
/** One channel's four facts. Shared, so AFTER_CONNECT and CHANNEL_ACTION cannot describe it differently. */
export function actionLines(f: ChannelActionFacts): readonly string[] {
  return sentencesOf(f).map((sentence, i) => `${CAPABILITY_LABELS[i]} — ${sentence}.`);
}

/**
 * <b>Across channels, a fact is said once and the channels that share it are named beside it.</b>
 *
 * Measured live 2026-09-07: 「리뷰 답글도 자동으로 보내?」 names no channel, so the honest scope is every
 * channel — and per-channel lines made that twelve rows, ten of which repeated a sentence the seller
 * had already read, with the channel name at the front of each. This is the same rule the review and
 * inquiry lists already apply to a word every row shares (`lib/sharedWord.ts`): group by the FACT.
 * A capability every channel shares names none of them; one that differs names the group it belongs to.
 */
function groupedLines(facts: readonly ChannelActionFacts[]): readonly string[] {
  const out: string[] = [];
  CAPABILITY_LABELS.forEach((label, i) => {
    const bySentence = new Map<string, string[]>();
    for (const f of facts) {
      const sentence = sentencesOf(f)[i]!;
      bySentence.set(sentence, [...(bySentence.get(sentence) ?? []), f.name]);
    }
    for (const [sentence, names] of bySentence) {
      out.push(names.length === facts.length
        ? `${label} — 모든 채널에서 ${sentence}.`
        : `${label} (${names.join(" · ")}) — ${sentence}.`);
    }
  });
  return out;
}

export function channelActionAnswer(facts: readonly ChannelActionFacts[], readiness: SellerReadiness): SelfAnswer {
  if (facts.length === 0) {
    return { headline: "지금은 채널별로 가능한 범위를 확인하지 못했습니다.", lines: [], chips: [] };
  }
  // One channel: the headline already names it, so the lines are the four facts and nothing else.
  const lines = facts.length === 1 ? actionLines(facts[0]!) : groupedLines(facts);
  const one = facts.length === 1 ? facts[0]! : null;
  return {
    headline: one
      ? `${one.name}에서 지금 되는 것과 안 되는 것입니다.`
      : "채널마다 되는 범위가 다릅니다.",
    lines,
    chips: [],
    ...(readiness.kind === "NO_CHANNEL" ? { link: CONNECT_ACTION } : {}),
  };
}

/**
 * 「어떻게 시작해?」 — unchanged in substance from the answer that already existed, moved here so that
 * every product answer has one owner. The local 도우미 stays deliberately absent: it matters for one
 * channel's guided lanes and naming it here puts a program to install in front of a seller who has not
 * chosen a channel yet.
 */
export function howToConnectAnswer(input: SelfKnowledgeInputs): SelfAnswer {
  const words = delegableWords(input.readiness);
  const connectable = input.readiness.connectable;
  return {
    headline: "판매 채널을 연결하는 것부터 하시면 됩니다.",
    lines: [
      ...(connectable.length > 0 ? [`지금 연결할 수 있는 채널은 ${connectable.join(" · ")}입니다.`] : []),
      "연결 화면에서 채널을 고르시면, 그 채널에 필요한 것만 순서대로 안내해 드립니다.",
      words
        ? `연결이 끝나면 ${withObject(words)} 가져와서, 먼저 보셔야 할 일부터 여기에 정리해 두겠습니다.`
        : "연결이 끝나면 확인하실 일을 여기에 정리해 두겠습니다.",
    ],
    chips: [],
    link: CONNECT_ACTION,
  };
}

/**
 * The overview — what this product is, in one line and four items.
 *
 * The shape the previous card had, kept: it was right for the question it answers. What changed is
 * that it is now ONE of five answers instead of the answer to every product question.
 */
export function overviewAnswer(input: SelfKnowledgeInputs): SelfAnswer {
  const domains = capabilityDomains(input.registeredTools);
  const registered = new Set(input.registeredTools);
  const words = delegableWords(input.readiness);
  const notStarted = input.readiness.kind === "NO_CHANNEL";
  if (domains.length === 0) {
    return { headline: "지금은 확인해 드릴 수 있는 항목이 없습니다.", lines: [], chips: [] };
  }
  const nouns = domains.map((d) => d.short).join(" · ");
  const state = input.readiness.kind === "UNKNOWN" ? []
    : notStarted ? ["아직 연결된 판매 채널이 없어, 지금은 가져와 둔 자료가 없습니다."]
      : [`지금 연결된 채널은 ${input.readiness.connected.join(" · ")}입니다.`];
  return {
    headline: notStarted
      ? `판매 채널을 연결하시면 ${withObject(words ?? nouns)} 대신 확인하고, 다음에 하실 일까지 준비해 드립니다.`
      : `${withObject(nouns)} 대신 확인하고, 다음에 하실 일까지 준비해 드립니다.`,
    lines: [
      ...domains.map((d) => {
        const extra = d.extra && registered.has(d.extra.tool) ? ` ${d.extra.line}` : "";
        return `${d.short} — ${d.line}${extra}`;
      }),
      ...state,
      boundarySentence(input.actionClasses),
    ],
    chips: notStarted ? [] : domains.map((d) => d.chip),
    ...(notStarted ? { link: CONNECT_ACTION } : {}),
  };
}

/**
 * <b>A fact is said once — per FACT, not per conversation.</b>
 *
 * The rule that produced the reported repeat was 「this conversation already drew the capability card,
 * so answer the getting-started card instead」, which made every later product question return one
 * fixed answer. The rule is kept and narrowed to what it always meant: the same ASPECT asked twice is
 * a repeat; a different aspect is a different fact and gets its own answer.
 *
 * The second telling of one aspect is not a re-print either — it is that aspect's answer with the
 * items dropped, because the seller has read them.
 */
export function shortenRepeat(answer: SelfAnswer, readiness: SellerReadiness): SelfAnswer {
  const names = readiness.connected.join(" · ");
  if (names.length > 0) {
    return {
      headline: `${withSubject(names)} 이미 연결돼 있습니다. 오늘 하실 일부터 정리해 드릴 수 있습니다.`,
      lines: [],
      chips: ["내가 해야 할 일 정리해줘", ...answer.chips],
      ...(answer.link ? { link: answer.link } : {}),
    };
  }
  // <b>A repeat must not be the same sentence.</b> Dropping the card and keeping the headline was the
  // first shape of this function, and on a shop with nothing connected it produced a turn that was
  // WORD FOR WORD the previous one with the items removed — strictly less than the first answer, and
  // the very thing 「연동하고 나면 뭐가 되냐고」 was asked a second time to escape. The seller asking again
  // is not asking for the list again; what is left to say is why the answer stops here and what moves it.
  return {
    headline: "말씀드린 것까지가 연결 전에 드릴 수 있는 전부입니다 — 채널을 연결하시면 실제 자료로 바로 보여 드리겠습니다.",
    lines: [],
    chips: answer.chips,
    link: answer.link ?? CONNECT_ACTION,
  };
}
