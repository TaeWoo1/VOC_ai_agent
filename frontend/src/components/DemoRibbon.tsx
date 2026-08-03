/**
 * Persistent demo-data notice.
 *
 * Renders only when the app is running on seeded demo data (`VITE_USE_MOCKS=true`). It is
 * deliberately NOT dismissible: the honesty rule is that demo figures must never be mistaken for
 * a seller's real operating data, and a banner the viewer closed on screen one cannot carry that
 * guarantee to screen six.
 *
 * Neutral ink strip on purpose — `warn`/`bad` are operating-status colors in this app, and the
 * brand accent is reserved for actions. This reads as chrome, not as an alert.
 */
export function DemoRibbon() {
  if (import.meta.env.VITE_USE_MOCKS !== "true") {
    return null;
  }
  return (
    <aside
      aria-label="데모 모드 안내"
      className="shrink-0 bg-ink px-4 py-2 text-center text-sm font-medium text-white md:px-8"
    >
      데모 데이터로 둘러보는 중입니다. 화면의 수치와 항목은 실제 판매 데이터가 아닙니다.
    </aside>
  );
}
