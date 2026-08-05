import { HOW } from "../../lib/public/landingContent";
import { Band, SectionHeading, StepList } from "./SectionShell";

/** The plan. Five steps, ending on the human decision rather than on an automated outcome. */
export function LandingHowItWorks() {
  return (
    <Band id="how">
      <SectionHeading title={HOW.heading} lead={HOW.lead} />
      <StepList steps={HOW.steps} />
    </Band>
  );
}
