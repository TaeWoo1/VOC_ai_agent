package com.sellerops.config;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummary;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds demo data on an empty database, in two groups:
 *
 * <ul>
 *   <li><b>Baseline</b> (always, when {@code sellerops.seed.enabled=true}, default
 *       true): the demo org + login user + 13-channel catalog + seller accounts.
 *       Required so the dev app is usable (login) and uploads have channels to map
 *       to.</li>
 *   <li><b>Demo content</b> (opt-in, only when {@code sellerops.seed.demo-content
 *       =true}, default false): sample products/reviews/inquiries/order-summaries.
 *       OFF by default so a real/default DB shows an honest empty inbox and orders
 *       dashboard instead of fake operational rows.</li>
 * </ul>
 *
 * Idempotent: runs only when no organizations exist, so demo content seeds only on
 * a clean DB — enable {@code sellerops.seed.demo-content} before the first startup
 * of an empty database to get the full demo. Existing rows are never deleted here.
 *
 * Demo login — email: demo@sellerops.ai  password: demo1234
 */
@Component
public class MockDataSeeder implements ApplicationRunner {

    private final boolean enabled;
    private final boolean seedDemoContent;
    private final OrganizationRepository organizations;
    private final UserRepository users;
    private final ChannelRepository channels;
    private final SellerAccountRepository sellerAccounts;
    private final ProductRepository products;
    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final OrderDailySummaryRepository orderSummaries;
    private final PasswordEncoder passwordEncoder;

    public MockDataSeeder(
            @Value("${sellerops.seed.enabled:true}") boolean enabled,
            @Value("${sellerops.seed.demo-content:false}") boolean seedDemoContent,
            OrganizationRepository organizations, UserRepository users,
            ChannelRepository channels, SellerAccountRepository sellerAccounts,
            ProductRepository products, InquiryRepository inquiries,
            ReviewRepository reviews, OrderDailySummaryRepository orderSummaries,
            PasswordEncoder passwordEncoder) {
        this.enabled = enabled;
        this.seedDemoContent = seedDemoContent;
        this.organizations = organizations;
        this.users = users;
        this.channels = channels;
        this.sellerAccounts = sellerAccounts;
        this.products = products;
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.orderSummaries = orderSummaries;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!enabled || organizations.count() > 0) {
            return;
        }

        Organization org = new Organization();
        org.setName("데모 제조사");
        org = organizations.save(org);

        User user = new User();
        user.setOrgId(org.getId());
        user.setEmail("demo@sellerops.ai");
        user.setPasswordHash(passwordEncoder.encode("demo1234"));
        user.setName("데모 운영자");
        user.setRole("OWNER");
        users.save(user);

        List<Channel> catalog = seedChannels();
        Channel coupang = catalog.get(0);
        Channel naver = catalog.get(1);

        seedAccount(org.getId(), coupang, Instant.now().minus(Duration.ofHours(1)));
        seedAccount(org.getId(), naver, Instant.now().minus(Duration.ofHours(3)));

