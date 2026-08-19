// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CONSENT_KEY, clearConsent, consentPolicy, readConsent, writeConsent } from "./consent";
import { ConsentProvider, useConsent } from "./ConsentProvider";
import { ConsentBanner } from "./ConsentBanner";
import { analytics } from "../analytics";

afterEach(() => clearConsent());

/** docs/service_readiness_v1.md §2-4: policy, storage, and the banner → analytics link. */
describe("consent", () => {
  it("policy: banner only when an analytics vendor is configured (or forced)", () => {
    expect(consentPolicy({})).toBe("not-applicable");
    expect(consentPolicy({ VITE_GTM_ID: "GTM-ABC123" })).toBe("banner");
    expect(consentPolicy({ VITE_POSTHOG_KEY: "phc" })).toBe("banner");
    expect(consentPolicy({ VITE_CONSENT_BANNER: "always" })).toBe("banner");
    // A malformed container id builds no sink (sinksFromEnv) → nothing to consent to.
    expect(consentPolicy({ VITE_GTM_ID: "G-12345" })).toBe("not-applicable");
  });

  it("stores a versioned decision and ignores a foreign one", () => {
    expect(readConsent()).toBeNull();
    writeConsent({ analytics: true, marketing: false }, localStorage, new Date("2026-08-19T00:00:00Z"));
    expect(readConsent()).toEqual({ version: 1, analytics: true, marketing: false, decidedAt: "2026-08-19T00:00:00.000Z" });
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: 99, analytics: true }));
    expect(readConsent()).toBeNull();
    localStorage.setItem(CONSENT_KEY, "{not json");
    expect(readConsent()).toBeNull();
  });

  it("banner: absent under not-applicable, present until a decision, and the decision reaches the analytics layer", () => {
    const { unmount } = render(
      <MemoryRouter>
        <ConsentProvider env={{}}>
          <ConsentBanner />
        </ConsentProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    render(
      <MemoryRouter>
        <ConsentProvider env={{ VITE_GTM_ID: "GTM-ABC123" }}>
          <ConsentBanner />
        </ConsentProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog", { name: "분석 도구 사용에 동의해 주세요" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "직접 선택" }));
    expect(screen.getByLabelText(/필수/)).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/마케팅/));
    fireEvent.click(screen.getByRole("button", { name: "선택 저장" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readConsent()).toMatchObject({ analytics: true, marketing: true });
    expect(analytics.consent).toEqual({ analytics: true, marketing: true });
  });

  it("a decided visitor can reopen the banner (footer 쿠키·분석 설정) — the decision is forgotten until re-made", () => {
    writeConsent({ analytics: true, marketing: true });
    function Reopen() {
      const { reopen, pending } = useConsent();
      return <button onClick={reopen}>{pending ? "pending" : "reopen"}</button>;
    }
    render(
      <MemoryRouter>
        <ConsentProvider env={{ VITE_GTM_ID: "GTM-ABC123" }}>
          <Reopen />
          <ConsentBanner />
        </ConsentProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(readConsent()).toBeNull();
    expect(analytics.consent).toEqual({ analytics: false, marketing: false });
  });

  it("banner: 필수만 사용 refuses both optional categories", () => {
    render(
      <MemoryRouter>
        <ConsentProvider env={{ VITE_CONSENT_BANNER: "always" }}>
          <ConsentBanner />
        </ConsentProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "필수만 사용" }));
    expect(readConsent()).toMatchObject({ analytics: false, marketing: false });
    expect(analytics.consent).toEqual({ analytics: false, marketing: false });
  });

  it("banner without a provider renders nothing (an App rendered alone in a test)", () => {
    render(
      <MemoryRouter>
        <ConsentBanner />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
