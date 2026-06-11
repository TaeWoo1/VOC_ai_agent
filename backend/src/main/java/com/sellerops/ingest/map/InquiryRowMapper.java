package com.sellerops.ingest.map;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.parse.DateParse;
import com.sellerops.ingest.parse.ParsedTable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class InquiryRowMapper {

    public MapResult<CanonicalInquiry> map(ParsedTable table) {
        List<CanonicalInquiry> ok = new ArrayList<>();
        List<RowError> errors = new ArrayList<>();
        int rowNumber = 1;
        for (Map<String, String> row : table.rows()) {
            rowNumber++;
            try {
                String body = HeaderAliases.pick(row, "문의내용", "내용", "문의", "inquiry", "question", "body");
                if (body == null) {
                    throw new IllegalArgumentException("문의 내용이 비어 있습니다.");
                }
                String product = HeaderAliases.pick(row, "상품명", "상품", "product", "product_name");
                String sku = HeaderAliases.pick(row, "sku", "상품코드", "품번");
                if (product == null && sku == null) {
                    product = "(미지정 상품)";
                }
                String author = HeaderAliases.pick(row, "작성자", "구매자", "author", "writer");
                String status = mapStatus(HeaderAliases.pick(row, "상태", "답변상태", "status"));
                String dateRaw = HeaderAliases.pick(row, "작성일", "날짜", "date", "received_at", "reg_date");
                Instant receivedAt = dateRaw == null ? null : DateParse.instantAtStartOfDay(dateRaw);
                String externalId =
                        HeaderAliases.pick(row, "문의id", "문의아이디", "inquiry_id", "external_id", "id");
                ok.add(new CanonicalInquiry(product, sku, author, body, status, receivedAt, externalId, rowNumber));
            } catch (Exception e) {
                errors.add(new RowError(rowNumber, e.getMessage()));
            }
        }
        return new MapResult<>(ok, errors);
    }

    private String mapStatus(String raw) {
        if (raw == null) {
            return "UNANSWERED";
        }
        String s = raw.strip().toLowerCase();
        if (s.contains("답변완료") || s.contains("완료") || s.equals("answered") || s.equals("done")) {
            return "ANSWERED";
        }
        return "UNANSWERED";
    }
}
