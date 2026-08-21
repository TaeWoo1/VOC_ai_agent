// @vitest-environment jsdom
/**
 * The panel's whole job is deciding WHO has to act, so that is what these assert.
 *
 * Getting it wrong in either direction is expensive. Telling a seller to reconnect for a server-side
 * key fault wastes their time and fixes nothing — on the canonical demo org exactly that would have
 * happened, after 128 consecutive Cafe24 failures whose real cause was a configuration value the
 * seller has no access to. Telling them to wait for an operator when their token has genuinely
 * expired leaves the connection dead instead.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CredentialDiagnosisPanel } from "./CredentialDiagnosisPanel";

const getCredentialDiagnosis = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  api: { getCredentialDiagnosis: (id: string) => getCredentialDiagnosis(id) },
  getToken: () => null,
}));

function diagnosis(status: string, remedy: string | null) {
  return {
    status,
    keyId: "local-dev-1",
    activeKeyId: "self-pilot-1",
    sealedKeyFingerprint: null,
    availableKeyFingerprint: null,
    lastRotatedAt: null,
    tokenExpiresAt: null,
    remedy,
  };
}

describe("CredentialDiagnosisPanel", () => {
  it("says nothing at all when the credential opens", async () => {
    getCredentialDiagnosis.mockResolvedValueOnce(diagnosis("OK", null));

    const { container } = render(<CredentialDiagnosisPanel accountId="a1" />);

    // A healthy connection carrying a diagnostic panel teaches sellers to read health as a warning.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it.each(["NO_KEY_CONFIGURED", "KEY_NOT_AVAILABLE", "KEY_MISMATCH"])(
    "%s tells the seller this is a server problem and reconnecting will not help",
    async (status) => {
      getCredentialDiagnosis.mockResolvedValueOnce(diagnosis(status, "서버 설정을 확인해 주세요."));

      render(<CredentialDiagnosisPanel accountId="a1" />);

      expect(await screen.findByText("SellerOps 서버 설정 문제입니다")).toBeInTheDocument();
      expect(
        screen.getByText(/판매자가 채널을 다시 연결해도 해결되지 않습니다/),
      ).toBeInTheDocument();
    },
  );

  it("INVALID_CREDENTIAL is the one that really does ask the seller to act", async () => {
    getCredentialDiagnosis.mockResolvedValueOnce(
      diagnosis("INVALID_CREDENTIAL", "자격 증명을 다시 입력해 주세요."),
    );

    render(<CredentialDiagnosisPanel accountId="a1" />);

    expect(await screen.findByText("자격 증명을 다시 확인해야 합니다")).toBeInTheDocument();
    expect(screen.queryByText(/다시 연결해도 해결되지 않습니다/)).not.toBeInTheDocument();
  });

  it("stays silent when the diagnosis itself cannot be read", async () => {
    // This panel explains a failure; it must never become one. The server's own error line is still
    // on screen beside it.
    getCredentialDiagnosis.mockRejectedValueOnce(new Error("network"));

    const { container } = render(<CredentialDiagnosisPanel accountId="a1" />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
