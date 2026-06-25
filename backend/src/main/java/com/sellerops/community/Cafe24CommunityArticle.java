package com.sellerops.community;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One Cafe24 community board article (a review or inquiry post) stored as a durable
 * SellerOps data asset. This is a <b>dedicated</b> table — deliberately not the
 * shared, insert-only {@code reviews}/{@code inquiries} tables — because Cafe24
 * articles carry board/article identity, a finer {@code source_kind}, a
 * {@code reply_status} that changes over time, source timestamps, rating, and
 * {@code product_no}, and must support <b>hash-guarded upsert</b>.
 *
 * <p>Natural key: {@code (channel_id, seller_account_id, board_no, article_no)}.
 * The mutable fields (title, content, rating, reply_status) are updated in place
 * only when {@code source_hash} changes; an unchanged hash is a no-op. AI-generated
 * outputs (summaries, reply drafts) never live on this row — the source asset stays
 * separate from derived AI data.
 */
@Getter
@Setter
@Entity
@Table(name = "cafe24_community_articles",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_cafe24_articles_natural",
                columnNames = {"channel_id", "seller_account_id", "board_no", "article_no"}))
public class Cafe24CommunityArticle extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Column(name = "board_no", nullable = false)
    private int boardNo;

    @Column(name = "article_no", nullable = false)
    private long articleNo;

    /** Normalized {@link CommunitySourceKind} name; stable for the life of the article. */
    @Column(name = "source_kind", nullable = false)
    private String sourceKind;

    @Column(name = "product_no")
    private Long productNo;

    @Column(name = "title")
    private String title;

    @Column(name = "content")
    private String content;

    @Column(name = "rating")
    private Integer rating;

    /** Normalized {@link CommunityReplyStatus} name; mutable as a post gets answered. */
    @Column(name = "reply_status", nullable = false)
    private String replyStatus;

    @Column(name = "source_created_at")
    private Instant sourceCreatedAt;

    @Column(name = "source_updated_at")
    private Instant sourceUpdatedAt;

    /** Fingerprint over the mutable fields; an unchanged value means a no-op upsert. */
    @Column(name = "source_hash", nullable = false)
    private String sourceHash;

    @Column(name = "collected_at", nullable = false)
    private Instant collectedAt;
}
