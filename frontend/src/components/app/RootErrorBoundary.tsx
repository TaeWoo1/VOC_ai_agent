import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { sentryActive } from "../../lib/telemetry/sentry";

/**
 * The last fence under the whole app: a render error becomes a seller-facing sentence with a way out instead of
 * a blank page, and (when Sentry is on) an event. Shows no stack, no message — the seller cannot act on either.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (sentryActive()) {
      Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack ?? undefined } } });
    } else if (import.meta.env.DEV) {
      console.error(error);
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-full items-center justify-center bg-surface px-4 py-16" role="alert">
        <div className="w-full max-w-md text-center">
          <p className="text-2xl font-extrabold tracking-tight text-brand-700">SellerOps</p>
          <h1 className="mt-4 text-xl font-bold text-ink">화면을 표시하지 못했어요</h1>
          <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
            일시적인 문제일 수 있습니다. 새로고침하면 대부분 해결됩니다. 채널 연결과 수집 설정은 그대로 남아 있습니다.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              새로고침
            </button>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              홈으로
            </a>
          </div>
        </div>
      </div>
    );
  }
}
