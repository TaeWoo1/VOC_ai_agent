package com.sellerops.product.catalogue;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.FactKeys;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.Product;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.SellingStatus;
import com.sellerops.product.detail.ProductDetailEnrichmentTrigger;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.ProductKnowledgeChunk;
import com.sellerops.product.library.ProductKnowledgeSource;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * <b>Seller-wide catalogue discovery — a read-only capability, used only for catalogue questions.</b>
 *
 * <p>Given a {@link CatalogueQuestion} ("do you sell a 9oz 디스펜서?"), read this organisation's own catalogue — product
 * names, channel listing names and selling status, the channel's stated facts, registered options, and the product
 * detail text already indexed — and report which products <i>state</i> the asked value, in the seller's own words, with
 * where each statement came from and when it was captured.
 *
 * <p><b>What counts as evidence, and what does not.</b>
 * <ul>
 *   <li>Only a product whose own name names the head (「디스펜서」) is a candidate — a statement on another kind of
 *       product is about another kind of product — and it must also state every other catalogue word the customer
 *       used (「하향식」): a dispenser that never says 하향식 does not answer a question about a 하향식 one.</li>
 *   <li>A statement counts only when it names the asked value itself (9oz ≡ 9온스, numerically; 「19oz」 is not 9oz), in
 *       a sentence that does not negate it (「9온스 사용 불가」 is a finding, never a match).</li>
 *   <li>A match grounds «we sell it» only on a listing the channel says is <b>on sale now</b>. A match on an ended or
 *       suspended listing, or on one whose status the channel never stated, is reported and does not ground: current
 *       availability is a claim about today, and the catalogue is the only thing here that knows about today.</li>
 *   <li>「6.5온스 종이컵전용」 on a candidate is recorded as a <i>different-value</i> finding. It is not an answer to
 *       "is there a 9oz one" — another product might be — and it is shown to the seller, not to the customer.</li>
 * </ul>
 *
 * <p><b>What a detail read added</b> (Catalogue Knowledge Bootstrap v1). A 추가상품 offered on a listing answers «do you
 * sell X» in its own label — head, qualifiers and value all in that label — and is quoted as an add-on so it can never
 * read as the listing's own spec. An option the channel says is switched off, sold out or no longer listed is not on
 * sale, whatever its listing's status. And the Finding counts what «checked» did not cover — on-sale candidates whose
 * 상세페이지 was never read, and those whose page is pictures — so an ask to the seller never implies a search that did
 * not happen.
 *
 * <p><b>Organisation isolation</b> is in every predicate: products, listings, facts, options and passages are all read
 * with {@code orgId}, and the real-data filter on products and listings keeps seeded rows out.
 *
 * <p><b>Bounded lazy detail.</b> When the switch for product detail reads is on, up to {@link #MAX_DETAIL_READS}
 * on-sale candidates that have never had their 상세페이지 read are read through the existing
 * {@link ProductDetailEnrichmentTrigger} (one request per product, its own staleness gate and attempt memory) before
 * the statements are scanned. Off, it reads nothing from any channel. No model is called here in any configuration.
 */
@Component
public class CatalogueInvestigator {

    /** Candidates considered per question. A head that matches more products than this is scanned on-sale first. */
    static final int MAX_CANDIDATES = 80;
    /** On-sale candidates whose detail may be read for one question, when detail reads are on at all. */
    static final int MAX_DETAIL_READS = 3;
    /** Matches carried to a draft. The rest are counted. */
    static final int MAX_MATCHES = 3;
    private static final int MAX_TEXT = 240;

    /** A sentence that negates what it names. Closed; a sentence that merely does not mention the value is silent. */
    static final Pattern NEGATION = Pattern.compile(
            "불가|안\\s*(?:됩|돼|되|들어)|사용할\\s*수\\s*없|사용\\s*못|못\\s*(?:씁|쓰|써)|맞지\\s*않|호환되지\\s*않|호환\\s*안|"
                    + "들어가지\\s*않|지원하지\\s*않|제외|아닙니다|없습니다");
    private static final Pattern SENTENCE = Pattern.compile("(?<=[.!?。])\\s+|\\n+|(?<=다)\\s+");

    public enum Field {
        PRODUCT_NAME, LISTING_NAME, OPTION, FACT, DETAIL,
        /** A 추가상품 a listing offers — a separately purchasable item, named in its own label. */
        SUPPLEMENT
    }

    public enum Availability {
        /** The channel says a listing of this product is on sale now. */
        ON_SALE,
        /** Listed, but the channel never stated a selling status for it. */
        STATUS_UNKNOWN,
        /** Every listing is suspended, ended or out of stock. */
        NOT_ON_SALE
    }

    /**
     * One statement in the seller's catalogue.
     *
     * @param current  whether it is the product the question was asked on
     * @param field    where on the product it is stated
     * @param factKey  for a {@link Field#FACT}, which fact
     * @param text     the statement, verbatim, trimmed to a sentence
     * @param capturedAt when the channel last changed it, or when we read it
     * @param sourceId the row it came from: the fact, the option, the passage — or the product for a name
     */
    public record Statement(UUID productId, String productName, boolean current, Availability availability,
                            String channelCode, Field field, String factKey, String text, Instant capturedAt,
                            UUID sourceId) {

        /** {@code catalogue/NAVER/option@2026-09-05} — enough to re-check the statement by hand. */
        public String locator() {
            String where = switch (field) {
                case PRODUCT_NAME -> "name";
                case LISTING_NAME -> "listing-name";
                case OPTION -> "option";
                case FACT -> factKey == null ? "fact" : factKey;
                case DETAIL -> "detail";
                case SUPPLEMENT -> "supplement";
            };
            String day = capturedAt == null ? "미상"
                    : capturedAt.atZone(java.time.ZoneId.of("Asia/Seoul")).toLocalDate().toString();
            return "catalogue/" + (channelCode == null ? "판매자" : channelCode) + "/" + where + "@" + day;
        }
    }

    /**
     * What the catalogue said about one catalogue question.
     *
     * @param candidates       products of the asked kind that were checked
     * @param onSale           of those, on sale now
     * @param matches          statements of the asked value on products on sale now — the only thing that grounds
     * @param notOnSale        statements of the asked value on products not on sale now, or whose status is unknown
     * @param otherValue       statements that name the kind with a DIFFERENT value, for the seller
     * @param negated          statements that name the asked value and negate it
     * @param detailReads      상세페이지 reads made for this question
     * @param detailUnread     on-sale candidates whose 상세페이지 has never been read — what «checked» did NOT cover
     * @param detailImageOnly  on-sale candidates whose 상세페이지 was read and is pictures — its text could not be checked
     * @param detailNoticeStated on-sale candidates whose detail read left at least one 상품정보제공고시 statement — a
     *                         read whose 고시 fields were all «상품상세참조» checked the page, not the product's 고시 (spec facts of
     *                         the detail read: 고시, 모델명, named attributes)
     */
    public record Finding(CatalogueQuestion question, int candidates, int onSale, List<Statement> matches,
                          List<Statement> notOnSale, List<Statement> otherValue, List<Statement> negated,
                          int detailReads, int detailUnread, int detailImageOnly, int detailNoticeStated) {

        public Finding(CatalogueQuestion question, int candidates, int onSale, List<Statement> matches,
                       List<Statement> notOnSale, List<Statement> otherValue, List<Statement> negated,
                       int detailReads) {
            this(question, candidates, onSale, matches, notOnSale, otherValue, negated, detailReads, 0, 0, 0);
        }

        /** On-sale candidates whose 상세페이지 was read, now or before — the only ones whose 추가상품·고시 were checked. */
        public int detailRead() {
            return Math.max(0, onSale - detailUnread);
        }

        public Finding {
            matches = matches == null ? List.of() : List.copyOf(matches);
            notOnSale = notOnSale == null ? List.of() : List.copyOf(notOnSale);
            otherValue = otherValue == null ? List.of() : List.copyOf(otherValue);
            negated = negated == null ? List.of() : List.copyOf(negated);
        }

        public boolean grounds() {
            return !matches.isEmpty();
        }

        /**
         * For the seller, when the catalogue could not answer: what was checked, what was found instead, and what to
         * tell us. Every figure is a count of rows this read, every quote is the seller's own catalogue text.
         */
        public String checkedKo() {
            if (grounds()) {
                return null;
            }
            StringBuilder sb = new StringBuilder();
            if (question.kind() == CatalogueQuestion.Kind.OTHER_OPTION) {
                sb.append("이 상품에 등록된 다른 옵션을 찾지 못했습니다.");
            } else {
                sb.append("판매 중인 「").append(question.head()).append("」 상품 ").append(onSale)
                        .append("개의 상품명·옵션을 확인했지만 「").append(question.target())
                        .append("」에 맞는다고 적힌 상품은 없었습니다.");
            }
            // What was read, and what was not, as separate claims: 추가상품 and 고시 come only from a detail read, a 고시
            // made of «상품상세참조» states nothing, and a page made of pictures was read without its content being seen.
            // Not reading a page and reading it and finding nothing are different claims.
            int read = detailRead();
            if (question.kind() != CatalogueQuestion.Kind.OTHER_OPTION && onSale > 0) {
                if (read == 0) {
                    sb.append(" 상세 정보(추가상품·상품정보제공고시)는 읽지 못했습니다.");
                } else {
                    sb.append(" 상세 정보(추가상품·상품정보제공고시)는 ")
                            .append(read == onSale ? "모두" : "그중 " + read + "개에서").append(" 읽었");
                    if (detailNoticeStated < read) {
                        sb.append("고, 상품정보제공고시·속성에 실제 내용이 적힌 상품은 ").append(detailNoticeStated)
                                .append("개였습니다.");
                    } else {
                        sb.append("습니다.");
                    }
                    if (detailImageOnly > 0) {
                        sb.append(detailImageOnly == read ? " 읽은 상품의 상세페이지는 모두" : " 그중 " + detailImageOnly + "개는 상세페이지가")
                                .append(" 이미지로만 되어 있어 이미지 속 내용은 확인하지 못했습니다.");
                    }
                    if (detailUnread > 0) {
                        sb.append(" 나머지 ").append(detailUnread).append("개는 상세 정보를 읽지 못했습니다.");
                    }
                }
            }
            if (!notOnSale.isEmpty()) {
                sb.append(" 「").append(question.target()).append("」")
                        .append(CatalogueQuestion.subjectParticle(question.target())).append(" 적힌 상품이 ").append(distinct(notOnSale))
                        .append("개 있지만 지금 판매 중으로 확인되지 않습니다.");
            }
            if (!otherValue.isEmpty()) {
                Statement first = otherValue.get(0);
                sb.append(" 「").append(first.text()).append("」처럼 다른 규격이 적힌 상품이 ")
                        .append(distinct(otherValue)).append("개 있습니다.");
            }
            sb.append(" 판매 여부를 알려 주시면 답변을 만들 수 있습니다.");
            return sb.toString();
        }

        private static long distinct(List<Statement> statements) {
            return statements.stream().map(Statement::productId).distinct().count();
        }
    }

    private final EntityManager em;
    private final ChannelRepository channels;
    private final ProductDetailEnrichmentTrigger detail;

    @Autowired
    public CatalogueInvestigator(EntityManager em, ChannelRepository channels,
                                 @Autowired(required = false) ProductDetailEnrichmentTrigger detail) {
        this.em = em;
        this.channels = channels;
        this.detail = detail;
    }

    /** Parse a question against this organisation's catalogue vocabulary; empty when it is not a catalogue question. */
    public Optional<CatalogueQuestion> question(UUID orgId, String title, String body) {
        if (orgId == null) {
            return Optional.empty();
        }
        List<String> names = products(orgId).stream()
                .map(p -> squash(p.getName()))
                .filter(n -> !n.isEmpty())
                .toList();
        return CatalogueQuestion.parse(title, body, word -> names.stream().anyMatch(n -> n.contains(word)));
    }

    /** Investigate one catalogue question. Reads only; the one channel reach is the bounded lazy detail read. */
    public Finding investigate(UUID orgId, UUID currentProductId, CatalogueQuestion question) {
        return investigate(orgId, currentProductId, question, false);
    }

    /**
     * @param mayReadDetail whether this caller may reach a channel for a missing 상세페이지 — the draft path someone is
     *                      waiting on, never a background investigation
     */
    public Finding investigate(UUID orgId, UUID currentProductId, CatalogueQuestion question, boolean mayReadDetail) {
        List<Product> all = products(orgId);
        String head = squash(question.head());
        // The head must be in the product's own NAME. A taxonomy is broader than the thing asked for — NAVER files a
        // cup collector under 종이컵디스펜서 — and a live probe matched exactly that (2026-09-18).
        Map<UUID, Product> candidates = new LinkedHashMap<>();
        for (Product p : all) {
            if (squash(p.getName()).contains(head)
                    || (question.kind() == CatalogueQuestion.Kind.OTHER_OPTION && p.getId().equals(currentProductId))) {
                candidates.put(p.getId(), p);
            }
        }
        // A 추가상품 is sold on another product's listing: a cup listing that offers 「9oz 컵 뚜껑」 sells a 뚜껑.
        if (question.kind() == CatalogueQuestion.Kind.VALUE) {
            Set<UUID> bySupplement = supplementsNaming(orgId, head);
            for (Product p : all) {
                if (bySupplement.contains(p.getId())) {
                    candidates.putIfAbsent(p.getId(), p);
                }
            }
        }
        if (currentProductId != null && candidates.containsKey(currentProductId) == false) {
            all.stream().filter(p -> p.getId().equals(currentProductId)).findFirst()
                    .ifPresent(p -> candidates.put(p.getId(), p));
        }
        if (candidates.isEmpty()) {
            return new Finding(question, 0, 0, List.of(), List.of(), List.of(), List.of(), 0, 0, 0, 0);
        }

        Map<UUID, List<ChannelProduct>> listings = listingsOf(orgId, candidates.keySet());
        Map<UUID, Availability> availability = new HashMap<>();
        candidates.keySet().forEach(id -> availability.put(id, availabilityOf(listings.getOrDefault(id, List.of()))));

        // On sale first, then the product the question was asked on, then name order — a stable scan order.
        List<UUID> ordered = candidates.keySet().stream()
                .sorted(Comparator.comparingInt((UUID id) -> availability.get(id).ordinal())
                        .thenComparing(id -> !id.equals(currentProductId))
                        .thenComparing(id -> String.valueOf(candidates.get(id).getName())))
                .limit(MAX_CANDIDATES)
                .toList();

        int reads = mayReadDetail ? readMissingDetail(orgId, ordered, availability) : 0;

        Map<UUID, List<Statement>> stated = statements(orgId, currentProductId, ordered, candidates, listings,
                availability);
        List<Statement> matches = new ArrayList<>();
        List<Statement> notOnSale = new ArrayList<>();
        List<Statement> otherValue = new ArrayList<>();
        List<Statement> negated = new ArrayList<>();
        for (UUID id : ordered) {
            boolean ofHead = squash(candidates.get(id).getName()).contains(head);
            List<Statement> own = stated.getOrDefault(id, List.of());
            if (question.kind() == CatalogueQuestion.Kind.VALUE) {
                // A 추가상품 is its own item: it answers only in its own label — the head, every qualifier and the value.
                for (Statement s : own) {
                    if (s.field() != Field.SUPPLEMENT || !squash(s.text()).contains(head)
                            || !statesAll(List.of(s), question.qualifiers())) {
                        continue;
                    }
                    switch (verdictOf(s.text(), question)) {
                        case STATES -> (s.availability() == Availability.ON_SALE ? matches : notOnSale).add(s);
                        case NEGATES -> negated.add(s);
                        case OTHER_VALUE -> {
                            if (s.availability() == Availability.ON_SALE) {
                                otherValue.add(s);
                            }
                        }
                        case SILENT -> { }
                    }
                }
            }
            if (ofHead && question.kind() == CatalogueQuestion.Kind.VALUE && !statesAll(own, question.qualifiers())) {
                continue;  // it is of the asked kind, but not the kind the customer described
            }
            for (Statement s : own) {
                if (s.field() == Field.SUPPLEMENT) {
                    continue;  // judged above, on its own label
                }
                if (question.kind() == CatalogueQuestion.Kind.OTHER_OPTION) {
                    if (s.current() && s.field() == Field.OPTION && s.availability() == Availability.ON_SALE) {
                        matches.add(s);
                    }
                    continue;
                }
                if (!ofHead) {
                    continue;  // the product the question was asked on, when it is not of the asked kind
                }
                Verdict v = verdictOf(s.text(), question);
                switch (v) {
                    case STATES -> (s.availability() == Availability.ON_SALE ? matches : notOnSale).add(s);
                    case NEGATES -> negated.add(s);
                    // A different value on a listing no longer on sale is not a fact about today's catalogue.
                    case OTHER_VALUE -> {
                        if (s.availability() == Availability.ON_SALE) {
                            otherValue.add(s);
                        }
                    }
                    case SILENT -> { }
                }
            }
        }
        if (question.kind() == CatalogueQuestion.Kind.OTHER_OPTION && matches.size() < 2) {
            matches.clear();  // one option is not "other options"
        }
        int onSale = (int) ordered.stream().filter(id -> availability.get(id) == Availability.ON_SALE)
                .filter(id -> squash(candidates.get(id).getName()).contains(head))
                .count();
        int checked = (int) ordered.stream()
                .filter(id -> squash(candidates.get(id).getName()).contains(head))
                .count();
        int[] coverage = coverage(orgId, ordered.stream()
                .filter(id -> availability.get(id) == Availability.ON_SALE)
                .filter(id -> squash(candidates.get(id).getName()).contains(head))
                .toList());
        return new Finding(question, checked, onSale, onePerProduct(matches), onePerProduct(notOnSale),
                onePerProduct(otherValue), onePerProduct(negated), reads, coverage[0], coverage[1], coverage[2]);
    }

    /**
     * {never read, read and pictures, read with a 고시 statement} among these products — from the page-shape marker
     * every detail read writes, the indexed document an older read left, and the {@code spec:} facts stated under the
     * marker's own source (the detail read's). A database read only.
     */
    private int[] coverage(UUID orgId, List<UUID> ids) {
        if (ids.isEmpty()) {
            return new int[] {0, 0, 0};
        }
        Map<UUID, String> shape = new HashMap<>();
        Map<UUID, String> detailSource = new HashMap<>();
        for (ProductFact f : em.createQuery("""
                        select f from ProductFact f
                        where f.orgId = :org and f.productId in :ids and f.factKey = :key
                        """, ProductFact.class)
                .setParameter("org", orgId).setParameter("ids", ids).setParameter("key", FactKeys.DETAIL_PAGE)
                .getResultList()) {
            shape.put(f.getProductId(), f.getFactValue());
            detailSource.put(f.getProductId(), f.getSource());
        }
        Set<UUID> noticeStated = new java.util.HashSet<>();
        if (!detailSource.isEmpty()) {
            for (ProductFact f : em.createQuery("""
                            select f from ProductFact f
                            where f.orgId = :org and f.productId in :ids and f.factKey like :spec
                            """, ProductFact.class)
                    .setParameter("org", orgId).setParameter("ids", List.copyOf(detailSource.keySet()))
                    .setParameter("spec", FactKeys.SPEC + ":%")
                    .getResultList()) {
                if (f.getSource() != null && f.getSource().equals(detailSource.get(f.getProductId()))
                        && !com.sellerops.product.NoticePlaceholder.isPlaceholder(f.getFactValue())) {
                    noticeStated.add(f.getProductId());
                }
            }
        }
        Set<UUID> documented = em.createQuery("""
                        select s.productId from ProductKnowledgeSource s
                        where s.orgId = :org and s.productId in :ids and s.authoredOrigin = :origin
                        """, UUID.class)
                .setParameter("org", orgId).setParameter("ids", ids)
                .setParameter("origin", KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT)
                .getResultList().stream().collect(Collectors.toSet());
        int unread = 0;
        int images = 0;
        for (UUID id : ids) {
            String s = shape.get(id);
            if (s == null && !documented.contains(id)) {
                unread++;
            } else if ("IMAGE_ONLY".equals(s)) {
                images++;
            }
        }
        return new int[] {unread, images, noticeStated.size()};
    }

    /** Products with an offered 추가상품 whose label names the head. */
    private Set<UUID> supplementsNaming(UUID orgId, String head) {
        return em.createQuery("""
                        select f from ProductFact f where f.orgId = :org and f.factKey like :prefix
                        """, ProductFact.class)
                .setParameter("org", orgId).setParameter("prefix", FactKeys.SUPPLEMENT_PREFIX + "%")
                .getResultList().stream()
                .filter(f -> squash(f.getFactValue()).contains(head))
                .map(ProductFact::getProductId)
                .collect(Collectors.toSet());
    }

    /** Whether a product's statements, together, name every qualifier the customer used. */
    static boolean statesAll(List<Statement> statements, List<String> qualifiers) {
        if (qualifiers.isEmpty()) {
            return true;
        }
        String all = squash(statements.stream().map(Statement::text).collect(Collectors.joining(" ")));
        return qualifiers.stream().allMatch(q -> all.contains(squash(q)));
    }

    enum Verdict { STATES, NEGATES, OTHER_VALUE, SILENT }

    /** What one statement says about the asked value. */
    static Verdict verdictOf(String text, CatalogueQuestion question) {
        if (text == null || text.isBlank()) {
            return Verdict.SILENT;
        }
        boolean names = question.measures().stream()
                .anyMatch(asked -> CatalogueQuestion.measuresIn(text).stream().anyMatch(asked::sameAs))
                || question.colors().stream().anyMatch(c -> CatalogueQuestion.namesColor(text, c));
        if (names) {
            return NEGATION.matcher(text).find() ? Verdict.NEGATES : Verdict.STATES;
        }
        // A different value of the same unit, stated as exclusive or as the fit: a finding, not an answer.
        boolean otherMeasure = question.measures().stream().anyMatch(asked -> CatalogueQuestion.measuresIn(text)
                .stream().anyMatch(m -> m.unit().equals(asked.unit()) && !m.sameAs(asked)));
        return otherMeasure && (text.contains("전용") || text.contains("호환") || text.contains("사용")
                || text.contains("맞"))
                ? Verdict.OTHER_VALUE : Verdict.SILENT;
    }

    // ── reads ───────────────────────────────────────────────────────────────────────────────────────────────────

    private List<Product> products(UUID orgId) {
        return em.createQuery("select p from Product p where p.orgId = :org", Product.class)
                .setParameter("org", orgId).getResultList().stream()
                .filter(p -> OperatorProductName.displayNameOrNull(p) != null)
                .toList();
    }

    private Map<UUID, List<ChannelProduct>> listingsOf(UUID orgId, Collection<UUID> ids) {
        return em.createQuery("select cp from ChannelProduct cp where cp.orgId = :org and cp.productId in :ids",
                        ChannelProduct.class)
                .setParameter("org", orgId).setParameter("ids", ids).getResultList().stream()
                .collect(Collectors.groupingBy(ChannelProduct::getProductId));
    }

    static Availability availabilityOf(List<ChannelProduct> listings) {
        if (listings.stream().anyMatch(l -> SellingStatus.normalize(l.getSellingStatus()) == SellingStatus.SELLING)) {
            return Availability.ON_SALE;
        }
        if (listings.isEmpty() || listings.stream()
                .anyMatch(l -> SellingStatus.normalize(l.getSellingStatus()) == SellingStatus.UNKNOWN)) {
            return Availability.STATUS_UNKNOWN;
        }
        return Availability.NOT_ON_SALE;
    }

    /**
     * Read the 상세페이지 of on-sale candidates that have none yet, through the existing one-product trigger. Nothing
     * when that switch is off. Every failure is swallowed: a missing read is a missing statement, never an error.
     */
    private int readMissingDetail(UUID orgId, List<UUID> ordered, Map<UUID, Availability> availability) {
        if (detail == null || !detail.enabled()) {
            return 0;
        }
        // Never-read listings first; then the trigger's own gate decides whether a read one changed since (by the
        // channel's modifiedDate) or aged out. A NOT_NEEDED answer costs no request and is not counted.
        List<UUID> onSale = ordered.stream().filter(id -> availability.get(id) == Availability.ON_SALE).toList();
        List<UUID> queue = new ArrayList<>(onSale.stream().filter(id -> detail.lastRead(orgId, id) == null).toList());
        onSale.stream().filter(id -> !queue.contains(id)).forEach(queue::add);
        int reads = 0;
        for (UUID id : queue) {
            if (reads >= MAX_DETAIL_READS) {
                break;
            }
            try {
                ProductDetailEnrichmentTrigger.Result r = detail.enrichIfNeeded(orgId, id);
                if (r.outcome() == ProductDetailEnrichmentTrigger.Outcome.CHANNEL_REFUSED) {
                    reads++;
                    break;  // the channel refused this caller; the next listing would be refused the same way
                }
                if (r.outcome() == ProductDetailEnrichmentTrigger.Outcome.APPLIED
                        || r.outcome() == ProductDetailEnrichmentTrigger.Outcome.READ_FAILED
                        || r.outcome() == ProductDetailEnrichmentTrigger.Outcome.NOT_FOUND) {
                    reads++;
                }
            } catch (RuntimeException ignored) {
                reads++;
            }
        }
        return reads;
    }

    private Map<UUID, List<Statement>> statements(UUID orgId, UUID currentProductId, List<UUID> ids,
                                                  Map<UUID, Product> products,
                                                  Map<UUID, List<ChannelProduct>> listings,
                                                  Map<UUID, Availability> availability) {
        Map<UUID, String> codes = new HashMap<>();
        Map<UUID, List<Statement>> out = new LinkedHashMap<>();
        for (UUID id : ids) {
            Product p = products.get(id);
            String name = OperatorProductName.displayNameOrNull(p);
            boolean current = id.equals(currentProductId);
            Availability a = availability.get(id);
            List<Statement> list = out.computeIfAbsent(id, k -> new ArrayList<>());
            List<ChannelProduct> rows = listings.getOrDefault(id, List.of());
            ChannelProduct best = rows.stream()
                    .filter(l -> SellingStatus.normalize(l.getSellingStatus()) == SellingStatus.SELLING)
                    .findFirst().orElse(rows.isEmpty() ? null : rows.get(0));
            String channel = best == null ? null : code(codes, best.getChannelId());
            Instant seen = best == null ? null : best.getLastSeenAt() != null ? best.getLastSeenAt() : best.getObservedAt();
            list.add(new Statement(id, name, current, a, channel, Field.PRODUCT_NAME, null, trim(p.getName()), seen, id));
            for (ChannelProduct l : rows) {
                if (l.getChannelProductName() != null && !l.getChannelProductName().isBlank()
                        && !l.getChannelProductName().strip().equals(p.getName() == null ? "" : p.getName().strip())) {
                    list.add(new Statement(id, name, current, a, code(codes, l.getChannelId()), Field.LISTING_NAME,
                            null, trim(l.getChannelProductName()),
                            l.getLastSeenAt() != null ? l.getLastSeenAt() : l.getObservedAt(), l.getId()));
                }
            }
        }
        for (ProductFact f : em.createQuery(
                        "select f from ProductFact f where f.orgId = :org and f.productId in :ids", ProductFact.class)
                .setParameter("org", orgId).setParameter("ids", ids).getResultList()) {
            if (f.getFactValue() == null || f.getFactValue().isBlank()
                    || FactKeys.DETAIL_PAGE.equals(f.getFactKey())) {
                continue;  // the page-shape marker is bookkeeping about the page, never a statement
            }
            String channel = channelOf(f.getSource());
            if (f.getFactKey() != null && f.getFactKey().startsWith(FactKeys.SUPPLEMENT_PREFIX)) {
                // Said as what it is — an add-on sold with this listing — so the drafter can never read the 추가상품's
                // figures as this product's own.
                add(out, products, currentProductId, availability, f.getProductId(), channel, Field.SUPPLEMENT,
                        f.getFactKey(), "추가상품으로 판매: " + f.getFactValue().strip(),
                        f.getSourceUpdatedAt() != null ? f.getSourceUpdatedAt() : f.getObservedAt(), f.getId());
                continue;
            }
            String value = f.getUnit() == null || f.getUnit().isBlank() ? f.getFactValue().strip()
                    : f.getFactValue().strip() + " " + f.getUnit().strip();
            for (String sentence : sentences(value)) {
                add(out, products, currentProductId, availability, f.getProductId(), channel, Field.FACT,
                        f.getFactKey(), sentence,
                        f.getSourceUpdatedAt() != null ? f.getSourceUpdatedAt() : f.getObservedAt(), f.getId());
            }
        }
        for (ProductVariant v : em.createQuery(
                        "select v from ProductVariant v where v.orgId = :org and v.productId in :ids",
                        ProductVariant.class)
                .setParameter("org", orgId).setParameter("ids", ids).getResultList()) {
            if (v.getOptionName() == null || v.getOptionName().isBlank()) {
                continue;
            }
            // An option the channel says is switched off, sold out or no longer listed is not on sale, whatever its
            // listing is; an option with no stated status inherits the listing's.
            SellingStatus optionStatus = SellingStatus.normalize(v.getSellingStatus());
            Map<UUID, Availability> optionAvailability = availability;
            if (optionStatus == SellingStatus.SUSPENDED || optionStatus == SellingStatus.ENDED) {
                optionAvailability = new HashMap<>(availability);
                optionAvailability.put(v.getProductId(), Availability.NOT_ON_SALE);
            }
            add(out, products, currentProductId, optionAvailability, v.getProductId(), code(codes, v.getChannelId()),
                    Field.OPTION, null, trim(v.getOptionName()),
                    v.getSourceUpdatedAt() != null ? v.getSourceUpdatedAt() : v.getObservedAt(), v.getId());
        }
        List<Object[]> passages = em.createQuery("""
                        select c, s from ProductKnowledgeChunk c, ProductKnowledgeSource s
                        where c.sourceId = s.id and c.orgId = :org and s.orgId = :org and c.productId in :ids
                          and s.active = true
                        """, Object[].class)
                .setParameter("org", orgId).setParameter("ids", ids).getResultList();
        for (Object[] row : passages) {
            ProductKnowledgeChunk c = (ProductKnowledgeChunk) row[0];
            ProductKnowledgeSource s = (ProductKnowledgeSource) row[1];
            for (String sentence : sentences(c.getContent())) {
                add(out, products, currentProductId, availability, c.getProductId(), null, Field.DETAIL, null,
                        sentence, s.getUpdatedAt(), c.getId());
            }
        }
        return out;
    }

    private static void add(Map<UUID, List<Statement>> out, Map<UUID, Product> products, UUID currentProductId,
                            Map<UUID, Availability> availability, UUID productId, String channel, Field field,
                            String factKey, String text, Instant at, UUID sourceId) {
        if (text == null || text.isBlank() || !products.containsKey(productId)) {
            return;
        }
        out.computeIfAbsent(productId, k -> new ArrayList<>()).add(new Statement(productId,
                OperatorProductName.displayNameOrNull(products.get(productId)), productId.equals(currentProductId),
                availability.get(productId), channel, field, factKey, trim(text), at, sourceId));
    }

    /** The first statement per product, in scan order, at most {@link #MAX_MATCHES} for the grounding list. */
    private static List<Statement> onePerProduct(List<Statement> statements) {
        Map<UUID, Statement> first = new LinkedHashMap<>();
        for (Statement s : statements) {
            first.putIfAbsent(s.productId(), s);
        }
        return first.values().stream().limit(MAX_MATCHES * 4L).toList();
    }

    static List<String> sentences(String text) {
        if (text == null) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (String s : SENTENCE.split(text)) {
            if (!s.isBlank()) {
                out.add(s.strip());
            }
        }
        return out;
    }

    private String code(Map<UUID, String> cache, UUID channelId) {
        if (channelId == null) {
            return null;
        }
        return cache.computeIfAbsent(channelId, id -> channels.findById(id).map(Channel::getCode).orElse(null));
    }

    static String channelOf(String source) {
        if (source == null || source.isBlank() || source.startsWith("DERIVED")) {
            return null;
        }
        int at = source.indexOf(':');
        return at < 0 ? source : source.substring(0, at);
    }

    static String squash(String s) {
        return s == null ? "" : s.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
    }

    private static String trim(String s) {
        String flat = s == null ? "" : s.replaceAll("\\s+", " ").strip();
        return flat.length() > MAX_TEXT ? flat.substring(0, MAX_TEXT) + "…" : flat;
    }
}
