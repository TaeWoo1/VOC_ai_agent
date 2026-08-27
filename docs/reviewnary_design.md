# reviewnary Design Contract v1

**Status:** 2026-08-27 · Agent Command Center v1 §10 · `frontend/` only · **not a token migration**

This is a written record of the design decisions this product has already made, so the next screen
does not re-decide them. It describes what is **in the code today** (`frontend/tailwind.config.ts`,
`src/components/ui/`) plus the rules the last three UX packages arrived at. Nothing here is
aspirational; a rule that the code does not follow is marked as such.

**It is not a design system rewrite.** No new palette, no new type family, no new component library,
no token renaming. The rules below are constraints on new work.

---

## 0. Who this is for

A **40–50대 non-technical owner of a small manufacturing/selling company**, on a desktop browser,
often at 110–125% zoom, glancing at the screen between other work.

The pass mark, unchanged since Executive-friendly UX Redesign v1: **in 30 seconds, can they see
what the situation is, what the problem is, what the AI did, and what they should press?**

Two consequences that outrank every other rule in this document:

1. **A number that means an obligation must be true.** A count that includes rows the product
   manufactured about itself is not a design problem, it is a lie with good kerning.
2. **A screen may not require reading to be understood.** Weight, size and order carry the meaning
   first; sentences confirm it.

---

## 1. Typography

One family: **Pretendard**, falling back to the platform Korean sans stack. No second face, no
monospace in product UI (a chunk address in a monospace box is exactly the thing this product
removed from the inquiry screen).

The scale is already raised for older eyes. Do not add a step below `xs`.

| Token | Size / line-height | Used for |
|---|---|---|
| `3xl` | 34 / 1.2 | a single hero number, rarely |
| `2xl` | 28 / 1.3 | **the briefing sentence**, page titles |
| `xl` | 22 / 1.4 | section titles that carry a count |
| `lg` | 19 / 1.5 | the customer's question, the draft, a state card's headline |
| `base` | 17 / 1.6 | body, list rows, buttons |
| `sm` | 15 / 1.6 | supporting sentences, metadata that is still read |
| `xs` | 13 / 1.5 | badges, table captions — **never** a sentence that carries a fact |

**Korean line breaking:** every element holding a Korean sentence carries `break-keep`. Korean
breaks mid-word without it and the result is unreadable at a glance.

---

## 2. Spacing rhythm

Tailwind's 4px scale, used at four levels and no more:

- `gap-1 / gap-2` (4–8px) — inside a row: chip to label, icon to text
- `space-y-3` (12px) — inside a card
- `space-y-5` (20px) — between the groups of one section
- `space-y-8` (32px) — between sections of a page

A page is `space-y-8`; a section is `space-y-2`/`space-y-3`; a card is `p-4`/`p-5`. Anything else
is a decision that has to justify itself.

---

## 3. Content width and layout

- The app shell owns the max width; a page does not set its own.
- Two-pane work surfaces are `[fixed list | flexible detail]` (문의 uses `340px | rest`), and the
  **list column scrolls inside itself** — a work screen whose document is 11,000px tall is a screen
  nobody reaches the bottom of.
- Grids are `lg:grid-cols-3` at most. Four equal cards read as wallpaper.
- Wide content (tables, code, diagrams) scrolls inside its own container. The page body never
  scrolls horizontally.

---

## 4. Surface hierarchy

Three surfaces, and their meanings are fixed:

| Token | Value | Means |
|---|---|---|
| `canvas` | `#F2F4F6` | the page behind everything; also a quiet inline chip |
| `surface` | `#FFFFFF` | a card — something with its own edges and its own subject |
| `line` | `#E5E8EB` | the edge of a card, the rule between rows |

**A card is a promise that its contents belong together.** A list of five findings is five *rows*
inside one card, not five cards — five equally-weighted cards is the layout failure the UX audit
named by name.

Radius: `xl` (16px) for rows and inputs, `2xl` (20px) for cards. Shadow: `shadow-card` only, and
only where a card floats above content (a drawer, a popover). Flat cards on canvas need no shadow.

---

## 5. CTA hierarchy

**One primary control per screen region, and it owns its own line.**

| Level | Shape | Rule |
|---|---|---|
| Primary | `Btn variant="solid"` (brand fill, white text) | at most one per region; the irreversible one sits next to a confirmation step, never next to the text it would send |
| Secondary | `Btn variant="outline"` | as many as needed, all the same weight |
| Tertiary | `Btn variant="ghost"` / a plain link | reference, navigation, "see all" |

Rules learned the hard way:

- **A repeated CTA is no CTA.** Three rows each carrying 「AI에게 묻기」 is zero calls to action.
- **A disabled primary is neutralised**, not brand-coloured — a blue button that does nothing reads
  as broken, not as unavailable.
