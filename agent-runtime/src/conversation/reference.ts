/**
 * The REFERENCE grammar — the word classes that point at something instead of naming one.
 *
 * <b>The defect this closes, and why it appeared three times.</b> Three lanes read the seller's
 * sentence for content words: {@link import("./subjectTerm").subjectTermOf} (the subject a rows read
 * narrows by), `taskInterpreter.visibleFilterOf` (the leftover token a visible-set refine narrows by)
 * and `visibleSelection.visibleSelectionOf` (the literals a row must contain). Each had its own private
 * list of words to ignore, and each list was missing the same class of word — the one that REFERS.
 *
 * Measured consequences, all from the same shape:
 * <ul>
 *   <li>「그중 제일 오래된 거 하나만」 → 하나 survived every table, became a SUBJECT, and the answer was
 *       「방금 본 문의 1건 중 하나 관련 문의는 없습니다」. The seller asked for one row and was told a
 *       subject they never named does not exist.</li>
 *   <li>「배송이 너무 늦습니다 이거 보여줘」 → 이거 became a literal every row had to contain, no row did,
 *       the selection lane declined, and the planner re-printed the whole list. The seller quoted a row's
 *       own title and got the list back.</li>
 * </ul>
 *
 * <b>Both failures are the same inversion.</b> Every one of those lanes documents its failure direction
 * as "no narrowing, never wrong narrowing" — and then promotes a token it could not read into a
 * narrowing constraint. A word the tables cannot vouch for must produce NOTHING; it may never produce a
 * filter. That rule is what this file exists to make sayable in one place.
 *
 * <b>Closed grammatical classes, not example cues.</b> Nothing here is a word from a failing sentence:
 * these are the demonstratives, the native numerals and the interrogatives of the language, which is a
 * finite list that does not grow when a seller says a new noun. A content word is anything they are not.
 */

/** Demonstrative determiners — 이 · 그 · 저 · 요, and the two-word forms that carry one. */
const DEMONSTRATIVES: readonly string[] = ["이", "그", "저", "요", "아까", "방금", "지금", "여기", "거기"];

/**
 * The bound nouns a demonstrative attaches to. These name a CATEGORY of object, never an instance, so
 * they can never distinguish one row from another — 「이 문의」 and 「그 건」 point, they do not narrow.
 */
const BOUND_NOUNS: readonly string[] = [
  "거", "것", "건", "게", "걸", "분", "쪽", "때",
  "문의", "고객", "구매자", "손님", "리뷰", "상품", "주문", "채널", "내용", "얘기", "이야기", "메시지", "글",
];

/**
 * Reference words as whole tokens — a demonstrative fused with a bound noun (이거 · 그건 · 저것), the
 * bare demonstratives, and the bare bound nouns. Generated from the two classes above rather than
 * listed, so the two can never drift apart.
 */
const REFERENCE_TOKENS: ReadonlySet<string> = new Set([
  ...DEMONSTRATIVES,
  ...BOUND_NOUNS,
  ...DEMONSTRATIVES.flatMap((d) => BOUND_NOUNS.map((n) => `${d}${n}`)),
]);

/**
 * Native Korean numerals and their determiner forms. A quantity belongs to the LIMIT axis — 「하나만」 is
 * 「한 개만」 said the short way — and belongs to no other axis at all.
 */
export const QUANTITY_WORDS: ReadonlyMap<string, number> = new Map([
  ["하나", 1], ["한", 1], ["둘", 2], ["두", 2], ["셋", 3], ["세", 3], ["넷", 4], ["네", 4],
  ["다섯", 5], ["여섯", 6], ["일곱", 7], ["여덟", 8], ["아홉", 9], ["열", 10],
]);

/**
 * A number with a unit — 3일 · 2주 · 5개 · 10건. These belong to the axis that owns them (period, limit)
 * and to no other, exactly as 「최근」 and 「미답변」 do.
 *
 * <b>Time and counting units only.</b> 3호 · 16mm · 2kg are SPEC values a customer really does ask about
 * ("3호 관련 문의 있어?"), and refusing those would take away a narrowing the seller meant. What is
 * refused is the shape that can only ever be a quantity: 「최근 3일 안에 들어온 문의」 marks a subject
 * grammatically and the nearest noun to the marker is 3일, which was read as one — the answer narrowed
 * by 「3일」 and returned nothing.
 */
