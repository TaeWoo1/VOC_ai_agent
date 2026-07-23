package com.sellerops.ingest.map;

import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.parse.DateParse;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.ingest.parse.ParsedTable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Maps parsed rows into {@link CanonicalReview}, collecting per-row errors. */
@Component
public class ReviewRowMapper {

    public MapResult<CanonicalReview> map(ParsedTable table) {
        List<CanonicalReview> ok = new ArrayList<>();
        List<RowError> errors = new ArrayList<>();
        int rowNumber = 1; // header occupies row 1
        // Alias lists fold in real ESM+ REVIEW export headers grounded from the
        // Slice 2c live capture (schema-alias source exception) alongside the
        // existing generic/NAVER aliases. ESM+ reuses 상품명/별점 verbatim, so only
        // the body / sku / date columns needed new literals. ESM+ exposes no
        // review-id column, so externalId stays ungrounded for ESM+ by design.
        for (Map<String, String> row : table.rows()) {
            rowNumber++;
            try {
                String body = HeaderAliases.pick(
                        row, "내용", "리뷰", "리뷰내용", "리뷰상세내용", "리뷰 내용",
                        "review", "body", "content");
                if (body == null) {
                    throw new IllegalArgumentException("리뷰 내용이 비어 있습니다.");
                }
                String product = HeaderAliases.pick(row, "상품명", "상품", "product", "product_name");
                String sku = HeaderAliases.pick(row, "sku", "상품코드", "품번", "상품번호", "상품 번호");
                if (product == null && sku == null) {
                    product = "(미지정 상품)";
                }
                String ratingRaw =
                        HeaderAliases.pick(row, "평점", "별점", "구매자평점", "rating", "score", "star");
                Integer rating = ratingRaw == null ? null : RowParse.rating(ratingRaw);
                String dateRaw = HeaderAliases.pick(
                        row, "작성일", "날짜", "리뷰등록일", "접수일시", "date", "received_at", "reg_date");
                Instant receivedAt = dateRaw == null ? null : DateParse.instantAtStartOfDay(dateRaw);
                String externalId = HeaderAliases.pick(
                        row, "리뷰id", "리뷰아이디", "리뷰글번호", "review_id", "external_id", "id");
                // What the CHANNEL says about an existing reply. Only NAVER's export columns are
                // aliased, because only their vocabulary is grounded: ESM+ has a 답변 상태 column
                // but the observed file was header-only, so its tokens are unknown and no alias is
                // added for it — a channel-support decision belongs in the capability table, not in
                // an alias list. `HeaderAliases.pick` is an exact-key lookup, so 답글여부 can never
                // be satisfied by a neighbouring column.
                ReviewReplyState replyState = ReviewReplyState.normalize(
                        HeaderAliases.pick(row, "답글여부"));
                String repliedRaw = HeaderAliases.pick(row, "답글등록일시");
                // Date-granular by the same rule as 리뷰등록일 — and never fatal: an unparseable
                // reply date must not fail a row whose review content is fine.
                Instant repliedAt = null;
                if (repliedRaw != null) {
                    try {
                        repliedAt = DateParse.instantAtStartOfDay(repliedRaw);
                    } catch (Exception ignored) {
                        repliedAt = null;
                    }
                }
                ok.add(new CanonicalReview(product, sku, rating, body, receivedAt, externalId, rowNumber,
                        replyState, repliedAt));
            } catch (Exception e) {
                errors.add(new RowError(rowNumber, e.getMessage()));
            }
        }
        return new MapResult<>(ok, errors);
    }
}
