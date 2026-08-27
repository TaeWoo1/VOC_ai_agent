import { Link } from "react-router-dom";
import { useOpenAlerts } from "../../lib/openAlerts";
import { ALERTS_ROUTE } from "../../lib/nav.v2";

/**
 * The app's one badge: unresolved connection alerts.
 *
 * Action-needed only. It never renders a "정상" state, because the count fails closed to 0 when the
 * read fails — so its absence is not evidence that connections are healthy.
 *
 * <b>Secondary, by design</b> (docs/reviewnary_design.md §5, §7). As a warn pill in the top-right
 * of every screen it was the strongest visual on the page, above the customer's question the seller
 * came for. Connection health matters and stays one press away, but it is not a global critical state:
 * a dot, a word, and the count, in the sidebar's status area. 「건」 keeps the number from reading as a
 * step.
 */
export function ConnectionSignal() {
  const { openCount } = useOpenAlerts();
  if (openCount <= 0) {
    return null;
  }
  return (
    <Link
      to={ALERTS_ROUTE}
      className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-warn transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warn" />
      {`연결 문제 ${openCount}건`}
    </Link>
  );
}
