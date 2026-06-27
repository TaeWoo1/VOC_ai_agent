package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.source.Cafe24VocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Second-channel (ESM+ = the GMARKET catalog code) safe-empty validation for the
 * attention surface (PR #131–135). Since PR #135 the data access is delegated to a
 * per-channel {@link com.sellerops.attention.source.VocItemSource}; GMARKET has
 * <b>no source adapter</b>, so {@code VocItemSourceRegistry.forChannel} resolves to
 * empty and the attention layer <b>fails closed into an empty state by explicit
 * registry policy</b> — no throw, no fabricated signals, no Cafe24 assumption
 * leaking. (The data-source gap and its partial closure are documented in
 * {@code docs/sellerops_phase0_esm_discovery.md} §7.)
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class EsmAttentionEmptyStateTest {

    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired Cafe24CommunityArticleRepository articles;

    private OperatorAttentionService service;
    private final UUID org = UUID.randomUUID();

    private static final LocalDate FROM = LocalDate.parse("2026-05-01");
    private static final LocalDate TO = LocalDate.parse("2026-05-31");

    @BeforeEach
    void setUp() {
        service = new OperatorAttentionService(sellerAccounts, channels,
                new VocItemSourceRegistry(List.of(new Cafe24VocItemSource(articles))));
    }

    @Test
    void gmarketAccountWithNoArticlesYieldsEmptySummary() {
        UUID accountId = seedGmarketAccount();

        OperatorAttentionSummary s = service.attention(org, accountId, FROM, TO);

        assertThat(s.sellerAccountId()).isEqualTo(accountId);
        assertThat(s.channel()).isEqualTo("G마켓/옥션");   // non-Cafe24 channel, generically carried
        assertThat(s.items()).isEmpty();                  // safe empty — no signals, no throw
        assertThat(s.fromDate()).isEqualTo(FROM);
        assertThat(s.toDate()).isEqualTo(TO);
    }

    @Test
    void gmarketDrilldownReturnsAnEmptyPage() {
        UUID accountId = seedGmarketAccount();

        OperatorVocItemPage page = service.attentionItems(
                org, accountId, "LOW_RATING_REVIEW", FROM, TO, 0, 20);

        assertThat(page.signalType()).isEqualTo("LOW_RATING_REVIEW");
        assertThat(page.items()).isEmpty();
        assertThat(page.total()).isZero();
    }

    /** A GMARKET-channel account with zero collected community articles. */
    private UUID seedGmarketAccount() {
        Channel ch = new Channel();
        ch.setCode("GMARKET");
        ch.setNameKo("G마켓/옥션");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.AVAILABLE);
        acc.setFileUpload(false);
        sellerAccounts.save(acc);
        return acc.getId();
    }
}
