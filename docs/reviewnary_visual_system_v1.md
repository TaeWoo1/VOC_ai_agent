# Reviewnary Visual System + Conversation Shell v1

> **What this is.** A visual/product design pass over the conversation shell, its objects and the
> global token layer. No behaviour. `frontend/` only — backend, agent-runtime and collector are
> untouched, and so are freshness routing, channel continuity, the definition of actionable work, the
> acquisition E2E, planner/retrieval/memory and every approval boundary.
>
> **Marketplace calls 0 · WRITE 0 · model calls: the QA turns only · migrations 0.**

---

## §0 Skills used, and what was and was not taken from them

| | |
|---|---|
| `frontend-design` (Anthropic, official) | Installed for this package (`claude plugin install frontend-design@claude-plugins-official`). Used as the **process**: name the subject, brainstorm a token plan, review it against the calibration list of AI-design defaults, then build and self-critique from screenshots. Two of its named defaults were live in this codebase and are closed below — the SaaS-card kit (§1) and middle-dot meta strings (§3). |
| `shadcn` (`npx skills add shadcn/ui`) | Installed. Used for the **chat composition rules** in `rules/chat.md` — scroller / message row / surface / marker as separate concerns — and to audit the registry components by name. |
| `vercel/ai-elements` | Installed, reference only. Read `conversation.md`, `message.md`. Nothing from its runtime, AI SDK or Next.js architecture is used. |
| `migrate-radix-to-base` | Arrived with the shadcn skill. **Not used** — the brief forbids a Radix/Base migration and this project has neither. |

### The code-asset audit, by name

The brief asked whether `MessageScroller` / `Message` / `Bubble` / `Marker` can be used as real code
assets here. They were fetched from the registry and read (`npx shadcn@latest view @shadcn/<name>`):

| component | dependency | verdict |
|---|---|---|
| `bubble` | `radix-ui` (Slot), `class-variance-authority`, Tailwind **v4** syntax (`wrap-break-word`, `oklch(from …)`, `ring-3`, `*:data-[…]`) | **Not importable.** Radix is forbidden by the brief; this project is Tailwind **3.4**, so the v4-only utilities would compile to nothing — silently. |
| `marker` | `radix-ui`, `cva`, v4 syntax | Not importable, same reasons. |
| `message-scroller` | new npm dependency `@shadcn/react` + the `button` registry component | Not importable, and not needed: the transcript's scroll is already owned by `ConversationWorkspace`. |
| `message` | **none** — plain Tailwind + `cn()` | The only portable one, and what it contains is a layout convention (`data-slot` parts, `group/message`, alignment by data attribute), not behaviour. |

There is also no `components.json`, no `cn()`, no `class-variance-authority` and no semantic CSS
variables (`--primary`, `--muted-foreground`) in this project — the palette is a Tailwind theme of
named hex values with three years of measured AA notes attached to it. Adopting the registry would
mean adopting all of that.

**So: 0 components imported, and the composition rules taken as guidance.** What was actually used
from `rules/chat.md` is its central distinction — that the scroller, the row, the *surface* and the
*marker* are four different concerns — and §1 below is that idea applied honestly to this product:
most rows here have no surface at all.

---

## §1 The direction: **Calm Operational Assistant**, and the one idea it rests on

The brief names the direction. The choice this package had to make is what it *means* in pixels.