- **Hover on a solid primary darkens** (`brand-700` → `brand-800`), never lightens. Lightening walks
  the fill toward the white text: `brand-600` under white measures **4.49:1**, under AA, on the most
  pressed control in the product and in the exact state a cursor is in while the label is being read.
  `brand-800` (`#1550B5`) measures 7.38:1. Measured in a real browser, composited, 2026-08-27.
- Minimum control height **36px**; a primary button **44px**.

---

## 6. State colours

Colour is **never the only carrier**. Every state that has a colour also has a word.

| Token | Value | Means | Measured contrast |
|---|---|---|---|
| `good` | `#12662F` | this is settled / grounded | 7.1:1 on surface, 5.6:1 on its own tint |
| `warn` | `#92400E` | read this before acting | 7.1:1 on surface, 6.2:1 on its own tint |
| `bad` | `#DC2626` | this failed / this is negative | reserved for failure and negative reviews |
| `muted` | `#4E5968` | supporting text | 7.0:1 on surface, 6.3:1 on canvas |
| `ink` | `#191F28` | any sentence that carries a fact | — |

**`good` is narrow on purpose.** On the inquiry screen it means `GROUNDED` and nothing else: a
clarification question is a correct reply that still needs the seller's eye, so it is `warn`.

Tints are `/5` for a card background and `/10` for a chip. A coloured word must be checked **on its
own tint**, which is where every one of this product's contrast failures has been found.

---

## 7. The Agent briefing

The home screen opens with one sentence and then the work it counts.

- **The sentence is arithmetic.** It counts the objects rendered under it. No model is called to
  produce it, and the dashboard keeps working when the day's AI budget is gone.
- **It speaks like a person, not a log.** 「오늘 먼저 확인하면 좋은 일이 3개 있습니다」 — never
  「3개의 proactive case를 탐지했습니다」, never an enum, never a count of our own rows.
- **Zero gets its own sentence.** 「지금 먼저 확인할 일은 없습니다」, not 「0개 있습니다」.
- **Agentic-ness is behaviour, not decoration.** It looked first, it says why, it produced the
  object, it has the next action ready. No gradient, no glow, no neon, no chat bubbles.

---

## 8. Structured object cards

An operational object on a briefing or a command result carries **four things and no fifth**:

1. one sentence of what it is, in the seller's words
2. the minimum context for why it is here
3. a deterministic count or status
4. one primary action

No Agent prose, no explanation of how it was found, no internal identifier. If a fact needs a
paragraph, it belongs on the screen that owns it.

---

## 9. Evidence disclosure

Progressive, and the order is fixed: **conclusion → first evidence open → the rest collapsed.**

- The first citation shows source, title and excerpt. The rest collapse behind a one-line summary.
- The excerpt is the sentence the drafter actually read.
- **Chunk addresses, locators, evidence ids, provenance strings and model names never render.**
- A collapsed section uses `Disclosure`, which draws a chevron. An affordance that is only a
  cursor change is not an affordance.

---

## 10. Empty · loading · error

| State | Rule |
|---|---|
| Empty | Say what would appear here and offer the one action that would make it appear. Never 「데이터 없음」. |
| Nothing to report | Render **nothing**. A section that announces its own absence costs a glance on every visit. |
| Loading | One line of text (`불러오는 중…`). No skeleton that shifts layout when it resolves. |
| Error | Say what could not be read and what still works. Never a status code, never a stack. |
| Unknown | `—`, never `0`. A dash reads as "we do not know"; a zero reads as "there were none". |

---

## 11. Accessibility

- **AA on every text node**, measured, including on tints **and including hover**. Every contrast
  failure this product has had was on a coloured background or in a non-resting state; none was ever
  found by reading the palette.
- Visible focus everywhere: `focus-visible:ring-2 ring-brand-700`. Focus rings are never removed.
- Every icon-only control has an accessible name; every colour-coded state has an `sr-only` word.
- `aria-label` on each page section that a screen reader would otherwise meet unnamed.
- Controls are keyboard reachable in reading order; a card whose whole row is a link has exactly
  one tab stop.

---

## 12. Responsive

- Desktop-first is the honest description of this product, but nothing may break below it.
- Breakpoints: default (mobile), `sm`, `lg`. No custom breakpoints.
- Two-pane surfaces collapse to a single column below `lg`; the list is the default view and a
  selection opens the detail.
- Relative units for anything that holds text; fixed px only for a list column's width.

---

## 13. What this document does not authorise

- A new colour, a new font, a new component library, or a renamed token.
- Landing-page patterns inside the operations UI (oversized hero, animated gradient, marquee).
- A generic card framework. The components in `src/components/ui/` are the framework.
- Any visual that implies the product did something it did not do — an "AI가 분석 중" animation
  where no model runs, a progress bar with no measurable progress, a green check for an action that
  was only saved locally.

## 14. Reference patterns

External component galleries (21st.dev and similar) may be **read for patterns** — command input,
list/table, status chip, drawer, card. What is copied is the pattern, never the dependency and
never the styling: this product's tokens, spacing and copy rules win in every case. No component
library was added by this package.