const MEASURE = /^\d+(일|주|주일|개월|달|년|해|시간|분|초|개|건|명|번|회|가지)$/u;

/**
 * The native day-count nouns. Korean has a closed list of them and every one is a LENGTH OF TIME:
 * 「지난 이틀 사이에 들어온 문의 있어?」 put 이틀 next to the subject marker and the read narrowed by it,
 * answering 「이틀 관련 문의는 없습니다」 under a window that was otherwise correct.
 */
const DAY_COUNT_WORDS: ReadonlySet<string> = new Set([
  "하루", "이틀", "사흘", "나흘", "닷새", "엿새", "이레", "여드레", "아흐레", "열흘", "보름", "한달", "한해",
]);

export function isMeasureWord(token: string): boolean {
  const t = token.trim();
  return MEASURE.test(t) || DAY_COUNT_WORDS.has(t);
}

/** Interrogatives. They give a sentence its SHAPE (which? when? how many?); they are never its subject. */
const INTERROGATIVES: readonly string[] = [
  "언제", "어디", "어디서", "어떻게", "어떤", "어느", "무슨", "무엇", "뭐", "뭘", "왜", "누가", "누구", "몇", "얼마",
];

/**
 * Adnominal (관형형) endings — the grammar that turns a verb into a modifier of the noun after it.
 *
 * <b>Why this is a class and not a list of tails.</b> 「재입고 언제 되냐는 문의」 marks a subject
 * grammatically, and the token beside the marker (되냐는) is the relative clause's verb, not the
 * question's subject. Reading it as one produced `q=되냐`, which matched nothing and answered
 * 「그런 문의는 없습니다」 about an inquiry that exists. The endings below are the closed set the language
 * has for that construction: the plain forms (은/ㄴ · 는 · 을/ㄹ · 던) and the quotative ones built on
 * them (다는 · 라는 · 냐는 · 자는 · 는지 · 은지). A real noun caught by one of these simply loses its
 * narrowing, which is the safe direction.
 */
const ADNOMINAL_ENDINGS: readonly string[] = ["다는", "라는", "냐는", "자는", "는지", "은지"];

/**
 * The one-syllable forms of the same construction — 들어온 · 밀린 · 처리할 · 물어본.
 *
 * <b>They collide with real nouns and are applied anyway.</b> 제한 · 기한 · 권한 end in the same syllable
 * as 정한 does, and no shape test separates them. The collision costs a noun its narrowing (the answer is
 * about a wider question, and says so) while the alternative costs a verb its rejection (the answer is
 * about a subject nobody named, and says that instead). This list has always chosen the first, and the
 * two entries added here — 본 · 진 — are the same class, not an exception for a sentence.
 */
const ADNOMINAL_TAILS: readonly string[] = [
  "던", "는", "온", "운", "된", "한", "인", "린", "난", "든", "른", "쁜", "픈", "본", "진", "길", "줄", "할", "을",
];

/** Does this token point at something already on the table rather than naming a thing? */
export function isReferenceWord(token: string): boolean {
  return REFERENCE_TOKENS.has(token.trim().toLowerCase());
}

/** Does this token name a quantity? (The limit axis owns it; no other axis may.) */
export function isQuantityWord(token: string): boolean {
  return QUANTITY_WORDS.has(token.trim().toLowerCase());
}

/** Is this token a question word — the sentence's shape rather than its subject? */
export function isInterrogative(token: string): boolean {
  return INTERROGATIVES.includes(token.trim().toLowerCase());
}

/** Does this token read as a verb modifying the noun after it, rather than as that noun? */
export function isVerbForm(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (ADNOMINAL_ENDINGS.some((ending) => t.length > ending.length && t.endsWith(ending))) return true;
  return t.length > 1 && ADNOMINAL_TAILS.some((tail) => t.endsWith(tail));
}

/**
 * The one predicate every content-reading lane consults: can this token be a CONSTRAINT?
 *
 * False for every class above. A lane that gets `false` must narrow by nothing — never by the token,
 * and never by declining in a way that silently widens the question either.
 */
