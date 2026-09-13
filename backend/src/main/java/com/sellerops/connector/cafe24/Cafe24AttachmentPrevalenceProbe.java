package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * <b>Three read-only requests that answer one product question: do this seller's Cafe24 review
 * articles actually carry attachments, and how many?</b>
 *
 * <p>This is a DIAGNOSTIC. It collects nothing, stores nothing, and is not reachable from any
 * runtime path — see {@link Cafe24AttachmentPrevalenceRunner} for the double gate.
 *
 * <p><b>Why it exists.</b> `docs/review_media_presence_audit_v1.md` §2 established that the vendored
 * reference publishes {@code attach_file_urls} on the exact endpoint the connector already calls, and
 * that {@link Cafe24BoardArticleRow} does not project it — so it is parsed and discarded on every
 * sweep. What nobody knew was whether the field is ever populated for this mall. That is not a
 * question the repository can answer, and it is one bounded read away.
 *
 * <p><b>Three requests, and the third is an integrity check rather than more data.</b>
 * <ol>
 *   <li>the ordinary window read — the denominator, and the array LENGTHS measured directly;</li>
 *   <li>the same window with the documented {@code attached_file=T} filter;</li>
 *   <li>the same window with {@code attached_file=F}.</li>
 * </ol>
 * Three numbers that check each other: {@code T + F} must equal the window total, and the count of
 * rows this probe measured as carrying an attachment must equal {@code |T|}. If they disagree, the
 * field and the filter do not mean the same thing and the prevalence number is not trustworthy —
 * which is a result worth having, and one a single request could not produce.
 *
 * <p><b>Nothing but integers leaves this class.</b> {@code RawArticle} has exactly two fields, one of
 * them an {@code int}: the {@code attach_file_urls} setter receives the array, takes {@code size()},
 * and lets it go. No {@code name}, no {@code url}, no filename, no title, no body, no writer, no
 * {@code member_id} has a field on any record in this file, so none is ever materialized. The array
 * arrives on the wire because it rides on the response; its LENGTH is the only thing that survives
 * the parse boundary.
 *
 * <p><b>It writes nothing and it changes nothing.</b> The one state change in the whole run belongs
 * to {@link Cafe24Authorizer} and predates this class: Cafe24 refresh tokens are single-use, so
 * authorizing rotates one. That is the same seam every sweep uses, serialized by the same per-account
 * lock, and this probe adds no copy of it.
 */
