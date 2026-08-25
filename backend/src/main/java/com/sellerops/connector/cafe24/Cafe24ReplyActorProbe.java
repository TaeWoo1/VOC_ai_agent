package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The read-only observation that answers one question SellerOps cannot answer from a contract:
 * <b>what does a seller answer that already exists on this mall's board actually look like?</b>
 *
 * <p>The vendored contract ({@code docs/vendor/cafe24-admin-api/get-boards-articles.md}) names the
 * fields a reply article's {@code POST} accepts and marks four of them REQUIRED — {@code writer},
 * {@code title}, {@code content}, {@code client_ip}. It does not say what a real seller answer on
 * this board carries in them, and SellerOps holds none of those values. Guessing any of them would
 * put a fabricated author on a customer-visible reply, so the values are observed or the decision
 * stays open.
 *
 * <p><b>It asks about a closed set it already knows.</b> The Thread Semantics Recovery proved, and
 * this repository recorded, which article numbers are replies and which are their parents. Those
 * numbers, and no others, are what this observation names. There is no window, no neighbour scan,
 * no discovery: a bounded number of LIST calls filtered by {@code article_no}, whose comma-separated
 * form the contract publishes.
 *
 * <p><b>Nothing a person wrote or is leaves this class.</b> {@code writer}, {@code member_id},
 * {@code client_ip} and {@code title} have to be READ to be classified, so unlike
 * {@link Cafe24AnswerSemanticProbe} they do exist as parse fields here — and they exist nowhere
 * else. They are materialized inside {@link #observe} and reduced there to presence flags, equality
 * classes (sha-256, compared, never emitted) and one of three structural title relations. The public
 * {@link Report} is counts and nothing but counts, which a test enforces on its record components.
 * This class collects nothing, stores nothing, and writes no row anywhere.
 */
public class Cafe24ReplyActorProbe {

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24ReplyActorProbe(Cafe24HttpClient http) {
        this.http = http;
    }

    /** One proven pair: a reply article and the article it hangs off. Both numbers come from our DB. */
    public record Target(long articleNo, long parentArticleNo) {
    }

    /**
     * The whole observation, as counts. Every field is a number, a flag, or one of a fixed set of
     * words; there is no field here that could carry a name, an address or a sentence.
     *
     * <p>The three {@code title*} counters classify a REPLY's subject against its PARENT's:
     * {@code SameAsParent} (byte-identical after trimming), {@code Prefixed} (the parent's subject
     * with something in front of it — the shape {@code RE:} / {@code [답변]} produce), {@code Other}.
     */
    public record Report(String outcome, int requests, boolean budgetExhausted,
                         int requested, int returned, int unreturned,
                         int replies, int parents,
                         int replyWriterPresent, int replyMemberIdPresent,
                         int replyMemberIdEqualsMallId, int replyClientIpPresent,
                         int replyUserIdPresentOnReply, int replyStatusPresentOnReply,
                         int distinctReplyWriterClasses, int distinctReplyMemberIdClasses,
                         int parentReplyStatusC, int parentReplyStatusP, int parentReplyStatusN,
                         int parentReplyStatusAbsent, int replyUserIdPresentOnParent,
                         int parentWriterPresent, int parentMemberIdEqualsMallId,
                         int titleSameAsParent, int titlePrefixed, int titleOther, int titleAbsent,
                         int maxReplyDepth, int maxReplySequence, int childCreatedNotBeforeParent) {

        public boolean ok() {
            return "OK".equals(outcome);
        }
    }

    /**
     * Read the given reply/parent pairs and return the aggregate.
     *
     * <p>Fails closed on the budget: the id set is chunked at {@code batchSize} and the run stops at
     * {@code maxRequests}, reporting what it saw rather than continuing. A transport or auth failure
     * on any chunk ends the observation with that outcome — a partial picture of who wrote an answer
     * is exactly the kind of thing that gets read as a whole one.
     */
    public Report observe(String accessToken, String mallId, int boardNo, List<Target> targets,
                          int batchSize, int maxRequests) {
        Set<Long> replyIds = new LinkedHashSet<>();
        Set<Long> allIds = new LinkedHashSet<>();
        Map<Long, Long> parentOf = new HashMap<>();
        for (Target t : targets) {
            replyIds.add(t.articleNo());
            allIds.add(t.articleNo());
            allIds.add(t.parentArticleNo());
            parentOf.put(t.articleNo(), t.parentArticleNo());
        }
        List<Long> ids = new ArrayList<>(allIds);
        int chunk = Math.max(1, batchSize);

        // Raw person-shaped values live here and only here.
        Map<Long, RawArticle> seen = new HashMap<>();
        int requests = 0;
        boolean exhausted = false;
        for (int i = 0; i < ids.size(); i += chunk) {
            if (requests >= maxRequests) {
                exhausted = true;
                break;
            }
            List<Long> slice = ids.subList(i, Math.min(ids.size(), i + chunk));
            String joined = String.join(",", slice.stream().map(String::valueOf).toList());
            URI uri = articlesUri(mallId, boardNo,
                    Map.of("article_no", joined, "limit", Integer.toString(Math.min(100, slice.size()))));
            Cafe24HttpClient.Response response;
            try {
                response = http.get(uri, Map.of("Authorization", "Bearer " + accessToken));
            } catch (RuntimeException e) {
                // The message may carry a URI or a body; neither is repeated.
                return failed("TRANSPORT_ERROR", requests + 1);
            }
            requests++;
            if (response.statusCode() != 200) {
                return failed(category(response.statusCode()), requests);
            }
            try {
                for (RawArticle raw : parse(response.body())) {
                    if (raw.articleNo() != null) {
                        seen.put(raw.articleNo(), raw);
                    }
                }
            } catch (Exception e) {
                // The body carries customer text — it never reaches a message.
                return failed("UNPARSEABLE", requests);
            }
        }

        return reduce(mallId, replyIds, parentOf, ids, seen, requests, exhausted);
    }

    // ---------------------------------------------------------------- reduction

    private Report reduce(String mallId, Set<Long> replyIds, Map<Long, Long> parentOf,
                          List<Long> requestedIds, Map<Long, RawArticle> seen,
                          int requests, boolean exhausted) {
        Set<String> writerClasses = new HashSet<>();
        Set<String> memberClasses = new HashSet<>();
        int replies = 0;
        int writerPresent = 0;
        int memberPresent = 0;
        int memberEqualsMall = 0;
        int clientIpPresent = 0;
        int replyUserOnReply = 0;
        int replyStatusOnReply = 0;
        int sameTitle = 0;
        int prefixedTitle = 0;
        int otherTitle = 0;
        int absentTitle = 0;
        int maxDepth = 0;
        int maxSequence = 0;
        int childNotBeforeParent = 0;

        for (Long id : replyIds) {
            RawArticle child = seen.get(id);
            if (child == null) {
                continue;
            }
            replies++;
            if (present(child.writer())) {
                writerPresent++;
                writerClasses.add(sha256(child.writer().strip()));
            }
            if (present(child.memberId())) {
                memberPresent++;
                memberClasses.add(sha256(child.memberId().strip()));
                if (child.memberId().strip().equalsIgnoreCase(mallId)) {
                    memberEqualsMall++;
                }
            }
            if (present(child.clientIp())) {
                clientIpPresent++;
            }
            if (present(child.replyUserId())) {
                replyUserOnReply++;
            }
            if (present(child.replyStatus())) {
                replyStatusOnReply++;
            }
            maxDepth = Math.max(maxDepth, child.replyDepth() == null ? 0 : child.replyDepth());
            maxSequence = Math.max(maxSequence, child.replySequence() == null ? 0 : child.replySequence());

            RawArticle parent = seen.get(parentOf.get(id));
            switch (titleRelation(child.title(), parent == null ? null : parent.title())) {
                case SAME_AS_PARENT -> sameTitle++;
                case PREFIXED -> prefixedTitle++;
                case OTHER -> otherTitle++;
                case ABSENT -> absentTitle++;
            }
            if (parent != null && present(child.createdDate()) && present(parent.createdDate())
                    && child.createdDate().compareTo(parent.createdDate()) >= 0) {
                childNotBeforeParent++;
            }
        }

        int parents = 0;
        int pC = 0;
        int pP = 0;
        int pN = 0;
        int pAbsent = 0;
        int replyUserOnParent = 0;
        int parentWriterPresent = 0;
        int parentMemberEqualsMall = 0;
        for (Long parentId : new LinkedHashSet<>(parentOf.values())) {
            RawArticle parent = seen.get(parentId);
            if (parent == null) {
                continue;
            }
            parents++;
            String status = parent.replyStatus() == null ? "" : parent.replyStatus().strip();
            switch (status) {
                case "C" -> pC++;
                case "P" -> pP++;
                case "N" -> pN++;
                default -> pAbsent++;
            }
            if (present(parent.replyUserId())) {
                replyUserOnParent++;
            }
            if (present(parent.writer())) {
                parentWriterPresent++;
            }
            if (present(parent.memberId()) && parent.memberId().strip().equalsIgnoreCase(mallId)) {
                parentMemberEqualsMall++;
            }
        }

        return new Report("OK", requests, exhausted, requestedIds.size(), seen.size(),
                requestedIds.size() - seen.size(), replies, parents,
                writerPresent, memberPresent, memberEqualsMall, clientIpPresent,
                replyUserOnReply, replyStatusOnReply, writerClasses.size(), memberClasses.size(),
                pC, pP, pN, pAbsent, replyUserOnParent, parentWriterPresent, parentMemberEqualsMall,
                sameTitle, prefixedTitle, otherTitle, absentTitle,
                maxDepth, maxSequence, childNotBeforeParent);
    }

    enum TitleRelation { SAME_AS_PARENT, PREFIXED, OTHER, ABSENT }

    /**
     * How a reply's subject relates to its parent's. {@code PREFIXED} is the shape a board produces
     * when it writes the question's subject after a marker of its own ({@code RE:}, {@code [답변]}):
     * the child ENDS with the parent's subject and is longer than it.
     */
    static TitleRelation titleRelation(String childTitle, String parentTitle) {
        if (!present(childTitle) || !present(parentTitle)) {
            return TitleRelation.ABSENT;
        }
        String child = childTitle.strip();
        String parent = parentTitle.strip();
        if (child.equals(parent)) {
            return TitleRelation.SAME_AS_PARENT;
        }
        return child.endsWith(parent) ? TitleRelation.PREFIXED : TitleRelation.OTHER;
    }

    // ---------------------------------------------------------------- plumbing

    private static Report failed(String outcome, int requests) {
        return new Report(outcome, requests, false, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0);
    }

    private static String category(int status) {
        return switch (status) {
            case 401, 403 -> "UNAUTHORIZED";
            case 404 -> "NOT_FOUND";
            case 429 -> "RATE_LIMITED";
            default -> "HTTP_" + status;
        };
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] out = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(out.length * 2);
            for (byte b : out) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private List<RawArticle> parse(String body) throws Exception {
        ArticlesEnvelope envelope = mapper.readValue(body, ArticlesEnvelope.class);
        return envelope.articles() == null ? List.of() : envelope.articles();
    }

    private URI articlesUri(String mallId, int boardNo, Map<String, String> params) {
        StringBuilder query = new StringBuilder();
        params.forEach((k, v) -> query.append(query.isEmpty() ? "?" : "&").append(k).append('=').append(v));
        return URI.create(base(mallId) + "/api/v2/admin/boards/" + positiveBoard(boardNo)
                + "/articles" + query);
    }

    private static String base(String mallId) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        return "https://" + mallId + ".cafe24api.com";
    }

    private static int positiveBoard(int boardNo) {
        if (boardNo <= 0) {
            throw new IllegalStateException("카페24 board_no 형식이 올바르지 않습니다.");
        }
        return boardNo;
    }

    // ---------------------------------------------------------------- wire records (private)

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ArticlesEnvelope(@JsonProperty("articles") List<RawArticle> articles) {
    }

    /**
     * The only place in SellerOps where a Cafe24 article's person-shaped fields are materialized.
     * They exist because the question is literally "which of these does a real seller answer carry",
     * and they never leave {@link #reduce} as anything but a count. {@code content} is not declared:
     * the answer's TEXT is not part of this question.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RawArticle(@JsonProperty("article_no") Long articleNo,
                              @JsonProperty("parent_article_no") Long parentArticleNo,
                              @JsonProperty("reply_status") String replyStatus,
                              @JsonProperty("reply_user_id") String replyUserId,
                              @JsonProperty("reply_sequence") Integer replySequence,
                              @JsonProperty("reply_depth") Integer replyDepth,
                              @JsonProperty("created_date") String createdDate,
                              @JsonProperty("title") String title,
                              @JsonProperty("writer") String writer,
                              @JsonProperty("member_id") String memberId,
                              @JsonProperty("client_ip") String clientIp) {
    }
}
