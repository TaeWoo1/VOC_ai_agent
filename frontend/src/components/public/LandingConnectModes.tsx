import { CONNECT } from "../../lib/public/landingContent";
import { Band, InfoCard, SectionHeading } from "./SectionShell";

/**
 * The honest answer to "which channels do you support?".
 *
 * It answers with METHODS, never with channel names or logos. Support truth is declared per
 * (channel × data type × operation) and today's production-supported level does not back a logo
 * wall — so a channel list here would be a claim the product cannot stand behind. Answering by
 * method is both accurate and a better qualifier: it hands the reader a reason to request the
 * diagnosis, which is where their specific channels actually get answered.
 */
export function LandingConnectModes() {
  return (
    <Band id="connect" tone="canvas">
      <SectionHeading title={CONNECT.heading} lead={CONNECT.lead} />
      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {CONNECT.modes.map((mode) => (
          <li key={mode.title}>
            <InfoCard title={mode.title} body={mode.body} />
          </li>
        ))}
      </ul>
      <p className="mt-8 max-w-2xl break-keep leading-relaxed text-muted">{CONNECT.note}</p>
    </Band>
  );
}
