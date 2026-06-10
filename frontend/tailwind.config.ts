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
        },
        surface: "#FFFFFF",
        canvas: "#F2F4F6",
        ink: "#191F28",
        muted: "#6B7684",
        line: "#E5E8EB",
        good: "#15803D",
        warn: "#B45309",
        bad: "#DC2626",
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
        base: ["17px", "1.6"],
        lg: ["19px", "1.5"],
        xl: ["22px", "1.4"],
        "2xl": ["28px", "1.3"],
        "3xl": ["34px", "1.2"],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.04), 0 6px 16px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
