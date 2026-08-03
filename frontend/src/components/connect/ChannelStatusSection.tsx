// Extracted VERBATIM from the previous single-file 채널 상세 page — the component bodies below are
// the same code that drove the live-verified connection and collection flows. Only the file they
// live in changed; no call, no order, no condition was rewritten.
import { type FormEvent, useState } from "react";
import { Section } from "../Section";
import { HealthBadge } from "../HealthBadge";
import { api } from "../../lib/apiClient";
import { relativeTime, untilTime } from "../../lib/format";
import type {
  ConnectionInfoView,
  ConnectionStatusView,
  ConnectionTestResultView,
  CredentialFieldView,
  CredentialTemplateView,
} from "../../lib/types";
import {
  GENERIC_GUIDANCE,
  CHANNEL_GUIDANCE,
  TITLE_CLS,
  authTypeLabel,
  backendMessage,
  expiryLabel,
  nextActionFor,
  type NextAction,
  type ScrollTarget,
} from "./channelShared";

/** 연결 상태 — health figures plus the last failure the server reported. */
export function ChannelStatusSection({
  status,
  loading,
  error,
}: {
  status: ConnectionStatusView | null;
  loading: boolean;
  error: boolean;
}) {
  return (
    <Section title="연결 상태">
      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          연결 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 text-base md:grid-cols-3">
            <div>
              <p className="text-sm text-muted">마지막 수집</p>
              <p className="mt-1 font-semibold">
                {status?.lastSyncedAt ? relativeTime(status.lastSyncedAt) : "수집 이력 없음"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">다음 자동 수집</p>
              <p className="mt-1 font-semibold">
                {status?.nextScheduledAt ? untilTime(status.nextScheduledAt) : "예약 없음"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">연속 실패</p>
              <p
                className={`mt-1 font-semibold ${
                  status && status.consecutiveFailures > 0 ? "text-warn" : ""
                }`}
              >
                {status ? `${status.consecutiveFailures}회` : "-"}
              </p>
            </div>
          </div>
          {status?.lastError ? (
            <p className="mt-4 rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
              {status.lastError}
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

export { HealthBadge, nextActionFor };
export type { NextAction, ScrollTarget, ConnectionStatusView };

export function NextActionPanel({
  action,
  onCta,
}: {
  action: NextAction;
  onCta: (target: ScrollTarget) => void;
}) {
  const { tone, title, guidance, detail, cta } = action;
  return (
    <section className="card">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted">다음 조치</p>
          <p className={`text-xl font-bold ${TITLE_CLS[tone]}`}>{title}</p>
          <p className="text-base text-ink">{guidance}</p>
          {detail ? <p className="text-sm text-muted">{detail}</p> : null}
        </div>
        {cta ? (
          <button
            type="button"
            onClick={() => onCta(cta.target)}
            className="btn-ghost shrink-0"
          >
            {cta.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// Read-only 연결 정보 panel: shows whether masked credential metadata is on file
// and its 갱신/만료, plus calm per-channel guidance. No secret is read or shown,
// no write action, no reconnect form — that flow (연결 정보 갱신) is a later slice.

export function ConnectionInfoSection({
  accountId,
  info,
  loading,
  error,
  channelCode,
  template,
  templateError,
  onViewRuns,
  onReport,
  onChanged,
}: {
  accountId: string;
  info: ConnectionInfoView | null;
  loading: boolean;
  error: boolean;
  channelCode: string | undefined;
  template: CredentialTemplateView | null;
  templateError: boolean;
  onViewRuns: () => void;
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
}) {
  const guidance = (channelCode && CHANNEL_GUIDANCE[channelCode]) ?? GENERIC_GUIDANCE;
  // The entry form needs an API template; manual / file-upload channels (404 →
  // null) get the guidance text only, never a form.
  const canEnter = template !== null && template.fields.length > 0;

  return (
    <Section title="연결 정보">
      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          연결 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : info === null ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-base font-semibold text-ink">등록된 연결 정보가 없습니다.</p>
            <p className="text-base text-muted">{guidance}</p>
          </div>
          {canEnter ? (
            <CredentialEntryForm
              accountId={accountId}
              template={template}
              onReport={onReport}
              onChanged={onChanged}
            />
          ) : null}
        </div>
      ) : (
        <ConnectionInfoDetail
          info={info}
          guidance={guidance}
          onViewRuns={onViewRuns}
          accountId={accountId}
          template={template}
          onReport={onReport}
          onChanged={onChanged}
        />
      )}
      <CredentialTemplateBlock template={template} error={templateError} />
    </Section>
  );
}

// Read-only 연결에 필요한 정보 block: the backend-owned credential field shape for
// this channel. Reference only — labels/helpText/required/secret indicators, never
// an input, a value, or a submit. Omitted entirely when the channel needs no API
// template (404 → null), shown as one calm line on a non-404 read failure.
function CredentialTemplateBlock({
  template,
  error,
}: {
  template: CredentialTemplateView | null;
  error: boolean;
}) {
  if (error) {
    return (
      <div className="mt-6 border-t border-line pt-6">
        <h3 className="text-base font-bold text-ink">연결에 필요한 정보</h3>
        <p className="mt-2 rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          연결에 필요한 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      </div>
    );
  }
  if (template === null || template.fields.length === 0) {
    return null;
  }
  return (
    <div className="mt-6 border-t border-line pt-6">
      <h3 className="text-base font-bold text-ink">연결에 필요한 정보</h3>
      <ul className="mt-3 space-y-3">
        {template.fields.map((field) => (
          <CredentialFieldRow key={field.key} field={field} />
        ))}
      </ul>
    </div>
  );
}

function CredentialFieldRow({ field }: { field: CredentialFieldView }) {
  return (
    <li className="rounded-xl border border-line/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">{field.label}</span>
        <span
          className={`rounded-lg px-2.5 py-1 text-sm font-medium ${
            field.required ? "bg-ink/5 text-ink" : "bg-canvas text-muted"
          }`}
        >
          {field.required ? "필수" : "선택"}
        </span>
        {field.secret ? (
          <span className="rounded-lg bg-warn/10 px-2.5 py-1 text-sm font-medium text-warn">
            민감 정보
          </span>
        ) : null}
      </div>
      {field.helpText ? (
        <p className="mt-1.5 text-sm text-muted">{field.helpText}</p>
      ) : null}
    </li>
  );
}

function ConnectionInfoDetail({
  info,
  guidance,
  onViewRuns,
  accountId,
  template,
  onReport,
  onChanged,
}: {
  info: ConnectionInfoView;
  guidance: string;
  onViewRuns: () => void;
  accountId: string;
  template: CredentialTemplateView | null;
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
}) {
  const expiry = expiryLabel(info.tokenExpiresAt);
  // Re-entry: connection info already exists (incl. expired), so let the operator
  // submit fresh info through the same validated path. Collapsed by default.
  const [reentering, setReentering] = useState(false);
  const canEnter = template !== null && template.fields.length > 0;

  // Manual connection check — auth/connectivity only, click-only (no effect, no
  // auto-run). The result lives in component state for this page session only:
  // never persisted, never logged, and it never mutates the displayed connection
  // status (no onChanged/reload), since a check verifies auth, not collection.
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResultView | null>(null);
  const [testErrored, setTestErrored] = useState(false);
  async function runConnectionCheck() {
    if (checking) {
      return;
    }
    setChecking(true);
    setTestErrored(false);
    try {
      setTestResult(await api.testConnection(accountId));
    } catch {
      // Do not log the error/response body — it may carry provider detail.
      setTestResult(null);
      setTestErrored(true);
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-base font-semibold text-good">✓ 연결 정보가 등록되어 있습니다.</p>
      <div className="grid grid-cols-1 gap-4 text-base md:grid-cols-3">
        <div>
          <p className="text-sm text-muted">인증 방식</p>
          <p className="mt-1 font-semibold">{authTypeLabel(info.authType)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">마지막 갱신</p>
          <p className="mt-1 font-semibold">
            {info.lastRotatedAt ? relativeTime(info.lastRotatedAt) : "갱신 이력 없음"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted">인증 만료</p>
          <p className={`mt-1 font-semibold ${expiry.expired ? "text-bad" : ""}`}>{expiry.text}</p>
        </div>
      </div>
      <p className="text-base text-muted">{guidance}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onViewRuns} className="btn-ghost">
          수집 내역 보기
        </button>
        {canEnter ? (
          <button type="button" onClick={() => setReentering((v) => !v)} className="btn-ghost">
            연결 정보 다시 입력
          </button>
        ) : null}
        {canEnter ? (
          <button
            type="button"
            onClick={runConnectionCheck}
            disabled={checking}
            className="btn-ghost"
          >
            {checking ? "연결 확인 중…" : "연결 확인"}
          </button>
        ) : null}
      </div>
      {testErrored ? (
        <div className="rounded-xl bg-bad/5 px-4 py-3">
          <p className="text-base font-semibold text-bad">연결 확인에 실패했습니다.</p>
        </div>
      ) : testResult ? (
        <ConnectionCheckResult result={testResult} />
      ) : null}
      {reentering && canEnter ? (
        <CredentialEntryForm
          accountId={accountId}
          template={template}
          onReport={onReport}
          onChanged={onChanged}
          onDone={() => setReentering(false)}
        />
      ) : null}
    </div>
  );
}

// Renders a connection-check result from the safe DTO. Auth/connectivity only —
// never implies collection. Copy is frontend-fixed per status (so no raw provider
// string or banned wording can surface); the backend `message` is shown ONLY for
// FAILED, as a muted secondary line (it is a fixed, secret-free, hedged string).
// `reasonCode` is never rendered raw; tokens/secrets/provider bodies are never
// present in this DTO.
function ConnectionCheckResult({ result }: { result: ConnectionTestResultView }) {
  if (result.status === "SUCCESS") {
    return <p className="text-base font-semibold text-good">✓ 연결 정보가 확인되었습니다.</p>;
  }
  if (result.status === "FAILED") {
    return (
      <div className="rounded-xl bg-bad/5 px-4 py-3">
        <p className="text-base font-semibold text-bad">연결 확인에 실패했습니다.</p>
        {result.message ? <p className="mt-1 text-sm text-muted">{result.message}</p> : null}
      </div>
    );
  }
  if (result.status === "NOT_CONFIGURED") {
    return <p className="text-base text-muted">저장된 연결 정보가 없습니다.</p>;
  }
  // UNSUPPORTED (and any unexpected status) — not-yet-supported, fixed copy.
  return <p className="text-base text-muted">이 채널의 연결 확인은 아직 제공되지 않습니다.</p>;
}

// 연결 정보 입력 form: renders one input per backend credential-template field
// (label as primary UI, helpText as helper, secret → masked password input), and
// submits to the validated POST /credentials path. Server-derives
// connectorClass/authType from the template; sends only the fields the operator
// typed (trimmed, blank optionals omitted). On success it reports a save-only
// message ("연결 정보가 저장되었습니다" — NOT a connection-success claim, no
// test-connection exists), clears every field, and triggers a masked-metadata
// re-read. Secret values live only in local state, are never logged, stored, or
// echoed; a backend 400 surfaces the calm (secret-safe) backend message and keeps
// the typed fields so the operator can correct and resubmit.
function CredentialEntryForm({
  accountId,
  template,
  onReport,
  onChanged,
  onDone,
}: {
  accountId: string;
  template: CredentialTemplateView;
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
  onDone?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // UX-only gate (backend validation is the source of truth): every required
  // field non-blank after trim.
  const requiredFilled = template.fields
    .filter((f) => f.required)
    .every((f) => (values[f.key] ?? "").trim().length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) {
      return;
    }
    setSaving(true);
    // Build secrets keyed by field.key: trim every value, omit blank optionals so
    // the payload is exactly the connector's expected shape.
    const secrets: Record<string, string> = {};
    for (const field of template.fields) {
      const value = (values[field.key] ?? "").trim();
      if (value.length > 0) {
        secrets[field.key] = value;
      }
    }
    try {
      await api.storeCredential(accountId, {
        connectorClass: template.connectorClass,
        authType: template.authType,
        secrets,
      });
      setValues({});
      onReport("연결 정보가 저장되었습니다.", false);
      onChanged();
      onDone?.();
    } catch (err) {
      onReport(
        backendMessage(err) ?? "연결 정보 저장에 실패했습니다. 입력 정보를 확인해 주세요.",
        true,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4 rounded-xl border border-line bg-canvas/40 p-4" onSubmit={submit}>
      <h3 className="text-base font-bold text-ink">연결 정보 입력</h3>
      {template.fields.map((field) => (
        <div key={field.key}>
          <label htmlFor={`cred-${field.key}`} className="mb-1.5 block text-base font-semibold text-ink">
            {field.label}
            {field.required ? null : (
              <span className="ml-2 text-sm font-normal text-muted">(선택)</span>
            )}
          </label>
          <input
            id={`cred-${field.key}`}
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
        입력한 정보는 암호화되어 저장됩니다. 저장 후 수집 테스트는 별도 단계에서 확인합니다.
      </p>
      <button type="submit" disabled={saving || !requiredFilled} className="btn-primary">
        {saving ? "저장 중…" : "연결 정보 저장"}
      </button>
    </form>
  );
}

