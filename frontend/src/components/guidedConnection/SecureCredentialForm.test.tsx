// @vitest-environment jsdom
// Secure credential entry — privacy is the point (contract §11, §17.4). These tests enforce that the
// Client Secret renders masked, is handed to onSubmit exactly once (trimmed, blanks omitted), never
// touches localStorage, and does not linger in the DOM after submit.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import { SecureCredentialForm } from "./SecureCredentialForm";
import { NAVER_LIKE_TEMPLATE } from "../../lib/guidedConnection";

afterEach(() => vi.restoreAllMocks());

const SECRET = "sup3r-secret-value";

describe("SecureCredentialForm", () => {
  it("masks the secret field and shows the id field as text", () => {
    render(<SecureCredentialForm template={NAVER_LIKE_TEMPLATE} onSubmit={vi.fn()} submitting={false} />);
    expect((screen.getByLabelText(/Client ID/) as HTMLInputElement).type).toBe("text");
    const secret = screen.getByLabelText(/Client Secret/) as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.autocomplete).toBe("off");
  });

  it("submits trimmed secrets once, then clears the inputs — the secret does not linger", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<SecureCredentialForm template={NAVER_LIKE_TEMPLATE} onSubmit={onSubmit} submitting={false} />);

    await user.type(screen.getByLabelText(/Client ID/), "  app-id-123  ");
    const secret = screen.getByLabelText(/Client Secret/) as HTMLInputElement;
    await user.type(secret, SECRET);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ client_id: "app-id-123", client_secret: SECRET });
    // Inputs are cleared immediately, so the secret is not left in the DOM.
    expect(secret.value).toBe("");
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("never writes the secret to localStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    render(<SecureCredentialForm template={NAVER_LIKE_TEMPLATE} onSubmit={vi.fn()} submitting={false} />);
    await user.type(screen.getByLabelText(/Client ID/), "app-id-123");
    await user.type(screen.getByLabelText(/Client Secret/), SECRET);
    await user.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    for (const call of setItem.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  });

  it("keeps the submit button disabled until required fields are filled", async () => {
    const user = userEvent.setup();
    render(<SecureCredentialForm template={NAVER_LIKE_TEMPLATE} onSubmit={vi.fn()} submitting={false} />);
    const button = screen.getByRole("button", { name: "연결 정보 저장" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/Client ID/), "app-id");
    await user.type(screen.getByLabelText(/Client Secret/), SECRET);
    expect(button).toBeEnabled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <SecureCredentialForm template={NAVER_LIKE_TEMPLATE} onSubmit={vi.fn()} submitting={false} />,
    );
    await expectNoAxeViolations(container);
  });
});
