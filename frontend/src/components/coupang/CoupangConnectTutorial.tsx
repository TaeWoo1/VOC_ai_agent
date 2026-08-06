import type { ConnectionStatusView, CredentialTemplateView } from "../../lib/types";
import { relativeTime } from "../../lib/format";
import { HealthBadge } from "../HealthBadge";
import { SecureCredentialForm } from "../guidedConnection/SecureCredentialForm";
import { AdvertisedCallIpPanel } from "../guidedConnection/AdvertisedCallIpPanel";
import {
  COUPANG_TUTORIAL_COPY as C,
  recoveryCopy,
  stepModel,
  type CoupangState,
} from "../../lib/coupangTutorial";

/**
 * Coupang first-connection guided tutorial — a CONTROLLED, presentational component. The engine `state`
 * comes in; sanitized intent (submit / re-verify / re-enter / run-sync / recheck / navigate) goes out. It
 * renders one phase at a time under an always-visible 6-step progress indicator, and hands the secret keys
 * straight to `onSubmitCredentials` — they never enter this component's state, an event, or storage.
 *
 * Side effects (store/test/sync + polling) belong to the container page; this component is offline-testable
 * with no api. The internal returnShippingCenters→ordersheets connection-test fallback is a backend detail
 * the backend already hides behind sanitized reason codes; it is never surfaced here.
 */
export interface CoupangConnectTutorialProps {
  state: CoupangState;
  template: CredentialTemplateView | null;
  busy: boolean;
  advertisedEgressIps: readonly string[];
  /** Real connection health, read after completion (§ step 6). null → the summary block is omitted. */
  connectionStatus: ConnectionStatusView | null;
  /** Live first-sync progress while a sync is watched (initial run or resumed RUNNING). null when idle. */
  syncProgress: { elapsedMs: number; stalled: boolean } | null;
  onSubmitCredentials: (secrets: Record<string, string>) => void;
  onRetest: () => void;
  onReenter: () => void;
  onRunSync: () => void;
  onRecheckSync: () => void;
  onGoToOrders: () => void;
  onViewChannelRuns: () => void;
}

