package com.sellerops.connector.naver;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/**
 * The 상품정보제공고시 fields of one listing, under the labels NAVER's own schema gives them.
 *
 * <p>{@code productInfoProvidedNotice} carries a type token and exactly one child object for that type ({@code etc},
 * {@code kitchenUtensils}, … — 36 of them). Each child's string fields are the seller's statements about the product
 * (크기, 재질, 구성품, 모델명). The label table is generated from the published schema
 * ({@code resources/naver/product-info-notice-labels.tsv}); a field the table does not know keeps its wire name rather
 * than being dropped, because a statement with an unfamiliar label is still the seller's statement.
 *
 * <p><b>Not projected:</b> the five legal-notice clauses every type repeats (청약철회·환불·보증·분쟁 처리 조항) and the
 * contact fields — they describe the store's policy and a phone number, not the product, and a phone number is not a
 * thing a catalogue answer should ever quote. A value of {@code "0"}/{@code "1"} is the schema's code for «관련 법령에
 * 따름 / 상품상세 참조», i.e. not a statement, and is skipped — and so is the same pointer written out in words
 * («상품상세참조», {@link com.sellerops.product.NoticePlaceholder}), which is how most sellers fill the field.
 */
final class NoticeLabels {

    private static final String RESOURCE = "/naver/product-info-notice-labels.tsv";

    private static final Set<String> NOT_ABOUT_THE_PRODUCT = Set.of(
            "returnCostReason", "noRefundReason", "qualityAssuranceStandard", "compensationProcedure",
            "troubleShootingContents", "afterServiceDirector", "customerServicePhoneNumber", "importDeclaration");

    private static final Map<String, String> LABELS = load();

    private NoticeLabels() {
    }

    /** Add the active notice type's product statements to {@code into}, label → value, in wire order. */
    static void project(JsonNode notice, Map<String, String> into) {
        if (notice == null || !notice.isObject()) {
            return;
        }
        for (Iterator<Map.Entry<String, JsonNode>> types = notice.fields(); types.hasNext(); ) {
            Map.Entry<String, JsonNode> type = types.next();
            if (!type.getValue().isObject()) {
                continue;  // productInfoProvidedNoticeType itself
            }
            for (Iterator<Map.Entry<String, JsonNode>> fields = type.getValue().fields(); fields.hasNext(); ) {
                Map.Entry<String, JsonNode> field = fields.next();
                String name = field.getKey();
                JsonNode value = field.getValue();
                if (NOT_ABOUT_THE_PRODUCT.contains(name) || name.toLowerCase().contains("phone")
                        || !value.isTextual()) {
                    continue;
                }
                String text = value.asText().strip();
                if (text.isEmpty() || text.equals("0") || text.equals("1")
                        || com.sellerops.product.NoticePlaceholder.isPlaceholder(text)) {
                    continue;
                }
                into.putIfAbsent(label(type.getKey(), name), text);
            }
        }
    }

    static String label(String type, String field) {
        return LABELS.getOrDefault(type + "." + field, field);
    }

    private static Map<String, String> load() {
        Map<String, String> out = new HashMap<>();
        try (InputStream in = NoticeLabels.class.getResourceAsStream(RESOURCE)) {
            if (in == null) {
                return out;
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("#")) {
                    continue;
                }
                String[] cols = line.split("\t");
                if (cols.length == 3) {
                    out.put(cols[0] + "." + cols[1], cols[2]);
                }
            }
        } catch (IOException e) {
            // An unreadable table leaves wire names as labels; the statements themselves are unaffected.
        }
        return out;
    }
}
