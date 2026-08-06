import { useState, type FormEvent } from "react";
import type { CredentialTemplateView } from "../../lib/types";

/**
 * Secure Client ID / Secret entry for the NAVER guided connection (contract §11, §17.4).
 *
 * Mirrors ChannelDetail's `CredentialEntryForm` discipline and hardens it for the wizard:
 *  - secret fields render as `type="password"`; nothing is auto-filled (`autoComplete="off"`);
 *  - values live ONLY in local component state while typing and are handed to `onSubmit` — they are
 *    NEVER written to localStorage, a log, an analytics call, or a data attribute;
 *  - the payload is trimmed and blank optionals are omitted, matching the connector's expected shape;
 *  - on a failed submit the secret is NOT echoed back as text — the parent shows a safe reason only,
 *    and the controlled inputs are cleared so a stale secret never lingers in the DOM.
 *
 * Success/registration copy is owned by the parent phase (`credential_registration`) — this form makes
 * no connection claim of its own.
 */
export function SecureCredentialForm({
  template,
  onSubmit,
  submitting,
  heading = "애플리케이션 ID·시크릿 입력",
  idPrefix = "naver-cred",
}: {
  template: CredentialTemplateView;
  onSubmit: (secrets: Record<string, string>) => void;
  submitting: boolean;
  /** Form heading — defaults to the NAVER wording; other channels (e.g. Coupang) pass their own. */
  heading?: string;
  /** Input id namespace so multiple channels' forms never collide on element ids. */
  idPrefix?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const requiredFilled = template.fields
    .filter((f) => f.required)
    .every((f) => (values[f.key] ?? "").trim().length > 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const secrets: Record<string, string> = {};
    for (const field of template.fields) {
      const value = (values[field.key] ?? "").trim();
      if (value.length > 0) secrets[field.key] = value;
    }
    // Clear the controlled inputs immediately: the values are captured in `secrets` for this one
    // submit and must not linger in the DOM (esp. the Client Secret) regardless of the outcome.
    setValues({});
    onSubmit(secrets);
  }

  return (
    <form className="space-y-4 rounded-xl border border-line bg-canvas/40 p-4" onSubmit={submit}>
      <h3 className="text-base font-bold text-ink">{heading}</h3>
      {template.fields.map((field) => (
        <div key={field.key}>
          <label htmlFor={`${idPrefix}-${field.key}`} className="mb-1.5 block text-base font-semibold text-ink">
            {field.label}
            {field.required ? null : <span className="ml-2 text-sm font-normal text-muted">(선택)</span>}
          </label>
          <input
            id={`${idPrefix}-${field.key}`}
            type={field.secret ? "password" : "text"}
            value={values[field.key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            required={field.required}
            autoComplete="off"
            className="w-full rounded-xl border border-line px-4 py-2.5 text-base focus:border-brand focus:outline-none"
          />
          {field.helpText ? <p className="mt-1 text-sm text-muted">{field.helpText}</p> : null}
        </div>
      ))}
      <p className="text-sm text-muted">
        입력한 정보는 암호화되어 저장됩니다. 시크릿은 저장 후 다시 표시되지 않으며, 화면·로그에 남지 않습니다.
      </p>
      <button type="submit" disabled={submitting || !requiredFilled} className="btn-primary">
        {submitting ? "저장 중…" : "연결 정보 저장"}
      </button>
    </form>
  );
}