public class Cafe24AttachmentPrevalenceProbe {

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    /**
     * The vendor's own page maximum. Deliberately the cap rather than a smaller number: a partial page
     * would make the denominator a fact about our paging instead of about the seller's board, and the
     * report says so ({@code windowFull}) rather than paging for more.
     */
    static final int PAGE_LIMIT = 100;

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24AttachmentPrevalenceProbe(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * What three requests found. Integers, booleans and one closed outcome token — nothing else.
     *
     * @param outcome               {@code OK} or a failure token; every other field is 0 on failure
     * @param requests              how many HTTP requests were actually spent (≤ 3, always reported)
     * @param articlesInWindow      rows the plain window read returned — the denominator
     * @param windowFull            the denominator hit {@link #PAGE_LIMIT} and is a floor, not a total
     * @param withAttachment        rows whose {@code attach_file_urls} array was non-empty
     * @param attachmentsTotal      the sum of those array lengths
     * @param attachmentsMax        the largest array length seen on one article
     * @param vendorFilteredWith    rows the {@code attached_file=T} filter returned
     * @param vendorFilteredWithout rows the {@code attached_file=F} filter returned
     * @param filterPartitions      {@code T + F == window total} — the filter partitions the board
     * @param filterAgreesWithField {@code |T| == withAttachment} — filter and field mean the same thing
     */
    public record AttachmentPrevalence(
            String outcome,
            int requests,
            int articlesInWindow,
            boolean windowFull,
            int withAttachment,
            long attachmentsTotal,
            int attachmentsMax,
            int vendorFilteredWith,
            int vendorFilteredWithout,
            boolean filterPartitions,
            boolean filterAgreesWithField) {

        static AttachmentPrevalence failed(String outcome, int requests) {
            return new AttachmentPrevalence(outcome, requests, 0, false, 0, 0L, 0, 0, 0, false, false);
        }
    }

    /**
     * Run the measurement. Never throws: a failure is a fail-closed report with the reason as a
     * closed token, because a diagnostic that crashes the boot it runs in is worse than one that
     * measures nothing.
     */
    public AttachmentPrevalence measure(String accessToken, String mallId, int boardNo,
                                        LocalDate startDate, LocalDate endDate) {
        int spent = 0;
        try {
            List<RawArticle> window = read(accessToken, articlesUri(mallId, boardNo, startDate, endDate, null));
            spent++;
            List<RawArticle> withFile = read(accessToken, articlesUri(mallId, boardNo, startDate, endDate, "T"));
            spent++;
            List<RawArticle> withoutFile = read(accessToken, articlesUri(mallId, boardNo, startDate, endDate, "F"));
            spent++;

            int withAttachment = 0;
            long total = 0L;
            int max = 0;
            for (RawArticle a : window) {
                if (a.attachmentCount > 0) {
                    withAttachment++;
                    total += a.attachmentCount;
                    max = Math.max(max, a.attachmentCount);
                }
            }
            return new AttachmentPrevalence(
                    "OK", spent, window.size(), window.size() >= PAGE_LIMIT,
                    withAttachment, total, max,
                    withFile.size(), withoutFile.size(),
                    withFile.size() + withoutFile.size() == window.size(),
                    withFile.size() == withAttachment);
        } catch (Cafe24RateLimitedException e) {
            return AttachmentPrevalence.failed("RATE_LIMITED", spent);
        } catch (RuntimeException e) {
            return AttachmentPrevalence.failed("READ_FAILED", spent);
        } catch (Exception e) {
            return AttachmentPrevalence.failed("PARSE_FAILED", spent);
        }
    }

    private List<RawArticle> read(String accessToken, URI uri) throws Exception {
        Cafe24HttpClient.Response response = http.get(uri, Map.of("Authorization", "Bearer " + accessToken));
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException("카페24 게시글 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        ArticlesEnvelope envelope = mapper.readValue(response.body(), ArticlesEnvelope.class);
        return envelope.articles == null ? List.of() : envelope.articles;
    }

    /**
     * The window URI, optionally narrowed by the documented {@code attached_file} filter.
     *
     * <p>Built here rather than reused from {@link Cafe24BoardArticlesClient} so the collection path
     * cannot acquire a filter it does not use; the two share the endpoint and nothing else.
     */
    static URI articlesUri(String mallId, int boardNo, LocalDate startDate, LocalDate endDate,
                           String attachedFile) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        if (boardNo <= 0) {
            throw new IllegalStateException("카페24 board_no 형식이 올바르지 않습니다.");
        }
        Map<String, String> params = new LinkedHashMap<>();
        if (startDate != null) {
            params.put("start_date", startDate.toString());
        }
        if (endDate != null) {
            params.put("end_date", endDate.toString());
        }
        if (attachedFile != null) {
            params.put("attached_file", attachedFile);
        }
        params.put("limit", Integer.toString(PAGE_LIMIT));
        String query = params.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                        + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        return URI.create("https://" + mallId + ".cafe24api.com"
                + "/api/v2/admin/boards/" + boardNo + "/articles?" + query);
    }

    // ---------------------------------------------------------------- parsing

    @JsonIgnoreProperties(ignoreUnknown = true)
    static final class ArticlesEnvelope {
        @JsonProperty("articles")
        List<RawArticle> articles = new ArrayList<>();
    }

    /**
     * One article, as narrowly as Jackson can be asked to see it.
     *
     * <p>Two fields, and the attachment one is an {@code int}. The setter takes the array's
     * {@code size()} and returns; nothing holds a reference to an element afterwards. Declaring
     * {@code List<Attachment>} with {@code name}/{@code url} would have been the obvious shape and is
     * exactly what this file must not contain — a field is where a value ends up being logged.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    static final class RawArticle {
        long articleNo;
        int attachmentCount;

        @JsonProperty("article_no")
        void setArticleNo(long articleNo) {
            this.articleNo = articleNo;
        }

        @JsonProperty("attach_file_urls")
        void setAttachments(List<Object> attachments) {
            this.attachmentCount = attachments == null ? 0 : attachments.size();
        }
    }
}
