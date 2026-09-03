package com.sellerops.workspace;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.queue.InquiryQueueService;
import com.sellerops.inquiry.queue.InquiryRowsService;
import com.sellerops.inquiry.queue.dto.InquiryRowsResponse;
import com.sellerops.inquiry.queue.dto.InquiryQueueItem;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductCatalogService;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.dto.ProductCatalogView;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>Operational Workspace UX System v1 — the two facts the workspace stopped guessing.</b>
 *
 * <p><b>A phase is not a draft.</b> The 문의 list said 「초안 준비됨」 whenever a work item sat in
 * {@code PROPOSED}. That phase is written when a PROPOSAL is recorded, and an {@code InquiryProposal}
 * states in its own contract that it persists no reply text; on 2026-09-04 the demo org held ten such
 * rows and eight had no draft. The screen was sending the seller to read something nobody had written.
 *
 * <p><b>A page is not a total, and a resolver is not a worklist.</b> The 상품 screen asked the product
 * RESOLVER for its empty-query head — alphabetical, capped — and printed the length of what came back
 * as 「상품 10개」. The demo org has 308 products; six of the ten shown had no inquiry and no review at
 * all, and the product carrying 1,761 reviews was not on the page.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class OperationalWorkspaceTruthTest {

    @Autowired OrganizationRepository organizations;
    @Autowired ProductRepository products;
    @Autowired ChannelRepository channels;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository drafts;
    @Autowired ReviewRepository reviews;

    private UUID org;
    private UUID channelId;
    private final UUID sellerAccountId = UUID.randomUUID();
    private InquiryQueueService queue;
    private InquiryRowsService rows;
    private ProductCatalogService catalogue;

    @BeforeEach
    void setUp() {
        Organization o = new Organization();
        o.setName("운영 워크스페이스 QA");
        org = organizations.save(o).getId();
        channelId = channels.findAll().stream().findFirst().map(Channel::getId).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("CAFE24");
            c.setNameKo("카페24 자사몰");
            c.setStatus(com.sellerops.channel.ChannelStatus.CONNECTED);
            return channels.save(c).getId();
        });
        queue = new InquiryQueueService(workItems, inquiries, channels, products,
                com.sellerops.identity.ExecutableIdentityResolver.unresolved(), drafts);
        rows = new InquiryRowsService(inquiries, workItems, channels, products,
                com.sellerops.identity.ExecutableIdentityResolver.unresolved());
        catalogue = new ProductCatalogService(products, inquiries, reviews);
    }

    private UUID inquiry(String title, UUID productId) {
        Inquiry i = new Inquiry();
        i.setOrgId(org);
        i.setChannelId(channelId);
        i.setExternalId("ext-" + UUID.randomUUID());
        i.setTitle(title);
        i.setBody("고객 문장");
        i.setStatus("UNANSWERED");
        i.setReceivedAt(Instant.now());
        i.setDataOrigin(DataOrigin.REAL);
        i.setProductId(productId);
        return inquiries.save(i).getId();
    }

    private UUID workItem(UUID inquiryId, InquiryWorkItemPhase phase) {
        InquiryWorkItem w = new InquiryWorkItem();
        w.setOrgId(org);
        w.setInquiryId(inquiryId);
        w.setChannelId(channelId);
        w.setSellerAccountId(sellerAccountId);
        w.setPhase(phase);
        return workItems.save(w).getId();
    }

    private void answered(UUID inquiryId) {
        Inquiry i = inquiries.findById(inquiryId).orElseThrow();
        i.setStatus("ANSWERED");
        inquiries.save(i);
    }

    private UUID product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku("SKU-" + UUID.randomUUID());
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    private void review(UUID productId, boolean negative) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setProductId(productId);
        r.setExternalId("rev-" + UUID.randomUUID());
        r.setBody("리뷰 문장");
        r.setRating(negative ? 1 : 5);
        r.setNegative(negative);
        r.setReceivedAt(Instant.now());
        r.setDataOrigin(DataOrigin.REAL);
        reviews.save(r);
    }

    @Test
    @DisplayName("초안 준비됨 needs a draft — a PROPOSED row with only a proposal does not claim one")
    void aPhaseIsNotADraft() {
        UUID withDraft = workItem(inquiry("초안 있는 문의", null), InquiryWorkItemPhase.PROPOSED);
        UUID withoutDraft = workItem(inquiry("초안 없는 문의", null), InquiryWorkItemPhase.PROPOSED);

        InquiryReplyDraft d = new InquiryReplyDraft();
        d.setOrgId(org);
        d.setWorkItemId(withDraft);
        d.setVersion(1);
        d.setTitle("답변");
        d.setComments("판매자에게 보여 줄 초안");
        d.setAuthorKind("MODEL");
        d.setContentFingerprint("fp-1");
        d.setFingerprintAlgorithm("SHA-256");
        d.setAnswerStatus(1);
        d.setCreatedBy("QA");
        drafts.save(d);

        List<InquiryQueueItem> rows = queue.queue(org, InquiryWorkItemPhase.PROPOSED, 0, 20).content();

        assertThat(rows).hasSize(2);
        assertThat(rows).allSatisfy(r -> assertThat(r.phase()).isEqualTo("PROPOSED"));
        assertThat(rows).filteredOn(InquiryQueueItem::hasDraft).extracting(InquiryQueueItem::workItemId)
                .containsExactly(withDraft);
        assertThat(rows).filteredOn(r -> !r.hasDraft()).extracting(InquiryQueueItem::workItemId)
                .containsExactly(withoutDraft);
    }

    @Test
    @DisplayName("without the draft repository no row claims a draft — an unread fact is not a true one")
    void anUnreadFactIsNotATrueFact() {
        UUID item = workItem(inquiry("초안 있는 문의", null), InquiryWorkItemPhase.PROPOSED);
        InquiryReplyDraft d = new InquiryReplyDraft();
        d.setOrgId(org);
        d.setWorkItemId(item);
        d.setVersion(1);
        d.setTitle("답변");
        d.setComments("초안");
        d.setAuthorKind("MODEL");
        d.setContentFingerprint("fp-2");
        d.setFingerprintAlgorithm("SHA-256");
        d.setAnswerStatus(1);
        d.setCreatedBy("QA");
        drafts.save(d);

        InquiryQueueService blind = new InquiryQueueService(workItems, inquiries, channels, products);

        assertThat(blind.queue(org, InquiryWorkItemPhase.PROPOSED, 0, 20).content())
                .allSatisfy(r -> assertThat(r.hasDraft()).isFalse());
    }

    @Test
    @DisplayName("the 상품 page leads with what the seller owes, and states the catalogue's real size")
    void aPageIsNotATotal() {
        UUID quiet = product("가 아무 일도 없는 상품");   // first alphabetically, and the least urgent
        UUID loud = product("하 리뷰가 몰린 상품");
        UUID owed = product("나 답변을 기다리는 상품");
        for (int i = 0; i < 5; i++) review(loud, i < 2);
        review(quiet, false);
        inquiry("답을 기다리는 질문", owed);

        ProductCatalogView page = catalogue.catalog(org, 2);

        assertThat(page.total()).isEqualTo(3);
        // The unanswered inquiry outranks five reviews; the alphabetical head would have led with 가.
        assertThat(page.rows()).extracting(r -> r.id()).containsExactly(owed, loud);
    }

    @Test
    @DisplayName("the doorway and the number mean the same rows — 미답변 문의 N opens exactly N")
    void aNumberAndItsDoorAgree() {
        UUID watched = product("문의가 몰린 상품");
        UUID other = product("다른 상품");
        inquiry("이 상품 미답변 1", watched);
        inquiry("이 상품 미답변 2", watched);
        answered(inquiry("이 상품 답변함", watched));
        inquiry("다른 상품 미답변", other);
        inquiry("상품 없는 미답변", null);

        long printed = inquiries.countByOrgIdAndProductIdAndStatus(org, watched, "UNANSWERED");
        InquiryRowsResponse opened = rows.rows(org, null, null, null, "UNANSWERED", "NEWEST", 50, null,
                watched, null);

        // The figure the 상품 screen prints, and the list pressing it opens.
        assertThat(printed).isEqualTo(2);
        assertThat(opened.totalCount()).isEqualTo(printed);
        assertThat(opened.items()).allSatisfy(r -> assertThat(r.productId()).isEqualTo(watched));
        // And it echoes the axis it was narrowed by, like every other one.
        assertThat(opened.productId()).isEqualTo(watched);
    }

    @Test
    @DisplayName("a deep link reads ONE exact row through the same predicate — not a page it hopes contains it")
    void aDeepLinkIsExact() {
        UUID wanted = inquiry("링크가 가리키는 문의", null);
        for (int i = 0; i < 5; i++) inquiry("다른 문의 " + i, null);

        InquiryRowsResponse one = rows.rows(org, null, null, null, null, "NEWEST", 50, null, null, wanted);

        assertThat(one.items()).hasSize(1);
        assertThat(one.items().get(0).inquiryId()).isEqualTo(wanted);
        assertThat(one.totalCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("another org's product narrows to nothing — never a probe, never the whole record")
    void aForeignProductIsNotAProbe() {
        inquiry("우리 문의", product("우리 상품"));

        InquiryRowsResponse foreign = rows.rows(org, null, null, null, null, "NEWEST", 50, null,
                UUID.randomUUID(), null);

        assertThat(foreign.items()).isEmpty();
        assertThat(foreign.totalCount()).isZero();
    }

    @Test
    @DisplayName("the catalogue page is bounded, so the screen's per-row reads stay bounded with it")
    void theHeadIsBounded() {
        for (int i = 0; i < 25; i++) product("상품 " + i);

        assertThat(catalogue.catalog(org, 1000).rows())
                .hasSize(ProductCatalogService.CATALOG_PAGE);
    }
}
