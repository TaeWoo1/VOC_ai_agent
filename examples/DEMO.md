# Demo Guide

5-minute repeatable demo for the VOC Review Monitoring Service.

## Prerequisites

```bash
# Terminal 1 — backend
pip install -e ".[dev]"
cp .env.example .env   # add OPENAI_API_KEY
python -m src.voc.api

# Terminal 2 — operator console
streamlit run app_demo.py
```

Open `http://localhost:8501` in your browser.

## Step 1: Register an Entity (30s)

Sidebar → "새 모니터링 대상 등록" expander:

| Field | Value |
|---|---|
| 이름 | 에어팟 프로 |
| 유형 | product |
| 검색 키워드 | 에어팟 프로 |
| 설명 | 무선 이어폰 리뷰 모니터링 |

Click "등록".

## Step 2: Upload CSV Reviews (30s)

Main panel → "소스 연결 관리" expander:

1. Select **CSV** in the file format radio
2. Upload `examples/sample_reviews.csv`
3. Click "업로드"

You should see: "업로드 완료: sample_reviews.csv (15건)"

A CSV source connection is auto-created.

## Step 3: Upload JSON Reviews (30s)

Still in "소스 연결 관리":

1. Switch to **JSON**
2. Upload `examples/sample_reviews.json`
3. Click "업로드"

You should see: "업로드 완료: sample_reviews.json (15건)"

Now the entity has two source connections (CSV + JSON), 30 total reviews.

## Step 4: Validate Sources (15s)

In the source list, click "상태 확인" for each source.

Both should show: **수동 소스 — 준비됨** (blue).

The pre-refresh summary above should show: "사용 가능한 소스 2개 — 새로고침 준비 완료"

## Step 5: Refresh (30s)

Click "리뷰 새로고침" (primary button).

Wait for completion. You should see:
- "수집 완료 — 30건 수집, N건 인덱싱"
- Source-by-source results: CSV 15건, JSON 15건

## Step 6: Generate Monitoring Report (1 min)

Click "모니터링 리포트 생성" (primary button).

The report should show:
- **Metrics**: ~30 reviews, average rating around 2.5–3.0, several negative reviews
- **Top customer issue callout** (red/orange box) — likely battery or fit issues
- **Action items** — battery complaints, pricing concerns, defect reports
- **Recurring issues** — battery drain, uncomfortable fit, packaging problems
- **Flagged reviews** — 1-star reviews with specific complaints

## Step 7: Inspect History (15s)

Expand "최근 새로고침 이력" → see the job with source-by-source breakdown.

Expand "스냅샷 이력" → see the captured snapshot with review stats.

## What to Highlight in the Demo

1. **Source management** — CSV and JSON upload create source connections automatically
2. **Validation** — operator can check readiness before refreshing
3. **Source-aware refresh** — results show per-source counts, not just totals
4. **Actionable monitoring** — top issue callout, priority badges, why_urgent, suggested actions
5. **Operator guidance** — recommended actions appear when sources need attention

## Optional: Second Refresh for Deltas

Re-upload a modified CSV (change a few ratings or add reviews), then refresh again.

The monitoring report metrics will now show deltas (arrows on the metric cards):
- "+N건" for new reviews
- Rating/negative ratio changes

The refresh history will show job-to-job comparison.

## Sample Data Overview

**`sample_reviews.csv`** — 15 Korean reviews (CSV format):
- 3 reviews rated 1 (battery failure, packaging damage, overpriced)
- 4 reviews rated 2 (uncomfortable fit, battery drain, ear tip fit, call quality)
- 4 reviews rated 3 (battery mediocre, price concern, shipping slow, battery + ANC)
- 3 reviews rated 4 (good sound, clear calls, comfortable fit)
- 1 review rated 5 (noise cancellation)
- Themes: battery complaints, fit issues, pricing, noise cancellation praise

**`sample_reviews.json`** — 15 Korean reviews (JSON format, `source_channel: "naver"`):
- 3 reviews rated 1 (hardware defect, battery failure, battery drain)
- 4 reviews rated 2 (packaging, charging issues, low volume, bluetooth, touch issues)
- 2 reviews rated 3 (noise cancellation + wind, ear tip size)
- 2 reviews rated 4 (sound quality, call quality improvement)
- 4 reviews rated 5 (value, design, gift, noise cancellation)
- Themes: hardware defects, battery issues, connectivity, positive design/sound
