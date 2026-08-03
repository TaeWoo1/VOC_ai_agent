// Public-surface call-to-action contract. Pure, no React, no I/O.
//
// The two public CTAs are fixed for the whole landing surface — the same words in every
// placement. A CTA that changes wording between the header and the page body reads as a
// different promise, so the labels live here and every caller imports them.
//
// PO decision (v1): "무료 운영 진단 받기" goes to an EXTERNAL form. There is no lead-capture
// endpoint in this product and none is being built for v1, so the destination is configuration
// (`VITE_DIAGNOSIS_FORM_URL`) rather than a route.

export const CTA_DIAGNOSIS_LABEL = "무료 운영 진단 받기";
export const CTA_DEMO_LABEL = "데모 화면 보기";

/** Demo entry. The login page prefills the demo account and shows the demo notice. */
export const DEMO_ENTRY_PATH = "/login?demo=1";

/** The public product page. */
export const PRODUCT_PATH = "/product";

/**
 * Resolves the external diagnosis-form URL, failing closed.
 *
 * Returns `null` — never a broken or unsafe link — when the value is missing, blank, not a
 * valid absolute URL, or not http(s). A `javascript:` or `data:` value in this env var would
 * otherwise become a clickable link on a public page, so the scheme check is a fence, not a
 * formality. Callers render the demo CTA as the primary action when this is null; the page is
 * never shipped with a dead primary button.
 *
 * Reads the env at call time (not module load) so tests can stub it.
 */
export function diagnosisFormUrl(
  raw: string | undefined = import.meta.env.VITE_DIAGNOSIS_FORM_URL,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  return parsed.toString();
}
