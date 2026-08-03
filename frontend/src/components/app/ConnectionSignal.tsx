import { Link } from "react-router-dom";
import { useOpenAlerts } from "../../lib/openAlerts";
import { ALERTS_ROUTE } from "../../lib/nav.v2";
import { NavIcon } from "../icons/NavIcon";

/**
 * The app's one badge: unresolved connection alerts.
 *
 * Action-needed only. It never renders a "정상" state, because the count fails closed to 0 when
 * the read fails — so its absence is not evidence that connections are healthy, and claiming
 * otherwise would be a status the data cannot support.
 *
 * This is the single data-reading leaf in the shell chrome; the shell itself fetches nothing.
 */
export function ConnectionSignal() {
  const { openCount } = useOpenAlerts();
  if (openCount <= 0) {
    return null;
  }
  return (
    <Link
      to={ALERTS_ROUTE}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warn/10 px-3 py-1.5 text-sm font-semibold text-warn transition hover:bg-warn/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
    >
      <NavIcon name="bell" className="h-4 w-4" />
      연결 확인 {openCount}
    </Link>
  );
}