        // Demo content (products/reviews/inquiries/order-summaries) is opt-in. When
        // off, the inbox and orders dashboard stay honestly empty until real data
        // arrives; baseline org/user/channels above are still seeded for login.
        if (seedDemoContent) {
            List<Product> productList = seedProducts(org.getId());
            seedReviews(org.getId(), productList, List.of(coupang, naver));
            seedInquiries(org.getId(), productList, List.of(coupang, naver));
            seedOrderSummaries(org.getId(), List.of(coupang, naver));
        }
    }

    private List<Channel> seedChannels() {
        List<Channel> list = new ArrayList<>();
        int[] order = {0};
        // name, code, status, inquiry, review, order, sales, product
        list.add(channel("쿠팡", "COUPANG", ChannelStatus.CONNECTED, true, true, true, true, true, order));
        list.add(channel("네이버 스마트스토어", "NAVER", ChannelStatus.AVAILABLE, true, true, true, true, true, order));
        list.add(channel("G마켓/옥션", "GMARKET", ChannelStatus.AVAILABLE, false, true, true, true, true, order));
        list.add(channel("11번가", "ELEVENST", ChannelStatus.AVAILABLE, false, true, true, true, true, order));
        list.add(channel("롯데온", "LOTTEON", ChannelStatus.PREPARING, false, true, true, true, true, order));
        list.add(channel("SSG닷컴", "SSG", ChannelStatus.PREPARING, false, true, true, true, true, order));
        list.add(channel("오늘의집", "OHOUSE", ChannelStatus.REQUEST_AVAILABLE, false, true, false, false, true, order));
        list.add(channel("카카오톡스토어", "KAKAO", ChannelStatus.REQUEST_AVAILABLE, true, true, true, false, true, order));
        list.add(channel("카페24 자사몰", "CAFE24", ChannelStatus.AVAILABLE, true, false, true, true, true, order));
        list.add(channel("메이크샵", "MAKESHOP", ChannelStatus.REQUEST_AVAILABLE, false, false, true, true, true, order));
        list.add(channel("아임웹", "IMWEB", ChannelStatus.REQUEST_AVAILABLE, false, false, true, true, true, order));
        list.add(channel("자사몰/기타", "CUSTOM", ChannelStatus.FILE_UPLOAD_SUPPORTED, true, true, true, true, true, order));
        list.add(channel("파일 업로드 채널", "FILE_UPLOAD", ChannelStatus.FILE_UPLOAD_SUPPORTED, true, true, false, false, false, order));
        return channels.saveAll(list);
    }

    private Channel channel(String name, String code, ChannelStatus status,
                            boolean inquiry, boolean review, boolean order,
                            boolean sales, boolean product, int[] orderCounter) {
        Channel c = new Channel();
        c.setNameKo(name);
        c.setCode(code);
        c.setStatus(status);
        c.setSupportsInquiry(inquiry);
        c.setSupportsReview(review);
        c.setSupportsOrder(order);
        c.setSupportsSales(sales);
        c.setSupportsProduct(product);
        c.setSortOrder(orderCounter[0]++);
        return c;
    }

    private void seedAccount(java.util.UUID orgId, Channel channel, Instant lastSync) {
        SellerAccount a = new SellerAccount();
        a.setOrgId(orgId);
        a.setChannelId(channel.getId());
        a.setAlias(channel.getNameKo());
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setLastSyncedAt(lastSync);
        a.setFileUpload(false);
        sellerAccounts.save(a);
    }

    private List<Product> seedProducts(java.util.UUID orgId) {
        String[] names = {
                "선바로 광폭 케이블 몰딩", "전선몰딩 1호 (백색)", "전선몰딩 2호 (아이보리)",
                "코너 마감 몰딩 세트", "바닥용 평면 몰딩", "양면테이프 보강 몰딩"
        };
        List<Product> list = new ArrayList<>();
        int i = 1;
        for (String name : names) {
            Product p = new Product();
            p.setOrgId(orgId);
            p.setName(name);
            p.setSku("MLD-" + String.format("%03d", i++));
            p.setStatus("ACTIVE");
            list.add(p);
        }
        return products.saveAll(list);
    }

    private void seedReviews(java.util.UUID orgId, List<Product> productList, List<Channel> chans) {
        String[] positive = {
                "설치가 생각보다 쉬웠어요. 깔끔하게 정리됩니다.",
                "색상이 벽지랑 잘 어울려서 만족합니다.",
                "튼튼하고 마감이 깔끔해요. 재구매 의사 있습니다.",
                "전선 정리가 한 번에 되네요. 추천합니다."
        };
        String[] negative = {
                "부착 후 며칠 지나니 접착력이 약해서 떨어졌어요.",
                "재단하다가 모서리가 깨졌습니다. 잘 부서지네요.",
                "사진이랑 색이 조금 달라요. 실물이 더 누런 느낌입니다.",
                "포장이 찌그러져서 왔어요. 제품 일부가 눌렸습니다."
        };
        List<Review> list = new ArrayList<>();
        for (int i = 0; i < 44; i++) {
            Product p = productList.get(i % productList.size());
            Channel c = chans.get(i % chans.size());
            boolean neg = (i % 4 == 0);
            Review r = new Review();
            r.setOrgId(orgId);
            r.setChannelId(c.getId());
            r.setProductId(p.getId());
            r.setNegative(neg);
            r.setRating(neg ? (i % 2 == 0 ? 1 : 2) : (i % 2 == 0 ? 5 : 4));
            r.setBody(neg ? negative[i % negative.length] : positive[i % positive.length]);
            r.setReceivedAt(Instant.now().minus(Duration.ofHours(i * 7L)));
            list.add(r);
        }
        reviews.saveAll(list);
    }

    private void seedInquiries(java.util.UUID orgId, List<Product> productList, List<Channel> chans) {
        String[] bodies = {
                "이 제품 폭이 몇 mm인가요? 굵은 전선도 들어가나요?",
                "곡면 벽에도 시공 가능한가요?",
                "추가 양면테이프는 따로 사야 하나요?",
                "색상 아이보리 재고 있나요?",
                "대량 구매 시 할인 가능한지 문의드립니다.",
                "절단은 어떤 도구로 하면 되나요?"
        };
        List<Inquiry> list = new ArrayList<>();
        for (int i = 0; i < 16; i++) {
            Product p = productList.get(i % productList.size());
            Channel c = chans.get(i % chans.size());
            Inquiry q = new Inquiry();
            q.setOrgId(orgId);
            q.setChannelId(c.getId());
            q.setProductId(p.getId());
            // Buyer PII (author) is no longer persisted; leave it null like the ingest paths.
            q.setBody(bodies[i % bodies.length]);
            q.setStatus(i < 6 ? "UNANSWERED" : "ANSWERED");
            q.setReceivedAt(Instant.now().minus(Duration.ofHours(i * 11L)));
            list.add(q);
        }
        inquiries.saveAll(list);
    }

    private void seedOrderSummaries(java.util.UUID orgId, List<Channel> chans) {
        LocalDate today = LocalDate.now();
        List<OrderDailySummary> list = new ArrayList<>();
        for (int d = 0; d < 14; d++) {
            LocalDate date = today.minusDays(d);
            int ci = 0;
            for (Channel c : chans) {
                int base = 18 + ((d * 3 + ci * 7) % 24);
                long unitPrice = 12_900L + ci * 3_000L;
                OrderDailySummary s = new OrderDailySummary();
                s.setOrgId(orgId);
                s.setChannelId(c.getId());
                s.setSummaryDate(date);
                s.setOrderCount(base);
                s.setSalesAmount(base * unitPrice);
                list.add(s);
                ci++;
            }
        }
        orderSummaries.saveAll(list);
    }
}
