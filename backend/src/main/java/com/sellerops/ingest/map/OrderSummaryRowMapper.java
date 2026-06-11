package com.sellerops.ingest.map;

import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.parse.DateParse;
import com.sellerops.ingest.parse.ParsedTable;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class OrderSummaryRowMapper {

    public MapResult<CanonicalOrderSummary> map(ParsedTable table) {
        List<CanonicalOrderSummary> ok = new ArrayList<>();
        List<RowError> errors = new ArrayList<>();
        int rowNumber = 1;
        for (Map<String, String> row : table.rows()) {
            rowNumber++;
            try {
                String dateRaw = HeaderAliases.pick(row, "날짜", "일자", "date", "summary_date");
                if (dateRaw == null) {
                    throw new IllegalArgumentException("날짜가 비어 있습니다.");
                }
                LocalDate date = DateParse.localDate(dateRaw);
                String ordersRaw = HeaderAliases.pick(row, "주문수", "주문건수", "order_count", "orders");
                String salesRaw = HeaderAliases.pick(row, "매출액", "매출", "sales", "sales_amount", "amount");
                int orderCount = ordersRaw == null ? 0 : RowParse.wholeNumber(ordersRaw, "주문수");
                long salesAmount = salesRaw == null ? 0L : RowParse.money(salesRaw, "매출액");
                ok.add(new CanonicalOrderSummary(date, orderCount, salesAmount, rowNumber));
            } catch (Exception e) {
                errors.add(new RowError(rowNumber, e.getMessage()));
            }
        }
        return new MapResult<>(ok, errors);
    }
}
