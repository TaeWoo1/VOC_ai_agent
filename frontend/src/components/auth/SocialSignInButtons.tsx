import { useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import type { SocialProvidersView } from "../../lib/types";

/**
 * Google · NAVER sign-in buttons — rendered ONLY for a provider the backend says is configured
 * (`GET /api/auth/social/providers`), as plain full-page links to Spring Security's authorize endpoint
 * (`/oauth2/authorization/{provider}`, same public origin). Nothing here is a marketplace channel: this is
 * the SellerOps account, not a 채널 연결.
 *
 * Branding follows each provider's published button rules — Google "Sign in with Google" (light theme:
 * white, #747775 border, G mark, Roboto Medium 14px, "Google 계정으로 로그인/가입"), NAVER 로그인 버튼
 * (#03C75A, white N mark, "네이버 로그인"). Do not restyle these to the app's brand colour.
 */
export type SocialIntent = "login" | "signup";

export const SOCIAL_AUTHORIZE_PATH = "/oauth2/authorization";

const GOOGLE_LABEL: Record<SocialIntent, string> = { login: "Google 계정으로 로그인", signup: "Google 계정으로 가입" };
const NAVER_LABEL = "네이버 로그인";

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function NaverMark() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" focusable="false">
      <path fill="#FFFFFF" d="M10.85 8.56 4.9 0H0v16h5.15V7.44L11.1 16H16V0h-5.15z" />
    </svg>
  );
}

export function SocialSignInButtons({ intent }: { intent: SocialIntent }) {
  const [providers, setProviders] = useState<SocialProvidersView | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .socialProviders()
      .then((p) => {
        if (alive) setProviders(p);
      })
      .catch(() => {
        // Unknown ⇒ no buttons. The email form is always there; social sign-in is additive.
        if (alive) setProviders({ google: false, naver: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!providers || (!providers.google && !providers.naver)) return null;

  return (
    <div className="space-y-3" data-testid="social-sign-in">
      {providers.google ? (
        <a
          href={`${SOCIAL_AUTHORIZE_PATH}/google`}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-[#747775] bg-white px-4 text-[15px] font-medium text-[#1F1F1F] transition hover:bg-[#F8F9FA] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          style={{ fontFamily: "Roboto, 'Pretendard', system-ui, sans-serif" }}
        >
          <GoogleMark />
          <span>{GOOGLE_LABEL[intent]}</span>
        </a>
      ) : null}
      {providers.naver ? (
        <a
          href={`${SOCIAL_AUTHORIZE_PATH}/naver`}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-xl bg-[#03C75A] px-4 text-[15px] font-bold text-white transition hover:bg-[#02B351] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          <NaverMark />
          <span>{NAVER_LABEL}</span>
        </a>
      ) : null}
      <div className="flex items-center gap-3 pt-1" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-muted">또는 이메일로</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
