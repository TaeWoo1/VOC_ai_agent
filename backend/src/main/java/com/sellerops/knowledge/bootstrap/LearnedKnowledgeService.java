package com.sellerops.knowledge.bootstrap;

import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.MarkupText;
import com.sellerops.knowledge.memory.AnswerMemory;
import com.sellerops.knowledge.spine.adapter.ReviewReplyAdapter;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>What Reviewnary has learned about this company, and from where</b> — the read behind the knowledge screen's
 * 「Reviewnary가 배운 것」.
 *
 * <p>Counts and a few examples per source, straight from the tables the Knowledge Spine reads — so what this screen
 * says was learned is exactly what a case can retrieve. Beside them, per connected channel, the one sentence
 * {@link ChannelHistoryCapability} states about each history source, so a source that cannot be learned is named as
 * such rather than shown as zero.
 *
 * <p>Reads only; no marketplace, no model. The examples are this company's own sentences — its answers, its
 * replies, its notes — shown to that company.
 */
@Service
public class LearnedKnowledgeService {

    static final int EXAMPLES = 2;
    static final int EXCERPT_CHARS = 90;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    public record Example(String title, String excerpt, String provenance, String productName, LocalDate capturedOn) {
    }

    public record Source(String key, String labelKo, long count, LocalDate latestOn, List<Example> examples) {
    }

    public record ChannelLine(String channelNameKo, HistorySource source, String sourceLabelKo,
                              ChannelHistoryCapability.Availability availability, String sentenceKo) {
    }

    public record HistoryRead(String channelNameKo, LocalDate readOn, int rowsRead) {
    }

    public record View(List<Source> sources, List<ChannelLine> channels, List<HistoryRead> historyReads,
                       boolean canLearnHistory) {
    }

    private final EntityManager em;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ProductRepository products;

    public LearnedKnowledgeService(EntityManager em, SellerAccountRepository accounts, ChannelRepository channels,
                                   ProductRepository products) {
        this.em = em;
        this.accounts = accounts;
        this.channels = channels;
        this.products = products;
    }

