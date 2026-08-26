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
 *
 * <b>It says what it is</b> (Executive Readiness Fix v1). 「연결 확인 3」 appeared on every screen in
 * warn colour and three independent readers, given no explanation, could not tell whether it meant
 * three connections were fine or three were broken — one read it while trying to answer a customer
 * and called it the second thing their eye landed on. The alerts behind it are real (`REPEATED_FAILURE`,
 * unacknowledged), so it is not quietened; it is named. 「건」 also stops the count reading as a step
 * number.
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
      {`연결 문제 ${openCount}건`}
    </Link>
  );
}