/** Elapsed as m:ss — honest wall-clock, never a fabricated completion percentage. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SYNC_SLOW_AFTER_MS = 3 * 60_000;

export function CoupangConnectTutorial({
  state,
  template,
  busy,
  advertisedEgressIps,
  connectionStatus,
  syncProgress,
  onSubmitCredentials,
  onRetest,
  onReenter,
  onRunSync,
  onRecheckSync,
  onGoToOrders,
  onViewChannelRuns,
}: CoupangConnectTutorialProps) {
  const { phase } = state;
  const steps = stepModel(phase);

  return (
    <div data-testid="connect-coupang" data-phase={phase}>
      <StepIndicator steps={steps} />

      <div className="mt-6">
        {(phase === "connect" || phase === "submitting") && (
          <ConnectStage
            template={template}
            advertisedEgressIps={advertisedEgressIps}
            busy={busy || phase === "submitting"}
            onSubmitCredentials={onSubmitCredentials}
          />
        )}

        {phase === "connect_error" && (
          <ConnectError
            state={state}
            template={template}
            advertisedEgressIps={advertisedEgressIps}
            busy={busy}
            onRetest={onRetest}
            onReenter={onReenter}
          />
        )}

        {phase === "preparing" && <Preparing busy={busy} onRunSync={onRunSync} />}

        {phase === "syncing" && <FirstSyncProgress progress={syncProgress} onRecheck={onRecheckSync} />}

        {phase === "sync_error" && <SyncError busy={busy} onRetry={onRunSync} />}

        {phase === "connected" && (
          <Connected
            connectionStatus={connectionStatus}
            onGoToOrders={onGoToOrders}
            onViewChannelRuns={onViewChannelRuns}
          />
        )}
      </div>
    </div>
  );
}

/** Accessible 6-step progress indicator. Each step carries aria-current on the active one. */
function StepIndicator({ steps }: { steps: ReturnType<typeof stepModel> }) {
  const current = steps.find((s) => s.state === "current");
  return (
    <nav aria-label="쿠팡 연결 단계">
      <p className="sr-only" role="status" aria-live="polite">
        {current ? `${current.n}단계: ${current.label}` : "연결 완료"}
      </p>
      <ol className="flex flex-wrap gap-2" data-testid="coupang-stepper">
        {steps.map((s) => (
          <li
            key={s.n}
            aria-current={s.state === "current" ? "step" : undefined}
            data-state={s.state}
            className={[
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
              s.state === "current"
                ? "border-brand bg-brand/10 font-semibold text-ink"
                : s.state === "done"
                  ? "border-brand/30 bg-brand/5 text-muted"
                  : "border-line text-muted",
            ].join(" ")}
          >
            <span
              aria-hidden="true"
              className={[
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                s.state === "done"
                  ? "bg-brand text-white"
                  : s.state === "current"
                    ? "bg-brand text-white"
                    : "bg-canvas text-muted",
              ].join(" ")}
            >
              {s.state === "done" ? "✓" : s.n}
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Steps 1–3: the WING issuance path, the field explanations, the call-IP registration, and the form. */
function ConnectStage({
  template,
  advertisedEgressIps,
  busy,
  onSubmitCredentials,
}: {
  template: CredentialTemplateView | null;
  advertisedEgressIps: readonly string[];
  busy: boolean;
  onSubmitCredentials: (secrets: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-8">
      <section aria-label="API 키 발급 안내" data-testid="coupang-prereqs" className="space-y-4">
        <div className="rounded-xl border border-line bg-canvas/40 p-4">
          <h3 className="font-semibold text-ink">{C.step1Title}</h3>
          <p className="mt-1 text-sm text-muted break-keep">{C.step1Body}</p>
          <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm text-muted break-keep">{C.step1SelfDev}</p>
        </div>

        <div className="rounded-xl border border-line bg-canvas/40 p-4">
          <h3 className="font-semibold text-ink">{C.step2Title}</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted break-keep">
            <li>{C.step2Vendor}</li>
            <li>{C.step2AccessKey}</li>
            <li>{C.step2SecretKey}</li>
            <li>{C.step2CallIp}</li>
          </ul>
          <div className="mt-3">
            <AdvertisedCallIpPanel ips={advertisedEgressIps} />
          </div>
        </div>
      </section>

      <section aria-label="연결 정보 입력" className="space-y-2">
        <h3 className="text-base font-bold text-ink">{C.step3Title}</h3>
        <p className="text-sm text-muted break-keep">{C.step3Body}</p>
        {template ? (
          <SecureCredentialForm
            template={template}
            onSubmit={onSubmitCredentials}
            submitting={busy}
            heading="쿠팡 Open API 키 입력"
            idPrefix="coupang-cred"
          />
        ) : (
          <p className="text-muted" role="status">
            연결에 필요한 정보를 불러오는 중입니다…
          </p>
        )}
      </section>
    </div>
  );
}

/** connect_error: reason-aware recovery. Re-verify the stored credential, and (when the fix is the key
 *  itself) re-open the form. Never exposes the provider body or the internal test fallback. */
function ConnectError({
  state,
  template,
  advertisedEgressIps,
  busy,
  onRetest,
  onReenter,
}: {
  state: CoupangState;
  template: CredentialTemplateView | null;
  advertisedEgressIps: readonly string[];
  busy: boolean;
  onRetest: () => void;
  onReenter: () => void;
}) {
  const copy = recoveryCopy(state.reasonCode);
  return (
    <div className="space-y-4" data-testid="coupang-connect-error">
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4" role="alert">
        <p className="font-semibold text-ink">{copy.title}</p>
        <p className="mt-1 text-sm text-muted break-keep">{copy.body}</p>
      </div>

      {copy.showIpPanel && <AdvertisedCallIpPanel ips={advertisedEgressIps} showRegisteredAck />}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onRetest} disabled={busy}>
          {copy.retestLabel}
        </button>
        {copy.allowReenter && (
          <button type="button" className="btn-ghost" onClick={onReenter} disabled={busy}>
            {C.reenterCta}
          </button>
        )}
      </div>

      {/* Always allow re-entry as a fallback, even when the reason points elsewhere — the seller may know
          the key is wrong regardless. Rendered only when the primary path did not already offer it. */}
      {!copy.allowReenter && template && (
        <button type="button" className="btn-ghost text-sm" onClick={onReenter} disabled={busy}>
          {C.reenterCta}
        </button>
      )}
    </div>
  );
}

/** Step 4: PREPARING — the credential is verified, but the connection is not complete until the first
 *  sync. One explicit CTA; the honest two-signal distinction is spelled out. */
function Preparing({ busy, onRunSync }: { busy: boolean; onRunSync: () => void }) {
  return (
    <div className="rounded-xl border border-brand/40 bg-brand/5 p-5" data-testid="coupang-preparing">
      <p className="font-semibold text-ink">{C.step4Title}</p>
      <p className="mt-1 text-sm text-muted break-keep">{C.step4Body}</p>
      <button type="button" className="btn-primary mt-4" onClick={onRunSync} disabled={busy}>
        {C.step4Cta}
      </button>
    </div>
  );
}

/** Step 5: first-sync in progress. Honest elapsed clock (aria-hidden so the per-second tick does not spam
 *  the live region) + a static reassurance that a refresh resumes the SAME run. On a poll timeout it offers
 *  a read-only re-check — never a second collection (the backend single-flight would coalesce it anyway). */
function FirstSyncProgress({
  progress,
  onRecheck,
}: {
  progress: { elapsedMs: number; stalled: boolean } | null;
  onRecheck: () => void;
}) {
  if (!progress) {
    return (
      <p className="text-muted" role="status" aria-live="polite" data-testid="coupang-syncing">
        {C.syncBody}
      </p>
    );
  }
  if (progress.stalled) {
    return (
      <div className="space-y-2" data-testid="coupang-syncing">
        <p className="text-sm font-medium text-ink">{C.syncStalledTitle}</p>
        <p className="text-muted break-keep">{C.syncStalledBody}</p>
        <p className="text-sm text-muted" aria-hidden="true">
          {C.syncElapsedLabel}: {formatElapsed(progress.elapsedMs)}
        </p>
        <button type="button" className="btn-primary" onClick={onRecheck}>
          {C.syncRecheckCta}
        </button>
      </div>
    );
  }
  const slow = progress.elapsedMs >= SYNC_SLOW_AFTER_MS;
  return (
    <div className="space-y-2" role="status" aria-live="polite" data-testid="coupang-syncing">
      <p className="text-muted break-keep">{C.syncBody}</p>
      <div className="flex items-center gap-2" aria-hidden="true">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current text-muted" />
        <span className="text-sm text-muted">
          {C.syncElapsedLabel}: {formatElapsed(progress.elapsedMs)}
        </span>
      </div>
      <p className="text-sm text-muted break-keep">{C.syncReassurance}</p>
      {slow && <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-muted break-keep">{C.syncSlowNote}</p>}
    </div>
  );
}

/** Step 5 terminal FAILED: a safe reason + an explicit retry (a single new run, guarded by the page). */
function SyncError({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-danger/40 bg-danger/5 p-4" role="alert" data-testid="coupang-sync-error">
      <p className="font-semibold text-ink">{C.syncErrorTitle}</p>
      <p className="text-sm text-muted break-keep">{C.syncErrorBody}</p>
      <button type="button" className="btn-primary" onClick={onRetry} disabled={busy}>
        {C.syncRetryCta}
      </button>
    </div>
  );
}

/** Step 6: CONNECTED. The first sync succeeded → the connection is complete. Show the real health + the
 *  two Operations entry points (orders, and the channel's connection/collection history with the run). */
function Connected({
  connectionStatus,
  onGoToOrders,
  onViewChannelRuns,
}: {
  connectionStatus: ConnectionStatusView | null;
  onGoToOrders: () => void;
  onViewChannelRuns: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="coupang-connected">
      <div className="rounded-xl border border-brand/40 bg-good/10 p-5" role="status">
        <p className="font-semibold text-ink">{C.connectedTitle}</p>
        <p className="mt-1 text-sm text-muted break-keep">{C.connectedBody}</p>
      </div>

      {connectionStatus && (
        <div className="space-y-2 rounded-lg bg-canvas px-4 py-3" role="status">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted">{C.connectionStateLabel}</span>
            <HealthBadge state={connectionStatus.state} />
          </div>
          <p className="text-sm text-muted">
            {C.lastCollectedLabel}:{" "}
            {connectionStatus.lastSuccessAt ? relativeTime(connectionStatus.lastSuccessAt) : C.none}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onGoToOrders}>
          {C.goToOrders}
        </button>
        <button type="button" className="btn-ghost" onClick={onViewChannelRuns}>
          {C.viewChannelRuns}
        </button>
      </div>
    </div>
  );
}
