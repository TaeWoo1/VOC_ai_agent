import { PROBLEM } from "../../lib/public/landingContent";
import { Band, InfoCard, SectionHeading } from "./SectionShell";

/** The conflict, told as scenes the reader recognises rather than adjectives about the market. */
export function LandingProblem() {
  return (
    <Band id="problem" tone="canvas">
      <SectionHeading title={PROBLEM.heading} lead={PROBLEM.lead} />
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROBLEM.scenes.map((scene) => (
          <li key={scene.title}>
            <InfoCard title={scene.title} body={scene.body} />
          </li>
        ))}
      </ul>
    </Band>
  );
}
