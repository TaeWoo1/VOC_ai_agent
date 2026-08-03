import { HERO } from "../../lib/public/landingContent";
import { LandingCtaButtons } from "./LandingCtaButtons";

/**
 * Opening. The subject of the headline is the seller's situation, not the product — the product
 * is not named until the guide section. No illustration, no mock dashboard: an invented screenshot
 * on a public page is a claim about data this product has not been shown to hold.
 */
export function LandingHero() {
  return (
    <section id="hero" className="scroll-mt-20 bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <div className="max-w-3xl">
          <p className="text-base font-semibold text-brand-700">{HERO.eyebrow}</p>

          <h1 className="mt-5 break-keep text-[clamp(2.125rem,5.5vw,3.75rem)] font-extrabold leading-[1.15] tracking-tight text-ink">
            {HERO.titleLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h1>

          <p className="mt-6 max-w-2xl break-keep text-lg leading-relaxed text-muted">
            {HERO.body}
          </p>

          <div className="mt-10">
            <LandingCtaButtons />
          </div>

          <p className="mt-5 text-base text-muted">{HERO.ctaNote}</p>
        </div>
      </div>
    </section>
  );
}
