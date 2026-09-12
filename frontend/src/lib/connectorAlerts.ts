import type { ConnectorAlertView } from "./types";

/**
 * <b>Whether a connection alert describes a problem the seller has right now.</b>
 *
 * Unacknowledged AND not recovered. Both halves are needed and they are different facts:
 * `acknowledgedAt` says a person saw it, `recoveredAt` says the condition ended. A channel can fix
 * itself while nobody looked, and a seller can read an alert for a channel that is still broken.
 *
 * <b>Why this exists as one function.</b> Two surfaces counted connection problems — the sidebar
 * badge and the home signals — and both did it by testing `acknowledgedAt` alone. On the live org
 * that produced 「연결 문제 3건」 over three alerts raised 2026-08-18..23, while all three channels were
 * CONNECTED with zero consecutive failures and had collected successfully on 09-05 and 09-08. The
 * badge was reporting failures that had recovered three weeks earlier, which is the shape of invented
 * urgency: a number a seller would act on describing a condition that no longer exists.
 *
 * <b>A recovered alert is not deleted and not hidden from its own screen.</b> History is the point of
 * an alert log; what changes is only whether it is counted as CURRENT.
 */
export function isActiveAlert(alert: ConnectorAlertView): boolean {
  return alert.acknowledgedAt == null && alert.recoveredAt == null;
}

/** The alerts a "연결 문제 N건" number may count. */
export function activeAlerts(
  alerts: readonly ConnectorAlertView[] | null | undefined,
): ConnectorAlertView[] {
  return (alerts ?? []).filter(isActiveAlert);
}

/**
 * What to say about an alert that resolved itself, or null while it is still current.
 *
 * Stated on the alert history screen so a seller reading an old warning can see it ended without
 * them — silence there would leave a resolved failure looking unresolved, which is the same defect
 * one screen further along.
 */
export function recoveredNote(alert: ConnectorAlertView): string | null {
  if (alert.recoveredAt == null) return null;
  return `${alert.recoveredAt.slice(0, 10)}에 수집이 다시 성공했습니다.`;
}
