# SellerOps AI — Frontend UI Reference & Design Direction

**Mode:** Reference / design planning only. This document is the deliverable.
No code is written, no UI is redesigned, nothing is installed, nothing is
committed until approved. It records *where to look* and *what to reuse* when UI
work is actually scheduled — it is not itself a build instruction.

> **References, not dependencies.** Coupang/Naver seller centers inform
> *information architecture and workflow*, not pixels. ReactVibe
> (<https://reactvibe.com/>) is a **copy-paste component/reference source**, not
> a required design-system dependency. Do **not** install ReactVibe as a package
> unless a specific block genuinely needs it; prefer adapting selected component
> code into our existing Tailwind component set, and only when it improves the
> real SellerOps workflow.

---

## 1. UI product principle

SellerOps AI is **an operations dashboard, not a flashy landing page.** The
primary users are **40–50+ year-old manufacturing CEOs/operators and
seller-center staff** who open the app to answer one question fast: *"what needs
my attention across my channels today?"*

Principles, in priority order:

1. **Clarity over decoration.** Every screen answers a concrete operational
   question. Motion and visual flourish never compete with the data.
2. **Calm, Toss-like surface** (continuing Phase 1): large legible type, generous
   spacing, rounded cards, restrained palette, semantic status colors.
3. **Workflow-first information hierarchy**, borrowed from mature seller centers:
   the most decision-relevant numbers and the day's action list come first;
   detail tables come on demand.
4. **Reuse, don't reinvent.** Adapt proven blocks (seller-center IA + ReactVibe
   components) instead of designing novel widgets, so effort goes into the
   *operational logic*, not the chrome.
5. **Accessible by default** for older operators (see §6).

---

## 2. What to reference from Coupang / Naver seller centers

Reference the **structure and seller workflow**, not the branding.

- **Top-level "what to do today" framing.** Both surface counts that demand action
  (new/unanswered inquiries, claims, settlement events) before vanity metrics.
  → SellerOps Home leads with action counts, not decoration.
- **Inquiry/CS as a first-class queue.** Seller centers treat 문의/CS as a
  worklist with status (미답변/답변완료) and SLA pressure.
  → SellerOps Inbox mirrors this: a filterable, status-tagged queue.
- **Order/claim lifecycle clarity.** Clear states (신규주문 → 배송 → 정산; 취소/반품/교환
  claims) with date-range filters and export.
  → Orders/Sales page uses explicit states + date-range + export.
- **Settlement/sales separated from order count.** Sellers think in 정산/매출 as a
  distinct lens from order volume.
  → Keep 주문 vs 매출 as distinct cards/series (already done in Phase 1/2).
- **Per-channel / per-product drill-down.** Seller centers let staff pivot by
  product and by channel.
  → Channels page (per-channel health) + Product Issues (per-product) pivots.
- **Dense-but-scannable tables** with sticky headers, sort, and filter for the
  detail layers — *not* on Home.

What **not** to copy: their visual density on landing/overview screens, ad/promo
modules, and cluttered nav. SellerOps overview stays calm and card-first.

---

## 3. What to reference from ReactVibe

Use ReactVibe as a **block library to adapt**, picking only components that map to
a real SellerOps surface (the mapping is §4; the candidate list is §7).

- Treat each as **reference code to adapt** into our Tailwind tokens and DTO
  shapes — match our type scale, palette, and spacing; drop their demo data.
- Keep their **tasteful, subtle motion on state changes** (e.g. a card value
  ticking, a row entering a feed) where it aids comprehension.
- **Strip** anything landing-page-flavored: hero animations, heavy backgrounds,
  text-reveal effects, decorative parallax.
- Prefer their **dashboard card / table / feed / alert / insight / chart** blocks,
  which align with operations UI; ignore marketing-site blocks.

---

## 4. Screen-by-screen UI block mapping

Each screen lists the seller-center IA cue and the ReactVibe block(s) to adapt.
(All §7 names are candidates to adapt, not commitments.)

- **Home dashboard (`/`)**
  - IA: "what to do today" first → action counts, then trends, then breakdowns.
  - Blocks: **Finance Overview** (8 stat cards: 오늘 주문/매출, 신규·미답변 문의,
    신규·부정 리뷰, 긴급 확인, 미처리) · **Compact Activity Feed** (오늘 확인할 일 /
    최근 문의·리뷰) · **Performance Trend Chart** (최근 7일 주문/매출) ·
    **Insight Recommendation Card** (상품별 이슈 TOP, later fed by the analysis
    engine). Subtle count-up on card values only.

- **Channels page (`/channels`)**
  - IA: per-channel connection health + the day's sync state.
  - Blocks: **Entity Management Table** (or the existing card grid) showing each
    channel's status badge, data badges, last-synced, connection health, and the
    priority-aware action. Reinforces that auto-collection is the goal, upload is
    the backup.

- **Upload page (`/upload`)**
  - IA: a focused task form; upload is the fallback path (per Phase 2.5 copy).
  - Blocks: keep the current form; **Structured Data Table** for the result's
    per-row errors; **Compact Activity Feed** for the 최근 업로드 내역 list.
    Minimal motion; no decoration on a utilitarian screen.

