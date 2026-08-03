import { ASSISTED } from "../../lib/public/landingContent";
import { Band, SectionHeading, StepList } from "./SectionShell";

/**
 * "정기 자료 가져오기" — the route for channels that cannot be connected directly.
 *
 * Named as a rhythm the seller keeps, not as a file format. Calling it "엑셀 업로드" would describe
 * the mechanism and hide the actual promise, which is that the hard channels are not abandoned.
 */
export function LandingAssistedImport() {
  return (
    <Band id="assisted">
      <SectionHeading title={ASSISTED.heading} lead={ASSISTED.lead} />
      <StepList steps={ASSISTED.steps} />
    </Band>
  );
}
