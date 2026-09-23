# reviewnary Design Contract v3

**Status:** 2026-09-01 · Reviewnary Product UI Redesign v1 + Contextual Agent Workspace & Interactive UX QA v1 (§8-A, §8-B) + Frontend-first Agent Workspace Redesign v1 (§8-B′, §8-K) + **Agent Object + First-use Closure v1** (§8-K, §8-L, colour `bad`) · `frontend/` only · **source of truth for new UI**

v1 of this document was a record of what the code already did. v2 is the other thing: the contract the
code is built to. Where the code and this document disagree, the code is wrong.

Product identity it serves: **reviewnary is an AI 판매운영 담당자** — it looks first, investigates,
decides what to prepare, prepares it, asks when it must, and executes only behind a human approval.
The UI is **Agent-first, chat-first, object-backed**: a sentence carries intent, and the work is shown
by the structured surface that already owns it. Never chat-only; never dashboard-plus-a-button.

---

## 0. Who reads it, and the pass mark

A **40–50대 non-technical owner** of a small selling/manufacturing company, desktop browser, often
110–125% zoom, glancing between other work.

Every screen must answer its one question **in five seconds, without reading a paragraph**:

| Screen | Question |
|---|---|
| 홈 | 오늘 무엇을 해야 하지? |
| 상품 | 어떤 상품에 문제가 있지? |
| 리뷰 | 어떤 리뷰를 봐야 하지? |
| 문의 | 어떤 문의부터 처리하지? |
| 주문 | 지금 판매 상황은 어떻지? |
| 채널 연결 | 어디 연결에 문제가 있지? |
| 설정 | 어디서 무엇을 바꾸지? |

Two rules that outrank the rest of this document:

1. **A number that means an obligation must be true.** Visual simplification is never semantic
   simplification — synthetic/REAL, freshness, answer basis, approval, evidence, and channel capability
   keep their exact meaning in the simplest rendering.
2. **Structure carries meaning first; sentences confirm it.** If a sentence can be replaced by a label,
   a state, an object or an ordering, it is.

---

## 1. Typography

One family: **Pretendard** → platform Korean sans. No monospace in product UI.

| Token | Size / line | Weight | Used for |
|---|---|---|---|
| `3xl` | 32 / 1.2 | 700 | one hero number, rarely |
| `2xl` | 26 / 1.25 | 700 | **the Agent briefing sentence** |
| `xl` | 22 / 1.35 | 700 | page title (`h1`) |
| `lg` | 18 / 1.5 | 600 | the customer's sentence, the draft, an object's name in detail |
| `base` | 16 / 1.6 | 400 | body, list rows, buttons |
| `sm` | 15 / 1.6 | 400 | metadata that is still read |
| `xs` | 13 / 1.5 | 500 | chips, table captions — **never a sentence that carries a fact** |

- Numbers are `tabular-nums`, weight 600. A count beside a label is `text-ink`; its unit is `text-muted`.
- Section titles are **short and functional** (`base`, 600): 「먼저 볼 일」, 「숫자」, 「채널」 — never a
  sentence.
- `break-keep` on every element that holds Korean.
- **Tiny helper copy is not a layer.** A `sm`/`muted` sentence may exist only when removing it stops a
  seller from acting. 「운영 데이터에서 바로 확인된 것만 보여줍니다」 is the kind of sentence that fails
  that test: structure already says it.

---

## 2. Layout

| Thing | Value |
|---|---|
| Sidebar | **232px**, `surface`, 1px `line` on the right; hidden below `md` |
| Main padding | 32px horizontal, 24px top (desktop) |
| Content width | **1120px** max, left-aligned inside the main column |
| Two-pane work surface | `[340px list \| flexible detail]`, the list column scrolls inside itself |
| Grid maximum | 4 compact metrics or 3 cards across; never 6 equal cards |

Breakpoints: default (mobile) · `sm` 640 · `md` 768 (sidebar appears) · `lg` 1024 (two-pane) · `xl` 1280.
No custom breakpoints. The page body never scrolls horizontally; wide tables scroll inside their own
container.

