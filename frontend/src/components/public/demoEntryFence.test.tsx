// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * <b>A deployment with no demo fixture offers no way into one</b> — Pilot Runtime Foundation v1
 * §2 / §15-C.
 *
 * <p>The 「데모 화면 보기」 entry prefills `demo@sellerops.ai`, an account whose password is written
 * down in this repository. On a pilot or production deployment that account is not created, so the
 * entry is a pointer at a login that does not exist — and the prefill is a form arriving filled with
 * somebody else's credentials. The decision used to be made entirely in the browser; it is now the
 * deployment's answer, and <b>not knowing counts as no</b>.
 */
const state = { value: null as boolean | null };
vi.mock("../../hooks/useDemoEntry", () => ({ useDemoEntry: () => state.value }));
vi.mock("../../lib/public/publicCta", async (orig) => {
  const mod = await orig<typeof import("../../lib/public/publicCta")>();
  return { ...mod, diagnosisFormUrl: () => null };
});

import { PublicHeader } from "./PublicHeader";
import { LandingCtaButtons } from "./LandingCtaButtons";

function renderBoth() {
  return render(
    <MemoryRouter>
      <PublicHeader />
      <LandingCtaButtons />
    </MemoryRouter>,
  );
}

describe("§15-C — the demo entry follows the deployment", () => {
  it("a demo deployment shows it", () => {
    state.value = true;
    renderBoth();
    expect(screen.getAllByRole("link", { name: "데모 화면 보기" }).length).toBeGreaterThan(0);
  });

  it("a pilot deployment shows none of it", () => {
    state.value = false;
    renderBoth();
    expect(screen.queryByRole("link", { name: "데모 화면 보기" })).toBeNull();
  });

  it("and while the answer is still outstanding it shows none of it either", () => {
    // The fence has to hold in the state that lasts a whole round trip, not only after it.
    state.value = null;
    renderBoth();
    expect(screen.queryByRole("link", { name: "데모 화면 보기" })).toBeNull();
  });
});
