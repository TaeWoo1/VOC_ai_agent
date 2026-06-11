package com.sellerops.ingest.map;

import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.parse.DateParse;
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
        for (Map<String, String> row : table.rows()) {
            rowNumber++;
            try {
                String body = HeaderAliases.pick(row, "내용", "리뷰", "리뷰내용", "review", "body", "content");
                if (body == null) {
                    throw new IllegalArgumentException("리뷰 내용이 비어 있습니다.");
                }
                String product = HeaderAliases.pick(row, "상품명", "상품", "product", "product_name");
                String sku = HeaderAliases.pick(row, "sku", "상품코드", "품번");
                if (product == null && sku == null) {
                    product = "(미지정 상품)";
                }
                String ratingRaw = HeaderAliases.pick(row, "평점", "별점", "rating", "score", "star");
                Integer rating = ratingRaw == null ? null : RowParse.rating(ratingRaw);
                String dateRaw = HeaderAliases.pick(row, "작성일", "날짜", "date", "received_at", "reg_date");
                Instant receivedAt = dateRaw == null ? null : DateParse.instantAtStartOfDay(dateRaw);
                String externalId =
                        HeaderAliases.pick(row, "리뷰id", "리뷰아이디", "review_id", "external_id", "id");
                ok.add(new CanonicalReview(product, sku, rating, body, receivedAt, externalId, rowNumber));
            } catch (Exception e) {
                errors.add(new RowError(rowNumber, e.getMessage()));
            }
        }
        return new MapResult<>(ok, errors);
    }
}