export function namesContent(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (t.length < 2) return false;
  if (EMPTY_WORDS.includes(t)) return false;
  return !isReferenceWord(t) && !isQuantityWord(t) && !isMeasureWord(t) && !isInterrogative(t) && !isVerbForm(t);
}

/**
 * Words a sentence may carry that name nothing at all: viewing verbs, politeness, and the fillers that
 * hold a request together. Shared so 「보여줘」 is not three private lists.
 */
const EMPTY_WORDS: readonly string[] = [
  // Bound and relational nouns (의존명사·방위명사) with or without their particle. They locate something
  // in time or space and never name a subject: 「최근 3일 안에 들어온 문의」 marks a subject grammatically
  // and the token beside the marker is 안에, which was read as one — the answer then narrowed by 「안에」
  // and returned one row of fifteen.
  "안", "안에", "밖", "밖에", "앞", "앞에", "뒤", "뒤에", "사이", "사이에", "전", "전에", "후", "후에",
  "동안", "이내", "이내에", "이후", "이전", "위", "아래", "때", "때에", "경우", "정도", "만큼", "무렵", "쯤",
  "보여줘", "보여주세요", "보여줄래", "봐줘", "봐주세요", "볼래", "볼게", "보자", "알려줘", "알려주세요",
  "확인해줘", "확인해주세요", "정리해줘", "말해줘", "주세요", "해줘", "줘", "좀", "다시", "그리고", "또",
  "가장", "제일", "전부", "모두", "다", "중", "중에", "중에서", "여기서", "관련", "관한", "대한", "대해",
  "자세히", "자세하게", "간단히",
];

/**
 * Refine expressions — the closed set of ways a sentence says it is narrowing what is ON SCREEN.
 *
 * <b>One list, two lanes.</b> `taskInterpreter.visibleFilterOf` has required one of these since
 * Conversation Core v1 §9 ("an explicit new-list request is a fresh ORG question and never a narrowing
 * of the rows on screen"); the PLANNER path had no such requirement and reached the opposite conclusion
 * on the same sentences — 「답변 안 한 문의 보여줘」, said after a topic list, came back as 「방금 본 문의
 * 중 배송 관련 답변 안 한 문의는 1건입니다」: twelve inquiries answered with one. The rule was already
 * written down; what was missing was that both lanes read it.
 */
const REFINE_MARKERS = /그중|그 중|이중|이 중|중에서|여기서|거기서|방금\s?본|위에서|앞에서/u;

/**
 * Is this token, whole, one of the refine expressions this file already owns?
 *
 * <b>Derived from the same table, so there is one.</b> {@link REFINE_MARKERS} says 「그중」 points at the
 * rows on screen; nothing said it therefore names nothing, and a lane that reads tokens read it as a
 * word. Measured live 2026-09-07 on the product panel: 「그중 접착 문제 근거 보여줘」 was read as the
 * problem named 「그중 접착」, which no shop has, and the seller was told their own repeated problem is
 * not in the record.
 *
 * <b>Offered, not folded into {@link namesContent}.</b> That was tried first and measured: dropping
 * 「그중」 from the shared predicate let the row-SELECTION lane match 「그중 배송 얘기만 볼래」 against the
 * rows and answer 「하나를 골라 주세요」 — a refine turned into a pick-one. The lanes that name an OBJECT
 * ask for this; the lanes that point at rows keep reading the marker their own way.
 */
export function isRefineWord(token: string): boolean {
  return new RegExp(`^(?:${REFINE_MARKERS.source})$`, "u").test(token.trim().toLowerCase());
}

/**
 * 「~만」 is a refine marker only on words that can point at the rows on screen.
 *
 * The delimitative particle attaches to anything, and the noun it attaches to decides what it means:
 * on a PRO-FORM (것 · 거 · 건) it says "only those of the ones you just showed me"; on a DOMAIN noun
 * (「문의만 보여줘」) it says "only inquiries, as opposed to reviews", which is a fresh question about the
 * org. Reading the second as the first is how 「최근 3일 안에 들어온 문의만 보여줘」 would become a
 * narrowing of whatever happened to be on screen.
 */
