import type { Config } from "tailwindcss";

// Toss-like clean foundation: large readable type, soft cards, calm palette.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#3182F6",
          50: "#EAF2FE",
          600: "#2272EB",
          700: "#1B64DA",
          // The HOVER value for a solid primary, and it is darker than the resting one on purpose.
          // `brand-600` was the hover, and white on #2272EB measures 4.49:1 — under AA by a hundredth,
          // on the most-pressed control in the product. A hover that lightens a solid button has to
          // walk toward the text colour; darkening walks away from it, so the state that invites the
          // press is also the readable one. #1550B5 measures 7.38:1 against white.
          800: "#1550B5",
        },
        surface: "#FFFFFF",
        canvas: "#F2F4F6",
        ink: "#191F28",
        // Darkened from #6B7684 (Executive-friendly UX Redesign v1). The old value measures
        // 4.19:1 against `canvas` (#F2F4F6) — below WCAG AA 4.5:1 — and nearly every supporting
        // sentence in the product is muted-on-canvas. #4E5968 measures 7.0:1 on surface and
        // 6.3:1 on canvas, so the same words survive a 50-year-old pair of eyes.
        muted: "#4E5968",
        line: "#E5E8EB",
        // Darkened from #15803D for the same reason `warn` was (Executive Readiness Fix v1): the
        // green words in this product sit on a `good/10` tint — 「연결됨」, 「최신」, 「외부 발송 없음」
        // — and there the old value measured 4.0:1 against a canvas card, under AA. #12662F measures
        // 7.1:1 on surface and 5.6:1 on its own tint over canvas.
        good: "#12662F",
        // Darkened from #B45309 (Executive Readiness Fix v1). The old value is fine as text on a
        // plain surface (5.0:1) but the product's attention words sit on a `warn/10` tint — the
        // 「확인 필요」 chip, the connection signal — and there it measured 4.39:1, under AA. It was
        // the badge introduced by the previous package that failed. #92400E measures 7.1:1 on
        // surface, 6.4:1 on canvas and 6.2:1 on its own tint, so one token closes every case.
        warn: "#92400E",
        // Darkened from #DC2626 for the third time in this family's story and the same reason
        // (Agent Object + First-use Closure v1): the negative words sit on a `bad/10` tint — the
        // 「부정」 chip on a review row — and there the old value measured 4.49:1 against canvas,
        // under AA by a hundredth. It surfaced the moment a review list drew a negative row beside
        // the anchored review. #B91C1C measures 6.5:1 on surface, 6.1:1 on canvas and 5.2:1 on its
        // own tint, so one token closes the chip, the word and the bar.
        bad: "#B91C1C",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Apple SD Gothic Neo",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        // Larger-than-default scale for 40-50+ operators.
        //
        // `xs` and `sm` were left at the Tailwind defaults (12px/1.33, 14px/1.43) while `base` was
        // raised to 17px — so the gap between a headline and the line under it grew instead of the
        // whole scale moving. Metadata is where this product says what it does NOT know, and 12px
        // is where that stops being read.
        // Reviewnary Product UI Redesign v1 (docs/reviewnary_design.md §1). `base` 16 is the floor for
        // 40-50대 eyes; the steps above it are tighter than before so a page title no longer competes
        // with the briefing sentence, and metadata (`sm`) is still a size that is read.
        xs: ["13px", "1.5"],
        sm: ["15px", "1.6"],
        base: ["16px", "1.6"],
        lg: ["18px", "1.5"],
        xl: ["22px", "1.35"],
        "2xl": ["26px", "1.25"],
        "3xl": ["32px", "1.2"],
      },
      // §4: 8px controls (Tailwind `lg`), 10px rows, 12px cards. The 16/20px of the previous shell read
      // as a consumer app; an operations workspace has edges.
      borderRadius: {
        xl: "10px",
        "2xl": "12px",
      },
      width: {
        sidebar: "232px",
      },
      maxWidth: {
        content: "1120px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.04), 0 6px 16px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
