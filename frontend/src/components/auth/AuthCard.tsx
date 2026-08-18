import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PRODUCT_PATH } from "../../lib/public/publicCta";

/**
 * The one auth-surface frame (`/login`, `/signup`, `/onboarding`, `/auth/callback`): brand, a title in the
 * seller's words, the card, and the two footer links. Keeps the account screens looking like one product.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link
            to={PRODUCT_PATH}
            className="inline-block rounded text-3xl font-extrabold tracking-tight text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            SellerOps
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-ink">{title}</h1>
          {subtitle ? <p className="mt-2 text-base text-muted">{subtitle}</p> : null}
        </div>
        <div className="card space-y-5">{children}</div>
        {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}

export const authField =
  "w-full rounded-xl border border-line bg-white px-4 py-3 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
export const authLabel = "mb-1.5 block text-sm font-semibold text-ink";
export const authPrimaryButton =
  "inline-flex w-full items-center justify-center rounded-xl bg-brand-700 px-5 py-3 text-base font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";
export const authLink =
  "rounded font-medium text-brand-700 transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";