    @Transactional(readOnly = true)
    public View of(UUID orgId) {
        List<Source> sources = List.of(pastAnswers(orgId), pastReplies(orgId), productDetail(orgId),
                sellerMaterial(orgId), sellerGuidance(orgId));
        List<ChannelLine> lines = new ArrayList<>();
        List<HistoryRead> reads = new ArrayList<>();
        boolean canLearn = false;
        Set<String> seen = new LinkedHashSet<>();
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            if (account.getConnectionStatus() != ChannelStatus.CONNECTED || account.isFileUpload()) {
                continue;
            }
            Channel channel = channels.findById(account.getChannelId()).orElse(null);
            if (channel == null) {
                continue;
            }
            if (ChannelHistoryCapability.learnsInquiryHistory(channel.getCode())) {
                canLearn = true;
                SyncJob read = lastRead(account.getId());
                if (read != null) {
                    reads.add(new HistoryRead(channel.getNameKo(), dateOf(read.getFinishedAt()),
                            read.getSuccessRows()));
                }
            }
            if (!seen.add(channel.getCode())) {
                continue;
            }
            for (HistorySource source : HistorySource.values()) {
                ChannelHistoryCapability.Row row = ChannelHistoryCapability.of(channel.getCode(), source);
                lines.add(new ChannelLine(channel.getNameKo(), source, source.labelKo(), row.availability(),
                        row.sentenceKo()));
            }
        }
        return new View(sources, lines, reads, canLearn);
    }

    private Source pastAnswers(UUID orgId) {
        List<AnswerMemory> rows = em.createQuery("""
                        select m from AnswerMemory m where m.orgId = :org order by m.updatedAt desc
                        """, AnswerMemory.class)
                .setParameter("org", orgId).getResultList();
        List<Example> examples = rows.stream().limit(EXAMPLES)
                .map(m -> new Example(m.getAnswerTitle(), excerpt(m.getAnswerBody()),
                        m.getStrength() == null ? "문의 답변" : "문의 답변 · " + m.getStrength().labelKo(),
                        productName(orgId, m.getProductId()), dateOf(m.getUpdatedAt())))
                .toList();
        return new Source(HistorySource.PAST_INQUIRY_ANSWER.name(), HistorySource.PAST_INQUIRY_ANSWER.labelKo(),
                rows.size(), rows.isEmpty() ? null : dateOf(rows.get(0).getUpdatedAt()), examples);
    }

    private Source pastReplies(UUID orgId) {
        List<Object[]> rows = em.createQuery("""
                        select a.decidedAt, d.body, d.authorKind, a.approvedFingerprint, d.contentFingerprint,
                               r.productId, r.rating
                        from ReviewReplyApproval a, ReviewReplyDraft d, Review r
                        where a.orgId = :org and a.state = :approved
                          and d.orgId = :org and d.reviewId = a.reviewId and d.version = a.approvedVersion
                          and r.orgId = :org and r.id = a.reviewId
                        order by a.decidedAt desc
                        """, Object[].class)
                .setParameter("org", orgId)
                .setParameter("approved", ReviewReplyApprovalState.APPROVED)
                .getResultList().stream()
                // The Spine's own rule: the approved version only, and never a template.
                .filter(r -> ReviewReplyAdapter.isAnswer((String) r[2]) && r[3] != null && r[3].equals(r[4]))
                .toList();
        List<Example> examples = rows.stream().limit(EXAMPLES)
                .map(r -> new Example(r[6] == null ? "리뷰 답글" : "리뷰 답글 · 별점 " + r[6] + "점",
                        excerpt((String) r[1]), "리뷰 답글 · 판매자가 승인한 답글", productName(orgId, (UUID) r[5]),
                        dateOf((Instant) r[0])))
                .toList();
        return new Source(HistorySource.PAST_REVIEW_REPLY.name(), HistorySource.PAST_REVIEW_REPLY.labelKo(),
                rows.size(), rows.isEmpty() ? null : dateOf((Instant) rows.get(0)[0]), examples);
    }

    /** Products the channel told us about: a read 상세페이지, or stated facts. Counted by product, not by row. */
    private Source productDetail(UUID orgId) {
        List<Object[]> documents = em.createQuery("""
                        select s.productId, s.updatedAt, s.body from ProductKnowledgeSource s
                        where s.orgId = :org and s.authoredOrigin = :channel and s.active = true
                        order by s.updatedAt desc
                        """, Object[].class)
                .setParameter("org", orgId)
                .setParameter("channel", KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT)
                .getResultList();
        List<Object[]> facts = em.createQuery("""
                        select f.productId, max(f.observedAt), count(f) from ProductFact f
                        where f.orgId = :org and f.factValue is not null
                        group by f.productId order by max(f.observedAt) desc
                        """, Object[].class)
                .setParameter("org", orgId).getResultList();
        Set<UUID> productIds = new LinkedHashSet<>();
        documents.forEach(d -> productIds.add((UUID) d[0]));
        facts.forEach(f -> productIds.add((UUID) f[0]));
        List<Example> examples = new ArrayList<>();
        for (Object[] d : documents) {
            if (examples.size() >= EXAMPLES) {
                break;
            }
            examples.add(new Example("상품 상세페이지", excerpt((String) d[2]), "채널 상품 상세페이지",
                    productName(orgId, (UUID) d[0]), dateOf((Instant) d[1])));
        }
        for (Object[] f : facts) {
            if (examples.size() >= EXAMPLES) {
                break;
            }
            examples.add(new Example("채널이 알려 준 상품 정보 " + f[2] + "개", null, "채널 상품 정보",
                    productName(orgId, (UUID) f[0]), dateOf((Instant) f[1])));
        }
        Instant latest = null;
        if (!documents.isEmpty()) {
            latest = (Instant) documents.get(0)[1];
        }
        if (!facts.isEmpty() && facts.get(0)[1] != null
                && (latest == null || ((Instant) facts.get(0)[1]).isAfter(latest))) {
            latest = (Instant) facts.get(0)[1];
        }
        return new Source(HistorySource.PRODUCT_DETAIL.name(), HistorySource.PRODUCT_DETAIL.labelKo(),
                productIds.size(), dateOf(latest), examples);
    }

    /** What the seller wrote or uploaded themselves — product notes and company rules, current ones only. */
    private Source sellerMaterial(UUID orgId) {
        List<Object[]> rows = new ArrayList<>(em.createQuery("""
                        select s.title, s.body, s.updatedAt, s.productId from ProductKnowledgeSource s
                        where s.orgId = :org and s.authoredOrigin <> :channel and s.active = true
                        """, Object[].class)
                .setParameter("org", orgId)
                .setParameter("channel", KnowledgeAuthorship.SELLER_AUTHORED_CHANNEL_CONTENT)
                .getResultList());
        em.createQuery("""
                        select s.title, s.body, s.updatedAt, s.orgId from OrgKnowledgeSource s
                        where s.orgId = :org and s.active = true
                        """, Object[].class)
                .setParameter("org", orgId).getResultList()
                // The fourth column is not a product; an org rule has none.
                .forEach(r -> rows.add(new Object[] {r[0], r[1], r[2], null}));
        rows.sort((a, b) -> compareDesc((Instant) a[2], (Instant) b[2]));
        List<Example> examples = rows.stream().limit(EXAMPLES)
                .map(r -> new Example(titleUnlessRepeated((String) r[0], (String) r[1]), excerpt((String) r[1]),
                        r[3] == null ? "판매자가 등록한 회사 기준" : "판매자가 등록한 상품 지식",
                        productName(orgId, (UUID) r[3]), dateOf((Instant) r[2])))
                .toList();
        return new Source("SELLER_MATERIAL", "판매자가 알려준 자료", rows.size(),
                rows.isEmpty() ? null : dateOf((Instant) rows.get(0)[2]), examples);
    }

    /** The 「다음에도 참고」 notes the seller kept from their own corrections. */
    private Source sellerGuidance(UUID orgId) {
        List<Object[]> rows = em.createQuery("""
                        select g.guidance, g.createdAt, g.productId from SellerGuidance g
                        where g.orgId = :org order by g.createdAt desc
                        """, Object[].class)
                .setParameter("org", orgId).getResultList();
        List<Example> examples = rows.stream().limit(EXAMPLES)
                .map(r -> new Example("다음에도 참고", excerpt((String) r[0]), "판매자가 고친 내용",
                        productName(orgId, (UUID) r[2]), dateOf((Instant) r[1])))
                .toList();
        return new Source("SELLER_GUIDANCE", "판매자가 고쳐 준 방식", rows.size(),
                rows.isEmpty() ? null : dateOf((Instant) rows.get(0)[1]), examples);
    }

    private SyncJob lastRead(UUID sellerAccountId) {
        return em.createQuery("""
                        select j from SyncJob j
                        where j.sellerAccountId = :account and j.dataType = 'INQUIRY'
                          and j.trigger = :trigger and j.status = 'SUCCESS'
                        order by j.finishedAt desc
                        """, SyncJob.class)
                .setParameter("account", sellerAccountId)
                .setParameter("trigger", KnowledgeBootstrapService.TRIGGER)
                .setMaxResults(1)
                .getResultList().stream().findFirst().orElse(null);
    }

    private String productName(UUID orgId, UUID productId) {
        return productId == null ? null : products.findById(productId)
                .filter(p -> orgId.equals(p.getOrgId()))
                .map(OperatorProductName::displayNameOrNull).orElse(null);
    }

    /** A title that is only the body's first words says the same thing twice beside its excerpt. */
    static String titleUnlessRepeated(String title, String body) {
        if (title == null || body == null) {
            return title;
        }
        String head = title.replace("…", "").replace("...", "").strip();
        String flat = MarkupText.toPlainText(body);
        return flat != null && !head.isEmpty() && flat.replaceAll("\\s+", " ").strip().startsWith(head) ? null : title;
    }

    static String excerpt(String text) {
        String plain = MarkupText.toPlainText(text);
        if (plain == null) {
            return null;
        }
        String flat = plain.replaceAll("\\s+", " ").strip();
        return flat.length() <= EXCERPT_CHARS ? flat : flat.substring(0, EXCERPT_CHARS) + "…";
    }

    private static LocalDate dateOf(Instant at) {
        return at == null ? null : LocalDate.ofInstant(at, KST);
    }

    private static int compareDesc(Instant a, Instant b) {
        if (a == null) {
            return b == null ? 0 : 1;
        }
        return b == null ? -1 : b.compareTo(a);
    }
}
