// @vitest-environment jsdom
//
// The 'API 호출 IP' panel must keep TWO root causes visibly distinct and never block a seller who already
// registered: an empty advertised list is OUR-side "not configured yet" (no fabricated value), a non-empty
// list is the seller's remaining action, and the acknowledgment is a local reassurance that stores no IP.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdvertisedCallIpPanel } from "./AdvertisedCallIpPanel";
import { CALL_IP_COPY } from "../../lib/guidedConnection";

describe("AdvertisedCallIpPanel — advertised-unset vs registration-pending", () => {
  it("empty ips → our-side 'not configured yet' copy, no fabricated IP", () => {
    render(<AdvertisedCallIpPanel ips={[]} />);
    expect(screen.getByText(CALL_IP_COPY.advertisedUnsetTitle)).toBeInTheDocument();
    // Never the register-this-value phrasing when we have nothing to show.
    expect(screen.queryByText(CALL_IP_COPY.registerTitle)).toBeNull();
  });

  it("non-empty ips → register-this-value copy + each IP shown with a copy control", () => {
    render(<AdvertisedCallIpPanel ips={["203.0.113.10", "198.51.100.7"]} />);
    expect(screen.getByText(CALL_IP_COPY.registerTitle)).toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.7")).toBeInTheDocument();
  });

  it("without showRegisteredAck there is NO acknowledgment button (advisory contexts)", () => {
    render(<AdvertisedCallIpPanel ips={[]} />);
    expect(screen.queryByTestId("call-ip-already-registered")).toBeNull();
  });
});

describe("AdvertisedCallIpPanel — already-registered acknowledgment (recovery contexts)", () => {
  it("empty ips + showRegisteredAck: acknowledging replaces the nag with the local-confirmation note", () => {
    render(<AdvertisedCallIpPanel ips={[]} showRegisteredAck />);
    const ack = screen.getByTestId("call-ip-already-registered");
    expect(ack).toHaveTextContent(CALL_IP_COPY.alreadyRegisteredCta);
    fireEvent.click(ack);
    expect(screen.getByText(CALL_IP_COPY.acknowledgedNote)).toBeInTheDocument();
    // The unset nag and the ack button are both gone — a seller who registered out of band is not blocked.
    expect(screen.queryByText(CALL_IP_COPY.advertisedUnsetTitle)).toBeNull();
    expect(screen.queryByTestId("call-ip-already-registered")).toBeNull();
  });

  it("non-empty ips + showRegisteredAck also offers the acknowledgment", () => {
    render(<AdvertisedCallIpPanel ips={["203.0.113.10"]} showRegisteredAck />);
    expect(screen.getByTestId("call-ip-already-registered")).toBeInTheDocument();
  });
});