**What was there.** A Toss-derived consumer skin: a `#3182F6` brand blue, a grey canvas, and white
`rounded-2xl` cards with a soft shadow. A review list, a step that hands the seller to the seller
center, a chart, and a draft they were about to send were the **identical box** — same radius, same
1px border, same shadow, stacked on grey. That is the `frontend-design` skill's calibration trait 4
verbatim ("content chopped into identical rounded cards, one border-radius on everything regardless
of hierarchy"), and it is what the brief means by 카드들의 카드.

One radius for everything is one radius for nothing. The box was saying *this is a thing* about
content that was obviously a thing, and saying nothing about which of them the seller had to touch.

**The idea: the conversation is a document, and containment is information.**

- The thread column is **paper** — `bg-surface`. The rail and the work surfaces are the recessed
  ground. That single inversion is what stops an answer from arriving as a white card floating on
  grey, and it costs **no new colour token**.
- A **reading object** — a list, a table, a chart, a metric — is *set into* the page: a hairline
  above, a hairline below, rows that breathe, pulled 16px wider than the column so its rows line up
  exactly with the sentence that introduced them. It reads like a table in a report, which is what
  it is.
- A **box means "this needs your hand."** `framed` is reserved for the five surfaces that ask for
  one: the step out to the seller center, an approval, a guided run, a knowledge question, and the
  draft the seller is about to send. An edge became a signal instead of wallpaper.
- **Elevation is spent once**, on the composer. It is the only thing that sits *on* the paper rather
  than in it, because it is the only live element on the page.

Where the brief left an axis free the boldness went into that inversion and nowhere else. In
particular the **accent hue was deliberately not changed**: `#3182F6` and its measured AA ladder
(`brand-700` 5.41:1, `brand-800` 7.38:1 on hover, and the `good`/`warn`/`bad` values each darkened
once after a real measured failure) are three packages of accessibility work, and a new hue would
have re-opened every one of them to buy a mood. **New colour tokens in this package: 0.**

---

## §2 Typography and rhythm

| | before | after | why |
|---|---|---|---|
| assistant prose | `base` 16/1.6 | **`prose` 17/1.75** | The answer is the assistant's own voice and it was set in the same size as a row's metadata. It is now the largest text in an ordinary turn — above the objects it is about, below what the seller *opens* (a customer's message, a draft, at `lg` 18). No component special-cases it; the scale does it. |
| reading column | 840px | **720px** (`max-w-thread`) | 840 ran to ~52 Korean characters a line. 720 lands near 45, where Korean prose stops making the eye travel back. |
| between turns | 24px | **32px** | Without card outlines, white space is the only thing left saying where one answer ends and the next begins. |
| home numbers strip | `sm` 15 | `xs` 13 | They qualify the briefing under them; they are not the morning's headline. |
| thread list rows | `sm` 15, 34px | `xs` 13, 32px | §6. |

**The nameplate is gone.** Every agent turn opened with a `✳︎` glyph and a 24px indent under it. In a
two-party conversation the alignment already says who is speaking, and the indent pushed every object
list one step off the reading edge. The glyph now survives in exactly the two places where it carries
information rather than identity: **the running progress line**, and a **stopped** turn. A failed turn
keeps a left rule, because "this did not happen" should not have to be inferred from a colour.

---

## §3 Business objects

- **Rows align with the sentence above them.** The block is pulled 16px wider than the column so the
  rows' own padding lands their text exactly on the prose. A list introduced by a sentence and then
  indented 16px from it reads as an attachment; aligned, it reads as part of the answer.
- **A set-in block's title is a caption** — `sm` semibold **muted**, because the rows carry the
  seller's own objects in ink and a label in the same weight competes with what it labels. A framed
  card's title stays ink: there, the title *is* the card.
- **Meta lines stopped being one string.** `선바로 일체형 전선몰드 · 네이버 스마트스토어 · 2026-09-02`
  joined three answers to three different questions into a single caption, and the eye could not scan
  the date down the list. They are three columns now, `xs`, with space between them —
  `frontend-design`'s named tell ("meta strings joined with middle dots") and a real scanning defect
  at the same time.
- **A row is named by something the seller can recognise.** 「제목 없는 문의」 was rendered at the
  row's largest weight while the customer's actual sentence sat under it in muted: the loudest thing
  on the row was a statement that a database field is empty. Nothing new is read — when the channel
  gave no title, the sentence *already on the row* becomes its name.
- **Waiting time is a measure, not an alarm.** 「3673일째 대기」 in warn orange, three times, was the
  loudest thing on the morning screen. Colour in this product means state — "look before acting" —
  and a waiting count is not a state. It is still the reason the row is ordered where it is, so it
  stays the emphasised fact on its line, in ink.

---

## §4 The handoff

The step card that hands the seller to the seller center was a card, containing a grey rounded card,
containing the button that unblocks everything. **One task surface now**: the pairing block is set
into the card it belongs to with a rule, and the ways out (「계속 확인하기」, 「파일로 직접 올리기」)
share one row instead of stacking — they are alternatives, and an alternative sits beside the thing it
is an alternative to, not under it like a next step.

One real accessibility defect was found by reading that card's code: its 「도우미 연결하기」 button was
`bg-brand` with white text — **3.71:1**, under AA, on the single control that unblocks the whole step.
It is `brand-700` (5.41:1) with the product's darkening hover.

---

## §5 The composer, and the morning

- The composer and the context bar above it are **one surface**: same paper, one outline, divided by
  a hairline, carrying the one shadow in the shell. The context bar used to be a grey band on top of
  a white box — the "별도 admin toolbar" the brief warns about, drawn literally.
- **Example prompts and suggestion chips are sentences, not buttons.** White bordered pills on white
  paper read as controls of equal weight to the real ones; they are canvas-filled, softly cornered,
  and quiet.
- **Before the first message the morning screen is one composition.** The briefing was anchored to
  the top with ~470px of empty paper between what the seller reads and where they answer. An empty
  thread now centres its lead in the space above the box; once the thread has turns it is a
  transcript again and reads from the top.
- The seller's own bubble is `canvas`, not a brand tint — the accent is spent on things you press,
  and alignment already says which side is theirs.

---

## §6 The rail

`bg-canvas`, so the conversation beside it is the lit surface. An active destination is the **raised**
row (`bg-surface`), which carries the same information the blue fill did with one less colour spent on
chrome. The thread list is history, not navigation: `xs`, capped at 8, and the current thread is
marked by an accent **rule** rather than a filled blue row — a filled row is the strongest thing the
rail can draw and it was being spent on "you are already here". 「연결 문제 N건」 keeps its place and
its warn colour and stops being semibold `sm`.

---

## §7 Tokens

Three additions, no removals, **no new colours**:

- `fontSize.prose` — 17/1.75, the assistant's voice (§2).
- `boxShadow.composer` — the one elevation (§1).
- `maxWidth.thread` — 720px, the reading measure (§2).

Radius, spacing, semantic colour, hover/focus and motion are unchanged; the existing `motion` tokens
and the `reducedMotion="user"` contract are untouched.

---

## Verification

| | |
|---|---|
| frontend | **2,644** tests · 222 files · 0 failures · typecheck clean |
| backend · agent-runtime · collector | not touched by this package |
| browser | real Demo Org, 1440 / 1366 / 1152, before/after, flows A–G |

---

## Reported, not fixed

- **The acquisition completion is still a paragraph of five numbers.** The brief asks for a hierarchy
  a seller reads in two seconds; the four facts (기간 · 새 리뷰 · 중복 · 실패) arrive as ONE composed
  string from the runtime, and the only way for the frontend to lay them out is to parse a sentence
  this repository composed — which is the thing this codebase refuses to do everywhere else. What is
  needed is a structured result the runtime already holds: the backend endpoint returns
  `{periodStart, periodEnd, rowsNew, rowsDuplicate, rowsFailed}` and `acquisitionSummary()` reads it
  before flattening it. That is an agent-runtime + conversation-contract change, which this package
  is frozen out of.
- **A broken window renders in the claim sentence.** The resumed completion turn read
  「… 리뷰 중 **0000-00-00~9999-99-99**에 작성된 리뷰는 50건입니다」. Sentinel dates reaching a seller's
  screen is a real defect, and it is in the runtime's claim ladder (frozen here).
- **`/agent`, the contextual panel and the work-surface pages** inherit the token and primitive
  changes but were not redesigned; the panel is compact and stays on `surface`.
- **QA scaffolding stands**: one conversation fixture in the runtime's file store (Demo Org bucket)
  pointing at the real `9b4e0c6f` acquisition, and a QA-only daily AI quota raise passed as JVM args
  to the local backend. Nothing was written to any marketplace and no product default changed.
