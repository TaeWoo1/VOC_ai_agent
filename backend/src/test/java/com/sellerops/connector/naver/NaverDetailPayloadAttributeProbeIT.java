package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.net.URI;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Where, if anywhere, does a NAVER channel-product detail payload carry category attribute ids and values for a listing
 * whose projection found none? Reads the RAW body of at most {@value #MAX_READS} 종이컵디스펜서 listings — no projection,
 * no parser change, no write (the database is only read, to choose the listings and open the credential).
 *
 * <p>Printed: every key path of the payload (names only, arrays collapsed to {@code []}), and for keys that name an
 * attribute, a category or an id sequence, the value when it is a number, a boolean or a string of at most 40 characters.
 * No other value is printed: seller copy, images and prices stay out of the log.
 *
 * <p>Gated and approval-bound: {@code RUN_CATKB_PAYLOAD_PROBE=true}. One token mint and at most two GETs of
 * {@code /external/v2/products/channel-products/{no}}; nothing else is requested.
 */
@EnabledIfEnvironmentVariable(named = "RUN_CATKB_PAYLOAD_PROBE", matches = "true")
@SpringBootTest
class NaverDetailPayloadAttributeProbeIT {

    static final int MAX_READS = 2;
    private static final UUID ORG = UUID.fromString("7146c50f-ff6d-4c83-ae96-18c930e6d8e0");
    private static final Pattern INTERESTING = Pattern.compile("(?i).*(attribute|categor|seq|certif|model|brand).*");

    @Autowired JdbcTemplate jdbc;
    @Autowired CredentialVault vault;
    @Autowired NaverTokenClient tokens;
    @Autowired NaverHttpClient http;
    @Value("${sellerops.connector.naver.base-url:https://api.commerce.naver.com}") String baseUrl;

    @Test
    void rawPayloadAttributeCensus() throws Exception {
        UUID account = jdbc.queryForObject("""
                select a.id from seller_accounts a join channels c on c.id = a.channel_id
                where a.org_id = ? and c.code = 'NAVER' and a.connection_status = 'CONNECTED' and not a.is_file_upload
                """, UUID.class, ORG);
        List<String> listings = jdbc.queryForList("""
                select cp.external_product_id from channel_products cp
                join channels c on c.id = cp.channel_id
                join product_facts f on f.product_id = cp.product_id and f.fact_key = 'taxonomy:category'
                     and f.source = 'NAVER:PRODUCT_API:v1'
                where cp.org_id = ? and c.code = 'NAVER' and cp.selling_status = 'SELLING'
                  and f.fact_value like '%>종이컵디스펜서'
                order by cp.external_product_id
                limit ?
                """, String.class, ORG, MAX_READS);
        assertThat(listings).hasSizeBetween(1, MAX_READS);

        DecryptedCredential credential = vault.open(ORG, account);
        String token = tokens.accessToken(credential.secrets().get("client_id"), credential.secrets().get("client_secret"));
        int reads = 0;
        for (String no : listings) {
            assertThat(++reads).isLessThanOrEqualTo(MAX_READS);
            NaverHttpClient.Response r = http.get(URI.create(baseUrl + NaverChannelProductClient.PATH_PREFIX
                    + Long.parseLong(no.strip())), token);
            String masked = "…" + no.substring(Math.max(0, no.length() - 4));
            System.out.println("CATKB_PROBE listing=" + masked + " status=" + r.statusCode());
            if (r.statusCode() != 200) {
                continue;
            }
            JsonNode root = new ObjectMapper().readTree(r.body());
            Map<String, String> paths = new TreeMap<>();
            walk(root, "$", paths);
            paths.forEach((p, v) -> System.out.println("CATKB_PROBE   " + p + (v.isEmpty() ? "" : " = " + v)));
            JsonNode attrs = root.path("originProduct").path("detailAttribute").path("productAttributes");
            System.out.println("CATKB_PROBE   summary leafCategoryId="
                    + root.path("originProduct").path("leafCategoryId").asText("<absent>")
                    + " productAttributes=" + (attrs.isMissingNode() ? "<absent>" : attrs.isArray() ? attrs.size() : attrs.getNodeType()));
        }
        System.out.println("CATKB_PROBE reads=" + reads);
    }

    private static void walk(JsonNode node, String path, Map<String, String> out) {
        if (node.isObject()) {
            for (Iterator<Map.Entry<String, JsonNode>> it = node.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> e = it.next();
                String p = path + "." + e.getKey();
                JsonNode v = e.getValue();
                if (v.isValueNode()) {
                    out.merge(p, INTERESTING.matcher(e.getKey()).matches() ? shown(v) : "", (a, b) ->
                            a.isEmpty() ? b : b.isEmpty() || a.contains(b) || a.length() > 200 ? a : a + " | " + b);
                } else {
                    walk(v, p, out);
                }
            }
        } else if (node.isArray()) {
            out.merge(path + "[]#", "len=" + node.size(), (a, b) -> a + "," + b.substring(4));
            for (JsonNode child : node) {
                walk(child, path + "[]", out);
            }
        }
    }

    private static String shown(JsonNode v) {
        if (v.isNumber() || v.isBoolean() || v.isNull()) {
            return v.asText();
        }
        String s = v.asText();
        return s.length() <= 40 ? "\"" + s + "\"" : "<string " + s.length() + " chars>";
    }
}