- **Inbox (`/inbox`)**
  - IA: unified 문의+리뷰 worklist with status + channel/type filters.
  - Blocks: **Activity Timeline List** (chronological feed) or **Structured Data
    Table** (status-tagged rows) — likely a hybrid: timeline grouping by day,
    rows tagged 미답변/답변완료, negative-review flagging. Row-enter motion only.

- **Orders / Sales (`/orders`)**
  - IA: order vs sales as distinct lenses; date-range; export.
  - Blocks: **Performance Trend Chart** (7-day+ trend, 주문 vs 매출 series) ·
    **Transaction Table** (per-day / per-channel rows, sortable, exportable) ·
    a channel-sales-share breakdown.

- **Product Issues (`/issues`)**
  - IA: per-product issue prioritization (the analysis engine's surface; mock for
    now via `ReviewAnalysisPort`).
  - Blocks: **Insight Recommendation Card** (issue + suggested action, hedged
    wording per the analysis engine's contract) · **Structured Data Table**
    (issues ranked by frequency/severity). Keep insight cards quiet and factual.

- **AI Search (`/search`)**
  - IA: a query box over reviews/inquiries (mock now; RAG later — *not this phase*).
  - Blocks: search field + **Activity Timeline List** / result cards for
    retrieved evidence. No flashy "AI" motion; results read like evidence, not a
    chat toy.

- **Reports (`/reports`)**
  - IA: list of generated/scheduled reports + a generate action (placeholder now).
  - Blocks: **Structured Data Table** (report history) · **Insight Recommendation
    Card** (report summary preview). Generation logic is out of scope here.

- **Alert Settings (`/alerts`)**
  - IA: configure which conditions notify (unanswered-inquiry threshold, negative
    review, sync failure) + delivery channel (placeholder now).
  - Blocks: **Alert Notification List** (current/triggered alerts, incl. future
    connector failure alerts from Phase 3A §5) · settings form rows. Toggles with
    subtle state-change motion only.

---

## 5. Motion usage rules

**Allowed (subtle, meaningful):**
- Number count-up on stat/overview cards when data loads or refreshes.
- Row/item enter-leave on feeds, alert lists, and the upload-history list.
- Gentle state-change transitions (status badge change, toggle, expand/collapse).
- Chart draw-in on first render, kept brief.

**Not allowed inside the authenticated app:**
- Heavy background animations / parallax.
- Hero-section animations.
- Text-reveal / typewriter effects that delay readability.
- Decorative motion that distracts from the operational task.

**Rules:** motion is fast (≤ ~200–250ms), purposeful, and **respects
`prefers-reduced-motion`** (disable non-essential motion when the OS requests it).
If motion doesn't help the operator understand a change, it doesn't ship.

---

## 6. Accessibility / readability rules

- **Large, legible type** (Phase 1 scale: ~16–18px body, ~24–32px card numbers);
  never shrink below comfortable for 40–50+ operators.
- **High contrast** text and status colors; meet WCAG AA contrast.
- **Don't encode meaning by color alone** — pair status colors with a label/icon
  (미답변/실패 etc.), important for older eyes and color-vision differences.
- **Large hit targets** for buttons/toggles; generous spacing.
- **Keyboard navigable** and focus-visible on all interactive elements.
- **Respect `prefers-reduced-motion`** (see §5).
- **Korean-first copy**, plain operator language (per project framing), with
  English-compatible labels where helpful.
- **No blank states** — empty data shows a calm `EmptyState`, never a void.

---

## 7. ReactVibe components to consider (candidates to adapt)

Each is a **candidate**, adapted into our tokens/DTOs, used only where §4 maps it
to a real surface. None is a commitment, and none implies installing a package.

| ReactVibe block | SellerOps use |
|---|---|
| **Finance Overview** | Home 8 stat cards (orders/sales/inquiries/reviews/urgent). |
| **Transaction Table** | Orders/Sales per-day / per-channel sortable, exportable rows. |
| **Entity Management Table** | Channels page connection/health/action table. |
| **Activity Timeline List** | Inbox chronological 문의+리뷰 feed; AI Search results. |
| **Compact Activity Feed** | Home "오늘 확인할 일"; Upload 최근 업로드 내역. |
| **Alert Notification List** | Alert Settings; future connector failure alerts. |
| **Insight Recommendation Card** | Product Issues; Home 상품별 이슈 TOP; Reports preview. |
| **Performance Trend Chart** | Home + Orders 주문/매출 trend (주문 vs 매출 series). |
| **Structured Data Table** | Inbox rows, Product Issues ranking, Reports history, Upload errors. |

---

## 8–10. Scope guardrails

- **8. Do not code yet.** This document changes no source.
- **9. Do not redesign the UI yet.** The Phase 1/2 UI stays as-is until a UI
  slice is explicitly approved.
- **10. Reference/design planning only.** This is a map for future UI work, to be
  picked up when scheduled — not a directive to build now.
