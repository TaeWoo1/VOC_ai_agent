// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProductLanding } from "./ProductLanding";
import { CLOSING, FAQ, HERO, SECTION_ORDER } from "../lib/public/landingContent";
import { expectNoAxeViolations } from "../test/axe";

const FORM_URL = "https://forms.example.test/diagnosis";

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductLanding />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ProductLanding — narrative structure", () => {
  it("renders every section, in the order the content module declares", () => {
    const { container } = renderPage();
    const ids = Array.from(container.querySelectorAll("section[id]")).map((el) => el.id);
    expect(ids).toEqual([...SECTION_ORDER]);
  });

  it("opens on the seller's situation, not on the product", () => {
    renderPage();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe(HERO.titleLines.join(""));
    // The product is not named in the opening headline — the reader is.
    expect(headings[0].textContent).not.toContain("SellerOps");
  });

  it("gives each section a single second-level heading", () => {
    const { container } = renderPage();
    // Hero carries the h1; every other section contributes exactly one h2.
    expect(container.querySelectorAll("h2")).toHaveLength(SECTION_ORDER.length - 1);
  });

  it("closes on what the seller receives", () => {
    renderPage();
    const closing = document.getElementById("closing");
    expect(closing).not.toBeNull();
    for (const item of CLOSING.deliverables) {
      expect(within(closing as HTMLElement).getByText(item)).toBeInTheDocument();
    }
  });

  it("renders the FAQ as native disclosure elements", () => {
    const { container } = renderPage();
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(FAQ.items.length);
    // Closed by default — the section is scannable before it is readable.
    for (const el of Array.from(details)) {
      expect(el.open).toBe(false);
    }
  });
});

describe("ProductLanding — CTAs", () => {
  it("repeats the same primary CTA wording at the top and the bottom", () => {
    vi.stubEnv("VITE_DIAGNOSIS_FORM_URL", FORM_URL);
    renderPage();
    const ctas = screen.getAllByRole("link", { name: /무료 운영 진단 받기/ });
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) {
      expect(cta).toHaveAttribute("href", FORM_URL);
      expect(cta).toHaveAttribute("target", "_blank");
      expect(cta).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("routes every demo CTA to the demo-flagged login", () => {
    vi.stubEnv("VITE_DIAGNOSIS_FORM_URL", FORM_URL);
    renderPage();
    const demos = screen.getAllByRole("link", { name: "데모 화면 보기" });
    expect(demos).toHaveLength(2);
    for (const demo of demos) {
      expect(demo).toHaveAttribute("href", "/login?demo=1");
    }
  });

  it("ships no dead primary button when no form URL is configured", () => {
    vi.stubEnv("VITE_DIAGNOSIS_FORM_URL", "");
    renderPage();
    expect(screen.queryAllByRole("link", { name: /무료 운영 진단 받기/ })).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "데모 화면 보기" })).toHaveLength(2);
  });
});

describe("ProductLanding — rendered page honesty", () => {
  it("shows no measured claim or social proof", () => {
    vi.stubEnv("VITE_DIAGNOSIS_FORM_URL", FORM_URL);
    const text = renderPage().container.textContent ?? "";
    // Step numerals are legitimate; asserted claims are not.
    for (const pattern of [/\d+\s*%/, /\d+\s*배\b/, /\d+\s*시간\s*(단축|절약)/]) {
      expect(text).not.toMatch(pattern);
    }
    for (const token of ["고객사", "도입 사례", "만족도", "평점"]) {
      expect(text).not.toContain(token);
    }
  });

  it("names no marketplace", () => {
    const text = renderPage().container.textContent ?? "";
    for (const token of ["네이버", "쿠팡", "카페24", "11번가", "지마켓", "옥션"]) {
      expect(text).not.toContain(token);
    }
  });

  it("uses the confirmed seller-facing import name", () => {
    const text = renderPage().container.textContent ?? "";
    expect(text).toContain("정기 자료 가져오기");
    expect(text).not.toContain("엑셀 업로드");
  });
});

describe("ProductLanding — page metadata", () => {
  it("sets the title and description while mounted, and restores them on unmount", () => {
    const beforeTitle = document.title;
    const { unmount } = renderPage();
    expect(document.title).toContain("SellerOps");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
    ).toContain("문의와 리뷰");
    unmount();
    expect(document.title).toBe(beforeTitle);
  });
});

describe("ProductLanding — accessibility", () => {
  it("has no axe violations", async () => {
    vi.stubEnv("VITE_DIAGNOSIS_FORM_URL", FORM_URL);
    const { container } = renderPage();
    await expectNoAxeViolations(container);
  });
});
