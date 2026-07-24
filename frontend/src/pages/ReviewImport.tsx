import { ReviewImportPage } from "../components/reviewImport/ReviewImportPage";

/**
 * 과거 리뷰 가져오기 — the onboarding historical review backfill. Choose a connected seller account and a
 * period, then import each calendar-month segment through the operator-driven Action Window, resuming any
 * remaining work. Honest coverage + import-health throughout; the page owns only the heading, the flow
 * lives in {@link ReviewImportPage}.
 */
export function ReviewImport() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">과거 리뷰 가져오기</h1>
      <ReviewImportPage />
    </div>
  );
}
