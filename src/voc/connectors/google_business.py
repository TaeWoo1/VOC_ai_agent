"""Google Business Profile connector — reads reviews for a verified location.

Requires a source connection with config containing:
    account_id: str      — e.g. "accounts/123456789"
    location_id: str     — e.g. "locations/987654321"
    access_token: str    — OAuth 2.0 access token (manual acquisition for now)

The access_token is obtained manually by the operator (e.g., via Google OAuth
Playground or a CLI tool) and provided when creating the source connection.

# TODO: OAuth requirements for production use
# - GCP project with Business Profile API enabled
# - OAuth 2.0 consent screen (external requires Google verification)
# - client_id + client_secret for token refresh
# - Token auto-refresh (access_token expires after ~1 hour)
# - For now, the operator must manually refresh and update the token

# TODO: Location verification
# - The GBP location must be verified (Google sends a postcard or calls)
# - The operator must have Owner or Manager role on the location
# - Cannot read reviews for unverified locations

GBP API reference:
    https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

import httpx

from src.voc.connectors.base import CollectParams
from src.voc.schemas.raw import RawReview

logger = logging.getLogger(__name__)

GBP_API_BASE = "https://mybusiness.googleapis.com/v4"

# GBP uses an enum for star ratings
_STAR_RATING_MAP = {
    "ONE": 1,
    "TWO": 2,
    "THREE": 3,
    "FOUR": 4,
    "FIVE": 5,
}


class GoogleBusinessConnector:
    """Reads reviews from Google Business Profile API for a verified location.

    Config is passed via CollectParams.language_filter as a JSON string
    containing account_id, location_id, and access_token. This is a
    pragmatic bridge to avoid changing the ChannelConnector protocol.

    If no config is provided or access_token is missing, returns an empty
    list with a warning (allows registration without immediate credentials).
    """

    @property
    def channel_name(self) -> str:
        return "google_business"

    async def collect(
        self, keyword: str, params: CollectParams | None = None
    ) -> list[RawReview]:
        params = params or CollectParams()

        # Parse config from language_filter (JSON string from SyncService)
        config = self._parse_config(params)
        if config is None:
            logger.warning(
                "GoogleBusinessConnector: no config provided, returning empty. "
                "Create a source connection with account_id, location_id, and access_token."
            )
            return []

        account_id = config.get("account_id")
        location_id = config.get("location_id")
        access_token = config.get("access_token")

        if not all([account_id, location_id, access_token]):
            logger.warning(
                "GoogleBusinessConnector: missing required config fields "
                "(account_id, location_id, access_token)"
            )
            return []

        return await self._fetch_reviews(
            account_id=account_id,
            location_id=location_id,
            access_token=access_token,
            keyword=keyword,
            max_results=params.max_results,
        )

    async def _fetch_reviews(
        self,
        account_id: str,
        location_id: str,
        access_token: str,
        keyword: str,
        max_results: int,
    ) -> list[RawReview]:
        """Fetch reviews from GBP API with pagination."""
        url = f"{GBP_API_BASE}/{account_id}/{location_id}/reviews"
        headers = {"Authorization": f"Bearer {access_token}"}

        reviews: list[RawReview] = []
        page_token: str | None = None
        now = datetime.now()

        async with httpx.AsyncClient(timeout=30) as client:
            while len(reviews) < max_results:
                request_params = {"pageSize": min(50, max_results - len(reviews))}
                if page_token:
                    request_params["pageToken"] = page_token

                resp = await client.get(url, headers=headers, params=request_params)

                if resp.status_code == 401:
                    raise ValueError(
                        "GBP API: 401 Unauthorized — access_token may be expired. "
                        "Refresh the token and update the source connection."
                    )
                if resp.status_code == 403:
                    raise ValueError(
                        "GBP API: 403 Forbidden — check location ownership and API permissions."
                    )
                resp.raise_for_status()

                data = resp.json()
                api_reviews = data.get("reviews", [])

                for r in api_reviews:
                    raw_review = self._map_review(r, keyword, now)
                    if raw_review:
                        reviews.append(raw_review)

                page_token = data.get("nextPageToken")
                if not page_token or not api_reviews:
                    break

        logger.info("GBP collected %d reviews for %s/%s", len(reviews), account_id, location_id)
        return reviews[:max_results]

    @staticmethod
    def _map_review(review: dict, keyword: str, collected_at: datetime) -> RawReview | None:
        """Map a GBP API review object to RawReview."""
        comment = review.get("comment", "").strip()
        if not comment:
            # Reviews without text (rating-only) are skipped
            return None

        star_rating = review.get("starRating", "")
        rating = _STAR_RATING_MAP.get(star_rating)

        reviewer = review.get("reviewer", {})
        author = reviewer.get("displayName")

        create_time = review.get("createTime")  # ISO 8601 from GBP API
        review_id = review.get("reviewId")

        # Preserve GBP-specific fields in raw_metadata
        raw_metadata = {}
        if review.get("reviewReply"):
            raw_metadata["reply"] = review["reviewReply"]
        if review.get("updateTime"):
            raw_metadata["update_time"] = review["updateTime"]

        return RawReview(
            source_channel="google_business",
            source_id=review_id,
            raw_text=comment,
            raw_rating=rating,
            raw_author=author,
            raw_date=create_time,
            raw_language=None,  # GBP API doesn't provide language; normalizer detects it
            raw_metadata=raw_metadata,
            collected_at=collected_at,
            keyword_used=keyword,
        )

    @staticmethod
    def _parse_config(params: CollectParams) -> dict | None:
        """Parse source connection config from CollectParams.language_filter."""
        if not params.language_filter:
            return None
        try:
            return json.loads(params.language_filter)
        except (json.JSONDecodeError, TypeError):
            return None
