# reviewnary Design Contract v2

**Status:** 2026-08-27 · Reviewnary Product UI Redesign v1 · `frontend/` only · **source of truth for new UI**

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
| `BAD` | `bad` `#DC2626` | `bad/10` | failed, negative, disconnected |
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
| `AgentAction` | ghost button with the ✳︎ mark and a **context-specific label** | 「이 상품 분석하기」, 「이 문의 조사하기」 — never a generic 「AI에게 묻기」 alone |
| `Empty` | title + one sentence + one action | never 「데이터 없음」 |
| `Disclosure` | drawn chevron + label | the only way to fold |

---

## 7. Hierarchy rules per surface

**Global shell.** Sidebar: wordmark, workspace name, two groups of nav, and at the bottom a
**secondary** connection-health line (「연결 문제 3건」 as a small warn word with a dot, not a pill in
the top-right of every page). No desktop top bar — the page title starts the page. No floating AI
button: the Agent is entered from the home command box and from `AgentAction` in the context that
owns the object.

**홈.** Briefing sentence (2xl) → command box → **먼저 볼 일** (prepared drafts · AI가 먼저 확인한 일 ·
findings, all as `WorkItem` rows in one container) → **숫자** (compact metric row with the window
control; one shared freshness line, not one per card) → **추이** (one wide chart, others behind the
number they belong to) → 채널별 table → 「이 숫자에 대하여」 as a disclosure. The sentence is arithmetic
over the rows rendered under it. Zero gets its own sentence.

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

## 8. The Agent

- **Observe → Investigate → Decide → Prepare → Ask → Execute** has to be legible: 「AI가 먼저 확인한 일」
  is *observe/investigate*, a prepared draft is *prepare*, the answer-state card and the approval CTA are
  *ask*, and the send behind the confirmation step is *execute*. Each is a structured object, not prose.
- The briefing sentence counts rendered objects; no model is called to write it.
- An Agent answer is rendered as the objects it cites, with links into the surfaces that own them.
- Every operations surface offers `AgentAction` with a label that names the object in view; the home
  command box is the free-text entry. The Agent's tool catalogue is READ-only; nothing here sends.

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
