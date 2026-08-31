package com.sellerops.inquiry.queue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.queue.dto.InquiryRowItem;
import com.sellerops.inquiry.queue.dto.InquiryRowsResponse;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.product.ProductRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
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
 * Query Accuracy v1 — the inquiry ROWS read. Every QuerySpec axis (window · channel · status · order ·
 * limit) is applied by the query, and the work item rides along only while it is still workable.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryRowsServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 8, 28);
    private static final Clock CLOCK = Clock.fixed(TODAY.atStartOfDay(ZoneOffset.UTC).toInstant().plusSeconds(3600), ZoneOffset.UTC);

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired ChannelRepository channels;
    @Autowired ProductRepository products;

    private InquiryRowsService service;
    private UUID org;
    private UUID naver;
    private UUID cafe24;

    @BeforeEach
    void setUp() {
        service = new InquiryRowsService(inquiries, workItems, channels, products,
                com.sellerops.identity.ExecutableIdentityResolver.unresolved(), CLOCK);
        org = UUID.randomUUID();
        naver = channels.findByCode("NAVER").map(Channel::getId).orElseGet(() -> channel("NAVER", "네이버"));
        cafe24 = channels.findByCode("CAFE24").map(Channel::getId).orElseGet(() -> channel("CAFE24", "카페24"));
    }

    private UUID channel(String code, String name) {
        Channel c = new Channel();
        c.setCode(code);
        c.setNameKo(name);
        c.setStatus(com.sellerops.channel.ChannelStatus.AVAILABLE);
        c.setSupportsInquiry(true);
        c.setSupportsReview(true);
        c.setSupportsOrder(true);
        c.setSupportsSales(true);
        c.setSupportsProduct(true);
        return channels.save(c).getId();
    }

    private UUID inquiry(UUID channelId, String status, String receivedOn, DataOrigin origin) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setTitle("문의 " + receivedOn);
        q.setBody("본문");
        q.setStatus(status);
        q.setDataOrigin(origin);
        q.setReceivedAt(Instant.parse(receivedOn + "T09:00:00Z"));
        return inquiries.save(q).getId();
    }

    private UUID workItem(UUID inquiryId, UUID channelId, InquiryWorkItemPhase phase) {
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(channelId);
        wi.setPhase(phase);
        return workItems.save(wi).getId();
    }

    private static List<String> days(InquiryRowsResponse r) {
        return r.items().stream().map(i -> i.receivedAt().toString().substring(0, 10)).toList();
    }

    @Test
    @DisplayName("window · order · limit: 「가장 오래된 1개」 and 「최근 3개」 are the same read with different tokens")
    void windowOrderLimit() {
        inquiry(cafe24, "UNANSWERED", "2016-03-19", DataOrigin.REAL);
        inquiry(cafe24, "ANSWERED", "2026-08-20", DataOrigin.REAL);
        inquiry(naver, "UNANSWERED", "2026-08-27", DataOrigin.REAL);
        inquiry(naver, "UNANSWERED", "2026-08-28", DataOrigin.REAL);

        InquiryRowsResponse newest3 = service.rows(org, null, null, null, null, "NEWEST", 3);
        assertThat(days(newest3)).containsExactly("2026-08-28", "2026-08-27", "2026-08-20");
        assertThat(newest3.totalCount()).isEqualTo(4);
        assertThat(newest3.limit()).isEqualTo(3);

        InquiryRowsResponse oldest1 = service.rows(org, null, null, null, null, "OLDEST", 1);
        assertThat(days(oldest1)).containsExactly("2016-03-19");
        assertThat(oldest1.totalCount()).isEqualTo(4);

        InquiryRowsResponse today = service.rows(org, TODAY, TODAY, null, null, null, null);
        assertThat(days(today)).containsExactly("2026-08-28");
        assertThat(today.totalCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("channel and status narrow the same predicate as the count")
    void channelAndStatus() {
        inquiry(cafe24, "UNANSWERED", "2026-08-26", DataOrigin.REAL);
        inquiry(naver, "ANSWERED", "2026-08-27", DataOrigin.REAL);
        inquiry(naver, "UNANSWERED", "2026-08-28", DataOrigin.REAL);
        inquiry(naver, "UNANSWERED", "2026-08-28", DataOrigin.DEMO_SEED);

        InquiryRowsResponse naverAll = service.rows(org, null, null, "naver", "ALL", null, null);
        assertThat(naverAll.items()).hasSize(2);
        assertThat(naverAll.items()).allMatch(i -> "NAVER".equals(i.channelCode()));
        assertThat(naverAll.channel()).isEqualTo("NAVER");

        InquiryRowsResponse naverOpen = service.rows(org, null, null, "NAVER", "UNANSWERED", null, null);
        assertThat(naverOpen.items()).hasSize(1);
        assertThat(naverOpen.totalCount()).isEqualTo(1);
        assertThat(naverOpen.items().get(0).status()).isEqualTo("UNANSWERED");

        InquiryRowsResponse answered = service.rows(org, null, null, null, "ANSWERED", null, null);
        assertThat(answered.items()).extracting(InquiryRowItem::status).containsOnly("ANSWERED");

        assertThatThrownBy(() -> service.rows(org, null, null, "ESM", null, null, null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.rows(org, null, null, null, "MAYBE", null, null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.rows(org, null, null, null, null, "RANDOM", null)).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("the workable work item rides on the row; a terminal one does not; another org sees nothing")
    void workItemAndTenancy() {
        UUID open = inquiry(naver, "UNANSWERED", "2026-08-28", DataOrigin.REAL);
        UUID openWi = workItem(open, naver, InquiryWorkItemPhase.OPEN);
        UUID done = inquiry(naver, "ANSWERED", "2026-08-27", DataOrigin.REAL);
        workItem(done, naver, InquiryWorkItemPhase.COMPLETED);

        InquiryRowsResponse rows = service.rows(org, null, null, null, null, null, null);
        assertThat(rows.items()).hasSize(2);
        InquiryRowItem first = rows.items().get(0);
        assertThat(first.inquiryId()).isEqualTo(open);
        assertThat(first.workItemId()).isEqualTo(openWi);
        assertThat(first.phase()).isEqualTo("OPEN");
        assertThat(rows.items().get(1).workItemId()).isNull();
        assertThat(rows.items().get(1).phase()).isNull();

        assertThat(service.rows(UUID.randomUUID(), null, null, null, null, null, null).items()).isEmpty();
    }

    @Test
    @DisplayName("자정 경계 KST: a window date is the seller's Asia/Seoul day, not a UTC day")
    void windowIsSellersCalendarDay() {
        LocalDate day = LocalDate.of(2026, 8, 28);
        UUID inDay = inquiryAt(naver, "2026-08-27T16:00:00Z");   // 08-28 01:00 KST — the seller's 08-28
        inquiryAt(naver, "2026-08-27T14:59:00Z");                // 08-27 23:59 KST — the day before
        inquiryAt(naver, "2026-08-28T15:30:00Z");                // 08-29 00:30 KST — the day after

        InquiryRowsResponse rows = service.rows(org, day, day, null, null, null, null);
        assertThat(rows.items()).extracting(InquiryRowItem::inquiryId).containsExactly(inDay);
        assertThat(rows.totalCount()).isEqualTo(rows.items().size());
    }

    @Test
    @DisplayName("default window: 「최근 문의」 cannot clip a row from the seller's today (2026-08-30 live turn)")
    void defaultWindowCoversTheSellersToday() {
        // 17:24Z on 08-30 is already 02:24 KST on 08-31, and the file importer stamps a 작성일 of 08-31
        // at 2026-08-31T00:00:00Z. The old UTC default (to = UTC-today = 08-30) ended the window at
        // exactly that instant and answered 「문의는 없습니다」 over rows the /inquiries screen showed.
        InquiryRowsService lateEvening = new InquiryRowsService(inquiries, workItems, channels, products,
                com.sellerops.identity.ExecutableIdentityResolver.unresolved(),
                Clock.fixed(Instant.parse("2026-08-30T17:24:00Z"), ZoneOffset.UTC));
        inquiryAt(naver, "2026-08-31T00:00:00Z");

        InquiryRowsResponse rows = lateEvening.rows(org, null, null, null, null, "NEWEST", 3);
        assertThat(rows.items()).hasSize(1);
        assertThat(rows.totalCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("q: the seller's own subject word narrows by title OR body, and the count follows the rows")
    void subjectWord() {
        UUID receipt = inquiry(cafe24, "ANSWERED", "2026-08-10", DataOrigin.REAL);
        inquiries.findById(receipt).ifPresent(q -> {
            q.setTitle("현금영수증 발행 문의");
            q.setBody("주문 번호로 현금영수증 발행 부탁드립니다.");
            inquiries.save(q);
        });
        UUID inBody = inquiry(naver, "UNANSWERED", "2026-08-12", DataOrigin.REAL);
        inquiries.findById(inBody).ifPresent(q -> {
            q.setTitle("문의드립니다");
            q.setBody("현금영수증도 되나요?");
            inquiries.save(q);
        });
        inquiry(naver, "UNANSWERED", "2026-08-25", DataOrigin.REAL);

        InquiryRowsResponse hit = service.rows(org, null, null, null, null, "NEWEST", null, "현금영수증");
        assertThat(hit.term()).isEqualTo("현금영수증");
        assertThat(hit.items()).extracting(InquiryRowItem::inquiryId).containsExactly(inBody, receipt);
        // The count is the same predicate as the rows: a narrowed read never reports the wider total.
        assertThat(hit.totalCount()).isEqualTo(2);

        // The other axes still apply on top of it, and a word nothing holds is an honest zero.
        assertThat(service.rows(org, null, null, "NAVER", null, null, null, "현금영수증").items())
                .extracting(InquiryRowItem::inquiryId).containsExactly(inBody);
        assertThat(service.rows(org, null, null, null, null, null, null, "세금계산서").items()).isEmpty();
        // No word = no narrowing (the shape before this axis existed).
        assertThat(service.rows(org, null, null, null, null, null, null, "  ").totalCount()).isEqualTo(3);
    }

    @Test
    @DisplayName("snippet: every row carries the masked opening of the customer's message, work item or not")
    void rowSnippet() {
        UUID answered = inquiry(cafe24, "ANSWERED", "2026-08-11", DataOrigin.REAL);
        inquiries.findById(answered).ifPresent(q -> {
            q.setBody("<p>안녕하세요. 010-1234-5678 로 연락 주세요.</p>");
            inquiries.save(q);
        });
        InquiryRowItem row = service.rows(org, null, null, null, null, null, null).items().get(0);
        assertThat(row.workItemId()).isNull();
        assertThat(row.snippet()).contains("안녕하세요.");
        // The same masking the 문의 feed applies — a row is not a hole in the PII floor.
        assertThat(row.snippet()).doesNotContain("010-1234-5678");
        assertThat(row.snippet()).doesNotContain("<p>");
    }

    private UUID inquiryAt(UUID channelId, String receivedAt) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setTitle("문의 " + receivedAt);
        q.setBody("본문");
        q.setStatus("UNANSWERED");
        q.setDataOrigin(DataOrigin.REAL);
        q.setReceivedAt(Instant.parse(receivedAt));
        return inquiries.save(q).getId();
    }
}
