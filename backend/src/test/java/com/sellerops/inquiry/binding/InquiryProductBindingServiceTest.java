package com.sellerops.inquiry.binding;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.user.UserRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The honest fallback for 3,307 Cafe24 inquiries whose source never named a product.
 *
 * <p>Every assertion here is about keeping two things apart that a single {@code product_id} column
 * would collapse: what the channel proved, and what a person decided. The first can be re-checked by
 * reading the channel again; the second cannot, and a draft grounded in the wrong one is a wrong
 * answer with a citation attached.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryProductBindingServiceTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ProductRepository products;
    @Autowired UserRepository users;
    @Autowired InquiryProductBindingEventRepository events;

    private final UUID org = UUID.randomUUID();
    private final UUID actor = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private InquiryProductBindingService service;

    @BeforeEach
    void setUp() {
        service = new InquiryProductBindingService(workItems, inquiries, products, users, events);
    }

    private UUID product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setStatus("ACTIVE");
        return products.save(p).getId();
    }

    /** An unattributed Cafe24 board article — the ordinary shape of the backlog. */
    private UUID workItem(UUID productId, InquiryProductBinding binding) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setBody("문의 본문");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        q.setExternalId("cafe24:b6:a" + UUID.randomUUID());
        q.setProductId(productId);
        q.setProductBinding(binding == null ? null : binding.name());
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem item = new InquiryWorkItem();
        item.setOrgId(org);
        item.setInquiryId(inquiryId);
        item.setChannelId(channelId);
        item.setSellerAccountId(UUID.randomUUID());
        item.setPhase(InquiryWorkItemPhase.OPEN);
        return workItems.save(item).getId();
    }

    @Test
    @DisplayName("상품 미지정 문의는 사람이 지목할 수 있고, 그 사실은 SOURCE_EXACT와 다른 값으로 남는다")
    void aPersonCanBindAnUnattributedInquiry() {
        UUID productId = product("선바로 전선몰딩");
        UUID item = workItem(null, null);

        var view = service.bind(org, item, productId, false, actor);

        assertThat(view.productId()).isEqualTo(productId);
        assertThat(view.binding()).isEqualTo("USER_CONFIRMED");
        assertThat(view.boundAt()).isNotNull();
        // The point of the whole split: a reader can tell this from a channel match.
        assertThat(view.binding()).isNotEqualTo(InquiryProductBinding.SOURCE_EXACT.name());
    }

    @Test
    @DisplayName("채널이 정한 귀속은 한 번 더 확인하지 않으면 사람이 덮어쓰지 못한다")
    void aSourceBindingIsNotSilentlyOverwritten() {
        UUID sourceProduct = product("채널이 맞춘 상품");
        UUID other = product("사람이 고른 상품");
        UUID item = workItem(sourceProduct, InquiryProductBinding.SOURCE_EXACT);

        assertThatThrownBy(() -> service.bind(org, item, other, false, actor))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getCode())
                .isEqualTo(InquiryProductBindingService.SOURCE_BINDING_EXISTS);
        // Refused means refused: nothing moved, and no event was written for a change that did not
        // happen.
        assertThat(inquiries.findAll().get(0).getProductId()).isEqualTo(sourceProduct);
        assertThat(events.findAll()).isEmpty();

        var view = service.bind(org, item, other, true, actor);
        assertThat(view.productId()).isEqualTo(other);
        assertThat(view.binding()).isEqualTo("USER_CONFIRMED");
    }

    @Test
    @DisplayName("바뀐 연결은 이전 연결을 지우지 않고 그 위에 쌓인다")
    void rebindingKeepsWhatItReplaced() {
        UUID first = product("처음 고른 상품");
        UUID second = product("고쳐 고른 상품");
        UUID item = workItem(null, null);

        service.bind(org, item, first, false, actor);
        service.bind(org, item, second, false, actor);

        assertThat(events.findAll()).hasSize(2);
        var latest = events.findAll().stream()
                .filter(e -> second.equals(e.getProductId()))
                .findFirst().orElseThrow();
        // A draft written before the correction was grounded in the FIRST product's library, and this
        // row is the only way to read that back.
        assertThat(latest.getPreviousProductId()).isEqualTo(first);
        assertThat(latest.getPreviousBinding()).isEqualTo("USER_CONFIRMED");
        assertThat(latest.getActorUserId()).isEqualTo(actor);
    }

    @Test
    @DisplayName("이미 지목한 상품을 다시 지목하는 것은 아무 일도 아니다")
    void rebindingToTheSameProductRecordsNothing() {
        UUID productId = product("같은 상품");
        UUID item = workItem(null, null);

        service.bind(org, item, productId, false, actor);
        service.bind(org, item, productId, false, actor);

        assertThat(events.findAll()).hasSize(1);
    }

    @Test
    @DisplayName("다른 org의 상품은 존재조차 알려주지 않는다")
    void crossOrgProductsAreNotFound() {
        Product foreign = new Product();
        foreign.setOrgId(UUID.randomUUID());
        foreign.setName("남의 상품");
        foreign.setStatus("ACTIVE");
        UUID foreignId = products.save(foreign).getId();
        UUID item = workItem(null, null);

        assertThatThrownBy(() -> service.bind(org, item, foreignId, false, actor))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("상품을 찾을 수 없습니다");
        assertThat(events.findAll()).isEmpty();
    }

    @Test
    @DisplayName("이름이 확인되지 않은 상품 — ingest가 만든 버킷 — 에는 연결할 수 없다")
    void theSharedBucketIsNotABindableProduct() {
        Product bucket = new Product();
        bucket.setOrgId(org);
        bucket.setName("(미지정 상품)");
        bucket.setStatus("ACTIVE");
        UUID bucketId = products.save(bucket).getId();
        UUID item = workItem(null, null);

        // Binding to it would hand the inquiry a library nobody wrote, for a product nobody sells.
        assertThatThrownBy(() -> service.bind(org, item, bucketId, false, actor))
                .isInstanceOf(ApiException.class);
        assertThat(events.findAll()).isEmpty();
    }
}
