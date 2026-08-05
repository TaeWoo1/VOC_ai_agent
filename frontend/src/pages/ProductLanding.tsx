import { useEffect } from "react";
import { PAGE_META, SECTION_ORDER, type SectionId } from "../lib/public/landingContent";
import { LandingHero } from "../components/public/LandingHero";
import { LandingProblem } from "../components/public/LandingProblem";
import { LandingCost } from "../components/public/LandingCost";
import { LandingGuide } from "../components/public/LandingGuide";
import { LandingHowItWorks } from "../components/public/LandingHowItWorks";
import { LandingConnectModes } from "../components/public/LandingConnectModes";
import { LandingAssistedImport } from "../components/public/LandingAssistedImport";
import { LandingChange } from "../components/public/LandingChange";
import { LandingSafety } from "../components/public/LandingSafety";
import { LandingFit } from "../components/public/LandingFit";
import { LandingFaq } from "../components/public/LandingFaq";
import { LandingClosingCta } from "../components/public/LandingClosingCta";

/** Sets the document title + meta description for the public page, restoring them on unmount so
 *  the SPA's app surface is not left with marketing metadata after navigating away. */
function usePublicPageMeta(title: string, description: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = meta === null;
    if (meta === null) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    const previousDescription = meta.content;
    meta.content = description;

    return () => {
      document.title = previousTitle;
      if (created) {
        meta?.remove();
      } else if (meta) {
        meta.content = previousDescription;
      }
    };
  }, [title, description]);
}

// Section order is a product decision and lives in `landingContent.ts`. This map only binds each
// id to its component; the `Record<SectionId, …>` type makes a missing section a compile error, so
// adding an id to SECTION_ORDER without building it cannot ship.
const SECTIONS: Record<SectionId, () => JSX.Element> = {
  hero: LandingHero,
  problem: LandingProblem,
  cost: LandingCost,
  guide: LandingGuide,
  how: LandingHowItWorks,
  connect: LandingConnectModes,
  assisted: LandingAssistedImport,
  change: LandingChange,
  safety: LandingSafety,
  fit: LandingFit,
  faq: LandingFaq,
  closing: LandingClosingCta,
};

/**
 * Public product page.
 *
 * Narrative shape is StoryBrand with the seller as protagonist: they are the one with the problem
 * and the one who decides; SellerOps is the guide that hands them a plan. The page's single
 * conversion goal is the free operations diagnosis.
 *
 * Copy rules this surface is held to (guarded by `landingContent.test.ts` and the shared
 * `pages-copy` scan):
 *   - No channel names or logos. Naming a marketplace reads as a support claim, and capability
 *     truth does not back one — support is declared per channel × data type × operation.
 *   - No metrics, customer logos, testimonials, or screenshots. Nothing may look like measured
 *     results or real operating data that does not exist.
 *   - No roadmap wording. Unbuilt work is not previewed.
 *   - No implementation mechanism. The promise is the operating outcome, not how it is fetched.
 */
export function ProductLanding() {
  usePublicPageMeta(PAGE_META.title, PAGE_META.description);

  return (
    <>
      {SECTION_ORDER.map((id) => {
        const Section = SECTIONS[id];
        return <Section key={id} />;
      })}
    </>
  );
}