---

## 3. Spacing scale

4 · 8 · 12 · 16 · 24 · 32. Six steps and no others.

- inside a row: 4–8px
- between rows of a list: 0 (a 1px rule separates them); row padding 12px × 16px
- inside a card / between a section title and its body: 12px
- between sections of a page: **24px**
- between the page header and the first section: 24px

A page is `space-y-6`. Anything larger than 32px is empty space that has to justify itself.

---

## 4. Surfaces, borders, radius

| Token | Value | Means |
|---|---|---|
| `canvas` | `#F2F4F6` | the page ground; also an inset panel inside a card |
| `surface` | `#FFFFFF` | a card or a list container — something with its own edge |
| `line` | `#E5E8EB` | card edge, row rule |

- **Level 0** canvas → **Level 1** surface card (1px line) → **Level 2** canvas inset inside a card. Never
  a card inside a card; never a shadow on a resting card. Shadow (`shadow-card`) only on things that
  float (drawer, popover).
- Radius: **8px** controls and inputs, **10px** rows and chips' container, **12px** cards. Nothing rounder
  in the app surface. Chips are `rounded-full`.
- A list is **one bordered container with rows**, never N bordered cards. Five findings are five rows.

---

## 5. Colour

Accent `brand-700` `#1B64DA` is spent on **actions and the active nav item** and nowhere else. No brand
fills on cards, no gradients, no glow, no glass.

| Tone | Text | Tint | Means |
|---|---|---|---|
| `GOOD` | `good` `#12662F` | `good/10` | settled, grounded, connected — a **proven** state only |
| `WARN` | `warn` `#92400E` | `warn/10` | look at this before acting |
| `BAD` | `bad` `#B91C1C` | `bad/10` | failed, negative, disconnected |
| `INFO` | `brand-700` | `brand-50` | reviewnary prepared something |
| neutral | `muted` `#4E5968` | `canvas` | reference |

- Colour is never the only carrier: every coloured state has a word.
- A coloured word is checked **on its own tint**, and in **hover**, in a real browser. `brand-700` on
  `brand/15` measures 4.16:1 — use `brand-800` there. Solid primaries hover **darker** (`brand-800`).
- `warn` is not a default. A qualification that applies to everything (before the first connection) is
  `muted`; a global count in the chrome is a **secondary** status, not the loudest thing on every page.

---

## 6. Components (the primitives)

Extracted because the redesign needed them on more than one screen. They live in
`src/components/ui/`. There is no generic design framework beyond these.

| Primitive | What it is | Rule |
|---|---|---|
| `PageHead` | `h1` (xl) + optional count/meta + one action slot | **no description paragraph by default**; a screen explains itself by its first section |
| `Section` | `h2` (base, 600) with optional count and action, then children | not a card; the body decides whether it is a list container |
| `Metric` (`compact`) | label (sm) over number (2xl) + optional delta / caveat | a row of compact metrics is context, never the first thing on a screen |
| `Status` | chip with tone + word | the only way a state is coloured |
| `WorkItem` | a row: state → primary sentence → meta line → time, optional action | the shape of every queue (inquiries, prepared drafts, proactive cases) |
| `ObjectRow` | name → facet line → one action | the shape of every object list (products, channels, settings entries) |
| `AgentCommand` | input + suggestion chips + object result | the chat entry; a palette over existing objects, hands unknown sentences to the Agent |
| `AgentLaunch` | ghost button with the ✳︎ mark and a **context-specific label** | 「이 상품 분석하기」, 「이 문의 조사하기」 — opens the contextual panel (§8-A); never a generic 「AI에게 묻기」 alone |
| `AgentPanel` | the 400px contextual panel: header (surface label) → box → answer objects → footer | one per app, closed by default; docked ≥1440, overlay below |
| `TrendChart` | SVG time series with tooltip, legend toggle, keyboard, optional drill-down | §8-B; no click affordance without a backend-honoured drill-down |
| `Empty` | title + one sentence + one action | never 「데이터 없음」 |
| `Disclosure` | drawn chevron + label | the only way to fold |