const PRO_FORM_ONLY = /(것|거|건|게|걸)\s*만/u;
const DOMAIN_NOUN_ONLY = /(문의|질문|리뷰|상품|주문|고객|채널)\s*만/gu;
const ANY_ONLY = /[가-힣0-9a-z]\s*만(?=$|[^가-힣])/u;

/**
 * The domain nouns that make a sentence stand on its own — 문의 · 리뷰 · 상품 · 주문 · 매출.
 *
 * <b>A fragment attaches; a complete request does not.</b> 「배송 관련부터」 names no object and cannot be
 * read without the rows on screen, so it IS a refine even though it says no 「그중」. 「답변 안 한 문의
 * 보여줘」 names its object and its verb and would mean the same thing said first — it is a question about
 * the org. Without this distinction the "no refine expression" rule would take a real follow-up away from
 * the set it was about.
 */
const OWN_OBJECT = /문의|질문|리뷰|상품|주문|매출|고객|답변/u;

export function namesOwnObject(text: string): boolean {
  return OWN_OBJECT.test(text);
}

/** Does this sentence say it is narrowing the rows already on screen? */
export function hasRefineExpression(text: string): boolean {
  const t = text.trim();
  if (REFINE_MARKERS.test(t)) return true;
  if (PRO_FORM_ONLY.test(t)) return true;
  return ANY_ONLY.test(t.replace(DOMAIN_NOUN_ONLY, " "));
}

/**
 * Does this sentence name NOTHING of its own — only a reference to what is already on the table?
 *
 * <b>What it is for.</b> 「그거 어떻게 처리하지?」 with nothing on the table is not an investigation
 * design problem; it is a question with no referent. Planned anyway (measured, four passes) it became a
 * plan for the org's orders, its inquiry queue and a checklist — subjects the seller never mentioned,
 * built by a planner call of 3.7–9.1s. A sentence with no content word and no referent has exactly one
 * honest answer, and the runtime can give it without a model call.
 *
 * Deliberately strict: ONE content word makes this false, so the classification can only ever send a
 * sentence TO the planner, never away from it by mistake.
 */
export function isReferenceOnly(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .replace(/[?？.,!·~"'「」]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  let sawReference = false;
  for (const raw of tokens) {
    const token = stripParticles(raw);
    if (token.length === 0) continue;
    if (isReferenceWord(token)) {
      sawReference = true;
      continue;
    }
    if (isInterrogative(token) || isQuantityWord(token) || EMPTY_WORDS.includes(token)) continue;
    // A verb the sentence ends with (「처리하지」, 「해야 해」) says what to do about the referent, not
    // what the referent is. Only tokens that could be a NOUN decide this question.
    if (isVerbForm(token) || VERB_SHAPED.test(token)) continue;
    return false;
  }
  return sawReference;
}

/** Conjugated verb/adjective endings a whole token may end in — the predicate of the sentence. */
const VERB_SHAPED = /(하지|하나|한다|합니다|해요|해야|하죠|할까|해|지|자|까|나요|네요|어요|아요|였어|했어|됐어|되지|되나|보지|볼까)$/u;

/**
 * Trailing particles (조사) stripped before a token is classified — the case markers first, because
 * 「문의에서도」 is 문의 with two of them and reading it as a noun of its own is how a scan walks past the
 * end of a noun phrase. Longest first; stops when what remains is too short to be a word.
 */
const CASE_PARTICLES: readonly string[] = ["에서는", "에서도", "에서", "에게", "한테", "부터", "까지", "으로", "로서", "라도"];
const PARTICLES: readonly string[] = ["은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "과", "와", "로", "요"];

export function stripParticles(token: string): string {
  let t = token;
  for (let i = 0; i < 3; i += 1) {
    const compound = CASE_PARTICLES.find((p) => t.length > p.length + 1 && t.endsWith(p));
    if (compound) {
      t = t.slice(0, -compound.length);
      continue;
    }
    const hit = PARTICLES.find((p) => t.length >= 3 && t.endsWith(p));
    if (!hit) break;
    t = t.slice(0, -1);
  }
  return t;
}
