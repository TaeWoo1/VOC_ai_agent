/**
 * <b>Which repeated problem the seller named — the axis the issue reads did not have.</b>
 *
 * <p>Measured in pilot QA (2026-09-06): 「접착 부족 문제 근거 보여줘」 was answered with 접착 파손 ·
 * 배송 파손 · 표면 누락. The plan was right — it named `search_review_issues` — and the tool had no way
 * to be told WHICH problem, so it returned the head of the org's list. An answer about three problems
 * the seller did not ask about is not a partial answer; it is a different answer, delivered with the
 * same confidence.
 *
 * <p><b>Deterministic, and the seller's own words.</b> Nothing here is a model call and nothing invents
 * a subject: the term is a literal span of the sentence, taken only where the sentence marks it as the
 * thing being asked about (「X 문제」·「X 이슈」·「X 관련」·「X에 대한」). It names no issue and knows no
 * issue titles — matching a span to the org's actual problems is
 * {@link ../tools/issueSubjectMatch#narrowIssuesBySubject}, which runs against rows that were read.
 *
 * <p><b>Where it runs.</b> Beside {@link ./subjectTerm#subjectTermOf}, in the one pre-specialist place
 * that reads the sentence (`operator/plan/scopeOverride.ts`), and it travels to ReviewOps as a value on
 * `SpecialistInput`. The ownership contract is unchanged: the sentence is read once per turn.
 *
 * <p><b>The failure direction is 「no narrowing」.</b> A sentence that marks nothing yields null and the
 * list is read whole, exactly as before. What must not happen — and is what this closes — is narrowing
 * to the wrong problem, or answering about the top problem when the named one does not exist.
 */
import { isRefineWord, namesContent } from "./reference";
import { NOT_A_SUBJECT } from "./subjectTerm";

/** The longest span accepted as a problem name. Issue titles are two words (「접착 부족」). */
const MAX_TOKENS = 2;

/** Trailing particles a captured noun may wear. Stripped only when a word remains. */
const PARTICLES = ["이나", "이랑", "은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "과", "와", "로", "랑", "나"];

/**
 * Words that describe the CATEGORY 문제/이슈 rather than name one.
 *
 * <b>Read together with {@link NOT_A_SUBJECT}</b>, which already holds every word that has its own
 * axis (a channel, a period, a work state, a quantifier) or names an object rather than a property.
 * This set adds only what is specific to this surface: words for the memory ITSELF — its repetition,
 * its prominence, its severity, and the complaint that fills it.
 *
 * <b>Why a list at all.</b> 「반복 이슈가 있는지 알려줘」 marks a span exactly the way 「접착 부족 문제」
 * does, and the difference is not grammatical: 반복 says what KIND of thing is being asked about and
 * 접착 부족 says which one.
 *
 * <b>Nothing here can refuse a real title.</b> None of these is an aspect or a problem in the
 * extractor's vocabulary (배송·포장·접착·표면·색상·크기·설치·설명·가격 × 파손·결함·누락·균열·탈락·
 * 불일치·지연·부족·오염·난이도), and the failure direction is 「no narrowing」 — a word missing from
 * here means one general question is answered as a name that matches nothing.
 */
const NOT_A_PROBLEM_NAME: ReadonlySet<string> = new Set([
  "반복", "되풀이", "공통", "주요", "대표", "특정", "심각", "불만", "불편", "클레임", "컴플레인",
  "구매자", "후기", "운영", "지금", "현재", "새로운",
]);

/**
 * Either table refuses it, and for the same reason: it is not the name of a problem.
 *
 * <b>And so does a refine expression</b> — 「그중」·「여기서」 point at rows already on screen
 * ({@link ../conversation/reference#isRefineWord}, the table that lane has always had). Measured live
 * 2026-09-07: 「그중 접착 문제 근거 보여줘」 was read as the problem named 「그중 접착」, no issue carries
 * that name, and the seller was told a problem they had just been shown is not in the record.
 */
const notAName = (token: string) =>
  NOT_A_SUBJECT.has(token) || NOT_A_PROBLEM_NAME.has(token) || isRefineWord(token);

/**
 * The markers that say the span before them is the thing being asked about.
 *
 * <p>「문제」/「이슈」 are here and NOT in {@link ./subjectTerm}: on an inquiry row 「문제」 is a word the
 * customer used, and on this surface it is the noun the whole memory is made of — the same token means
 * different things to two different reads, and each read owns its own list.
 */
const MARKERS: readonly RegExp[] = [
  /((?:[^\s]+\s+){0,2}[^\s]{2,12})\s*(?:문제|이슈)/gu,
  /((?:[^\s]+\s+){0,2}[^\s]{2,12})\s*(?:관련|관한)/gu,
  /((?:[^\s]+\s+){0,2}[^\s]{2,12})\s*에\s*(?:대한|관한|대해서?|관해서?)/gu,
];

/**
 * The span this sentence marks as a problem name, or null.
 *
 * <p>The whole span is kept rather than one token, because a problem's name IS two words: reading
 * 「접착 부족」 down to its nearest content word gives 「부족」, which matches 설명 부족 just as well and
 * turns an exact question into an ambiguous one.
 *
 * <p>Leading tokens that name nothing are dropped (「요즘 접착 부족 문제」 → 접착 부족), and the span is
 * refused outright when its LAST token names nothing — 「반복되는 문제」 and 「가장 많은 문제」 mark a
 * grammatical subject and name no problem, and must go on reading the whole list.
 */
export function issueSubjectOf(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (t.length === 0) return null;
  for (const pattern of MARKERS) {
    for (const match of t.matchAll(pattern)) {
      const span = usableSpan(match[1]!);
      if (span) return span;
    }
  }
  return null;
}

function usableSpan(raw: string): string | null {
  const tokens = raw.trim().split(/\s+/).filter((t) => t.length > 0).slice(-MAX_TOKENS);
  if (tokens.length === 0) return null;
  const head = tokens[tokens.length - 1]!;
  // The head noun decides, and it is tested BEFORE any particle comes off. 「는」 is both a topic
  // particle and the present adnominal ending, so stripping first would turn 반복되는 into the "noun"
  // 반복되 — the same trap `subjectTerm.ts` records.
  if (!namesContent(head)) return null;
  // …and one ending the shared table cannot carry. 「-은」 is a particle as well as an adnominal ending,
  // so refusing it there would cost 「가격은」 its narrowing on every other lane. Here it costs nothing —
  // no problem title ends in 은, and 「가장 많은 문제 알려줘」 read as the name 「많은」 would answer a
  // question about the whole list with 「그런 문제는 없습니다」.
  if (head.length > 1 && head.endsWith("은")) return null;
  const bare = tokens.map(stripParticle);
  // 「반복 이슈」·「고객 불만」 — the head names the memory, not a problem in it.
  if (notAName(bare[bare.length - 1]!)) return null;
  let start = 0;
  while (start < tokens.length - 1
    && (!namesContent(tokens[start]!) || notAName(bare[start]!))) start += 1;
  const span = bare.slice(start).join(" ").trim();
  return span.length >= 2 ? span : null;
}

/** 「불만이나」 → 불만. Longest particle first, and only when a word is left behind. */
function stripParticle(token: string): string {
  const t = token.trim().toLowerCase();
  for (const p of PARTICLES) {
    if (t.length > p.length + 1 && t.endsWith(p)) return t.slice(0, -p.length);
  }
  return t;
}