---

## 7. Hierarchy rules per surface

**Global shell.** Sidebar: wordmark, workspace name, two groups of nav, and at the bottom a
**secondary** connection-health line (「연결 문제 3건」 as a small warn word with a dot, not a pill in
the top-right of every page). No desktop top bar — the page title starts the page. No floating AI
button: the Agent is the home conversation and the contextual panel (`AgentLaunch`, an open-ended
「…에 대해 물어보기」) in the context that owns the object.

**홈.** The conversation (§8-A): greeting line (2xl, arithmetic) → compact context strip (3 numbers +
one shared freshness line + 「자세한 숫자 보기」) → timeline (the proactive first turn, then the seller's
turns and the operator's artifacts) → composer (sticky) → suggested prompts. No KPI grid, no chart wall,
no feature buttons: the numbers the seller asks for come back as artifacts, and the old dashboard lives at
`/overview`. Zero gets its own sentence.

**상품.** An object list, not a SKU table: name → `채널 · 문의 N · 리뷰 N · 답변 기준 N · 미답변 N` →
[열기]. Ordered by what needs attention (unanswered, then issue evidence, then reviews), so an
unattributed placeholder never leads. The SKU is inside the detail, not the row.

**리뷰.** 「왜 이 리뷰를 봐야 하는가」 first: the record's 확인 필요 count with its one action, then
**반복되는 문제** (category · count → filter), then the list where each row is `★ n · sentence ·
product` with the tier as a `Status` word. AI-classification internals (keyword cluster, same-class
count, explanation) are one folded line per row.

**문의.** Work-state first: `초안 준비됨 · 답변 필요 · 답변함` as the row's first word, then the
customer's sentence, then product/channel, then time. Rows older than a year sit under their own quiet
divider in `muted` so a 2014 backlog never has the weight of this morning's question. A chosen row
opens `[340px | detail]`; the detail is question → answer state card → draft → CTA on its own line.

**주문.** Filters (period + channel) at the top at full weight; four compact metrics (주문 · 매출 ·
일평균 · 최다 채널); one trend chart; the channel share as a table with bars. No 「운영 인사이트」
card: the data says it.

**채널 연결.** Three rows, each `name · Status word · last collection`, **one** primary action per
row, and the health detail (error text, expiry) folded. The review-record link is a text link.

**설정.** A grouped list: 워크스페이스 · AI 답변 스타일 · 운영 정책 · 연결 알림 · 더 보기 · 계정 — each
a row with a one-line meaning and one action. No card wall.

---

## 8. The Agent — object-backed, and how it reaches Home (v3.2)

reviewnary delegates work to an **AI operator**, and the conversation is how work is handed over (§8-A: on Home that conversation is a compact command bar, not the page). The seller hands over work in
their own words; the operator investigates real data, asks for one human step only when it must, returns
**structured artifacts**, keeps the thread across follow-ups and across screens, and hands off to a
workspace or to Human Approval when that is the better tool. Text-only chat is forbidden, and a typed sentence is always planned by the planner or the run fails —
that contract is unchanged. What §8-A retires is only the claim that the **Home screen** is the thread.

**Conversation vs workspace.** Conversation = where work is delegated, investigated, decided and prepared.
Workspace (문의 / 리뷰 / 상품 / 주문 / 채널 / 설정) = where many objects are read precisely, handled in bulk,
or explored deeply. An artifact links into the workspace (「전체 8건 처리하기」); the conversation does not
end when the seller goes there — the same thread continues in the contextual panel.

### 8-A. Home = 오늘의 고객운영 상황과 할 일 (v3.2, 2026-09-23 — product-owner decision)

**이 절은 「Home = the conversation」을 폐기한다.** 그 계약은 Home을 대화 타임라인으로 규정했고, 이 저장소의
Home은 한참 전부터 그렇지 않았다 — 실측(1440×900, `bb526245`)한 `/`는 작업 목록 + 우측 detail의 2-pane
워크스페이스이고 대화는 목록 열 바닥의 한 줄이다. 코드가 이미 뒤집혀 있었고 이 문서만 낡아 있었다.

Home이 답하는 질문은 그대로 **「오늘 무엇을 해야 하지?」**이고, 답은 **일의 목록**이다. Chat은 그 위의
주인공이 아니라 **compact command surface** — 한 줄 입력이고, 인식되지 않은 문장은 예전과 똑같이 planner로
간다(팔레트는 planner가 아니다). 전체 대화는 사이드바 「대화」와 `/agent`가 계속 소유한다.

| Rule | Value |
|---|---|
| Order | 제목 줄(날짜 · 상태 · 다음 확인) → **행동 가능한 두 숫자**(확인할 일 · 실행 대기) → 약한 「자동 확인」 상태 줄 → 확인할 일 목록 → 실행 대기 → **반복 문제(secondary)** → compact command bar |
| Top summary | **의무를 뜻하는 숫자만.** 확인할 일 = 판매자의 결정을 기다리는 것, 실행 대기 = 승인했고 아직 등록하지 않은 것. **반복 문제는 여기 서지 않는다** — 패턴이지 기다리는 고객이 아니고, 목록 아래 자기 섹션이 이미 그렇게 말한다 |
| 자동 확인 | reviewnary가 한 일에 대한 보고이므로 숫자 카드가 아니라 **약한 한 줄**. 판매자의 할 일로 세지 않는다 |
| Detail panel | **기본 닫힘.** 행을 눌렀을 때만 열리고, 명시적 「닫기」와 `Esc`로 닫힌다. **URL이 소유한다** — `item` 없음 = 닫힘, `item=<key>` = 그 행, **매치되지 않는 key = 닫힘**(낡은 주소가 다른 레코드를 조용히 열지 않는다) |
| Panel 크기·깊이 (v3.1) | **목록이 주인공이다.** 닫힘이면 목록이 열의 남은 폭을 쓰고(cap 1,160 — 760px 고정이라 좌우 ~224px가 비어 있었다), 열리면 panel은 **440px 고정 preview**(46%/556px가 아니다). Panel은 **판단 form을 펼치지 않는다** — 고객 원문 → 왜 올라왔나요 → 확인한 사실 → 추천 → **하단 고정 CTA 하나**이고, 중요도 수정 · 처리 방법 · 직접 조치 기록은 **전체 Case가 소유한다**(숨기는 것은 form이지 사실이 아니며, 읽기 · 쓰기 · 상태는 두 깊이에서 동일하다). Panel 안의 카드는 hairline section으로 — 페이지 안 panel 안 카드는 한 가지를 말하는 테두리 셋이다. **solid는 panel당 하나**: panel이 스스로 누를 것을 들고 있으면(문의 답변 패널 · 반복 문제 판단) 하단 CTA는 outline이 된다. **preview는 opt-in**이고 `확인할 일` 큐 화면처럼 「앞에 놓인 그 건」이 일인 화면은 예전 panel 그대로다 |
| Dashboard | KPI · 추이 · 채널별 수치는 **`/overview`가 계속 소유한다**. Home은 그 숫자를 복제하지 않는다 — 같은 숫자가 두 정의로 두 곳에 있는 것이 이 저장소가 여러 번 고쳐 온 결함이다 |
| Composer | 한 줄 dock, Enter sends, Shift+Enter breaks. **Home에서는 shell의 유일한 elevation을 반납한다**(v3.1) — 목록이 주제인 화면에서 상자는 돌아오는 표면이 아니라 손을 뻗는 표면이고, 폭은 그 아래 목록 열을 따라간다. 예시 칩은 빈 스레드에서만. 발송 fence 문장은 그대로 — 문장이 전송을 요구하는 순간 상자 아래 선다 |
| Suggested prompts | chips are examples (「오늘 리뷰 뭐 들어왔어?」「이번 주 매출 왜 이래?」…), never the capability boundary; anything typed goes to the planner |
| Shortcuts | exact-match only (a chip label); a match renders a local turn labelled 「바로 보기」. Containment matching is forbidden — that is how 「오늘 새 리뷰」 became 「리뷰 문제」 |
| History | 「새 대화」 and 「지난 대화」 (the seller's own first sentences); the current thread survives reload and navigation |

### 8-B. Turn anatomy

- **User turn**: the sentence, right-aligned, plain.
- **Agent turn**: one or two deterministic sentences (a count, a clarification, or the reason it failed) →
  artifacts → suggested follow-ups (chips) → 「확인한 자료」 disclosure (`EVIDENCE`: what was read, how much,
  for which dates, whether any of it could not be judged).
- **Progress**: ONE line — the stages the runtime reached as a quiet trail, then what is happening now and
  the elapsed clock. No bar, no animated steps nobody measured, and no column that grows while the seller
  waits and then shoves the answer down when it lands.
- **Failure**: a real state with the runtime's reason. Never an empty success, never a canned object.

### 8-B′. Rhythm, weight and repetition (Frontend-first Agent Workspace Redesign v1)

Five rules. They are what stops a conversation surface from reading as an admin panel with a chat box.

| Rule | Value |
|---|---|
| **Turn rhythm** | 24px between turns, 12px inside one. Nothing inside a turn may be spaced like a turn. |
| **The answer is prose** | `base` 16 / 1.7 on the canvas, no container. A SUMMARY is prose too — a paragraph never earns a card. |
| **The object outranks the narration** | The largest text in a turn is what the seller acts on — the customer's message when a row is open, the draft body — at `lg`. An announcement set larger than the thing announced is a defect. |
| **One control per row** | The row is the control. Its workspace link lives inside the row it belongs to, as a text link, once. Never an icon beside every row AND a button in the row AND a footer link. |
| **One fact, one rendering** | A word every row shares is said once, in the caption — or not at all when the sentence above already said it (`lib/conversation/sharedWord.ts`). A wait replaces a receipt date rather than standing beside it. |

**Objects that get a container:** 문의 · 리뷰 · 상품 · 초안 · 승인 · 사람이 할 단계. Everything else is content.

**System state is secondary disclosure.** Collection freshness, connection state and 「최신 상태로 갱신」 are
context for the work, never the loudest thing on a screen whose subject is the work: an OFFERED refresh is
an `outline` control, and only a step the answer genuinely waits on takes a solid primary.

### 8-K. The current object

The conversation can stand on ONE object: **문의 · 상품 · 리뷰**. A press is the same state transition as
naming it (`select`, verified in the runtime, persisted with the thread, appended to the transcript as
nothing), and 「해제」 is that transition backwards.

- The **context bar** names it, and it is **attached to the composer** — one outline, because the object
  the next sentence is about and the place that sentence is typed are one thing.
- **A product is named; a review is described.** The bar resolves a name from the artifact the thread
  already drew. A product's name is the seller's own catalogue label and survives a reload; a review's
  text is the customer's and is transient by contract, so the bar says 「선택한 리뷰」 with the closed facts
  (product · ★ · date) instead of quoting it.
- 「이 상품」 resolves to the anchored product without a second lookup; a REVIEW anchor's product travels
  only when the sentence says 「이 상품」, because it is a fact ABOUT the review and not the review.
- **An anchored object can be worked with** (Agent Object v1). A review has its own card — the customer's
  redacted sentence at `lg`, the closed facts above it, the repeated problems it is evidence for as links,
  and a reply control ONLY where the channel takes one. The body is transient like every customer text:
  stripped before the thread is stored and re-read from the same exact endpoint on a reload.
- **The anchor stands until a new set is drawn that does not contain it** — not until the next turn.

### 8-L. The first-use mornings

Three states, derived from the channel table the page already has, never a second read:

| state | the home's lead |
|---|---|
| no channel connected | what connecting hands over (derived from what those channels offer) + ONE action |
| connected, nothing held | 「연결은 끝났습니다 · 첫 수집이 끝나면…」 — or, when a collection HAS run empty, that |
| rows exist | the ordinary brief |

「지금 먼저 확인할 일은 없습니다」 belongs to the third alone. In the other two it reads as a verdict on the
seller's store that no read supports.

**One fact, one owner.** A channel's collection state is said by whichever thing carries the control (the
step card), never also as prose beside it; a card whose title the sentence above already said declares that
itself (`titleSaid`) rather than being guessed at by containment.

### 8-C. Artifact vocabulary (closed)

`SUMMARY · METRIC · LIST · TABLE · REVIEW_LIST · INQUIRY_LIST · PRODUCT_LIST · ISSUE_LIST · ORDER_SUMMARY ·
CHART · DRAFT · EVIDENCE · CHECKLIST · HUMAN_ACTION_REQUIRED · APPROVAL · EXECUTION_RESULT · WORKSPACE_LINK`

Each renders with the existing primitives (`WorkItem`, `ObjectRow`, `Status`, compact `Metric`, `TrendChart`,
`Section`/`ListBox`) — no new component library. A result with no dedicated artifact is a `LIST`/`TABLE`/
`SUMMARY`. No planner id, model name, locator or raw enum reaches the screen.

### 8-D. Follow-up behaviour

A follow-up is read against the previous working set: 「안 좋은 것만」「카페24만 봐봐」「상품별로 묶어줘」
「문의에서도 같은 얘기 있어?」「첫 번째 거 답변 준비해줘」「조금 더 부드럽게」「좋아 보내자」. The artifact changes
to match (filtered list, grouped products, cross-domain list, draft, approval). The set is ids + closed
filters; the customer's words are never part of it.

### 8-E. HumanActionRequired

A step only the seller can take is a state, not an error: headline (「새 리뷰를 확인하려면 리뷰 가져오기가
필요합니다」), the channel, the reason, **one primary** (「지금 리뷰 가져오기」 for the product's own one-press
collection; 「직접 진행하기」 into the existing flow otherwise) and 「계속 확인하기」. When the step completes
the original request resumes and its result lands in the same thread (「새 리뷰 가져오기가 끝났습니다. 계속
확인하겠습니다.」).

### 8-F. Approval and execution

「보내자」 produces an `APPROVAL` artifact bound to the exact draft version and fingerprint. Sending requires
the same two-step confirm the inquiry screen uses (a first press reveals 「승인하고 전송」); the conversation
modules import nothing that can publish except that one artifact (structural test). The verified result
returns as `EXECUTION_RESULT`. Ambiguous results are never retried automatically.

### 8-G. The contextual panel

The panel on every workspace page is **the same conversation**: 400px, closed by default, docked ≥ 1440px,
overlay below, Esc closes. The header names the object in view; the launcher opens the panel with the
structured hint only (empty box, 「이 상품에 대해 무엇이든 물어보세요」) — it is not a feature button. Surface
chips (≤ 3) are examples. Navigating from an artifact link opens the panel so the thread continues beside
the workspace.

### 8-G′. Channel capability, as artifacts

The conversation never explains API differences in prose. The artifact itself says what happens next:

| Situation | What renders |
|---|---|
| review channel automatic + stale | a `REFRESHING` stage, then the rows — no card asks the seller anything |
| review channel guided + stale (NAVER / Coupang) | `HUMAN_ACTION_REQUIRED` per channel: 「네이버 리뷰 가져오기」 / 「쿠팡 리뷰 가져오기」 + 「일단 확인된 리뷰 보기」; the guided panel opens inline; pairing inline when no helper; file upload as a secondary link, never the primary |
| partial completion | 「네이버 리뷰 확인이 끝났습니다. 쿠팡도 확인할까요?」 + `[쿠팡 확인] [지금까지 보기]`, working set kept |
| reply on an API channel (Cafe24 review, NAVER/Cafe24/Coupang inquiry) | `DRAFT` → `APPROVAL` 「승인하고 게시」 with the two-step confirm → `EXECUTION_RESULT` |
| reply on a guided channel (NAVER review) | `DRAFT` → `GUIDED_EXECUTION` 「네이버에서 답변하기」: the review is found, the draft is placed, 「등록은 판매자님이 누릅니다」 |
| reply not supported (Coupang review) | one honest sentence + next-step chips (비슷한 리뷰 더 찾기 · 관련 문의 확인 · 상품 문제 조사 · 상세페이지 개선 검토) — no draft, no CTA |
| object without marketplace identity (file-imported row) | draft + copy only, 「이 문의는 파일로 가져온 기록이라 채널로 보낼 수 없습니다」 |

Copy rule: the seller performs the platform's own confirmations; reviewnary prepares, detects, ingests and resumes.
Never 「한 번 클릭」 as a promise.

### 8-H. Proactive messages

What the agent found on its own enters the timeline as its first turn, in the same artifact vocabulary, with
「근거」 and a follow-up prompt. It reuses the Proactive Operations Agent's cases; it does not invent work.

### 8-I. Responsive

≥ 1440: timeline 1120 + docked panel. 1366×768 and 1152×720: the composer stays visible above the fold,
timeline scrolls inside `main`, panel overlays. Below `md`: one column, panel full width, composer above the
tab bar. Long threads (8+ turns, several artifacts) must not break scroll, focus or the composer position.

### 8-J. Interactive analytics (unchanged)

A chart is an operational control or it is decoration; this product ships only the first kind.

- **Hover and keyboard show exact values.** Every point is a band; the nearest band's date and each visible series' exact value render in one tooltip (`₩574,990`, `30건`), and ←/→ on the focused chart reach the same index with the same tooltip and an `aria-live` sentence. The sr-only table stays as the verification path.
- **The legend toggles.** Each series is a button with `aria-pressed`; the last visible series cannot be hidden.
- **Units decide the scale.** Same unit ⇒ one shared scale (「of which」 never looks larger than its whole). Different units (매출 · 주문) ⇒ each on its own scale **and the caption names both maxima**.
- **A click does something or is not offered.** Bands get a pointer cursor, a 「눌러서 이 날 보기」 line and Enter only when the surface can honour a single-day view (`/orders?date=`). Inquiry and review series have no day filter, so their points are inert and the card links to the screen instead.
- **Cross-filter: the URL is the state.** `주문` reads `?days=`, `?channel=`, `?date=`; the range control, the channel select, the channel-table rows and the chart bands all write to it; KPI, chart and table read one response per filter.
- **Sparse date ticks** (first, last, up to three between) so a 30-day line has a calendar.
- **Interaction states**: hover (canvas tint), focus (`ring-2 ring-brand-700`), pressed (`aria-pressed`), disabled (opacity 50, no pointer), loading (one line). Every clickable row and band is reachable by keyboard.

---

## 9. Evidence, empty, loading, error

- Evidence: conclusion → first citation open (source · title · excerpt) → the rest folded. Locators,
  chunk ids, provenance strings, model names never render.
- Empty: what would appear here + the one action that makes it appear.
- Nothing to report: render **nothing**.
- Loading: one line (`불러오는 중…`), no layout-shifting skeleton.
- Long wait: measured elapsed seconds, never a bar.
- Dependency down: say what stopped, disable the control it broke, put the notice ABOVE it.
- Unknown: `—`, never `0`.

---

## 10. Accessibility

- AA (4.5:1) on every text node, measured composited, including tints and hover.
- Visible focus everywhere (`focus-visible:ring-2 ring-brand-700`); never removed.
- Every icon-only control has a name; every coloured state has a word; `aria-label` on each page region.
- Minimum control height 36px; primary 40px; 44px on touch surfaces.
- One `h1` per screen; sections are `h2`.

---

## 11. What this document does not authorise

- A new palette, a new font, a component library, landing-page patterns inside the app.
- A visual that claims work that did not happen (a progress bar nobody measured, an 「AI 분석 중」
  animation with no model running, a green check for a local save).
- A card framework. The primitives in §6 are the framework.
