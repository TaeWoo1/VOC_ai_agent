package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Second-channel (ESM+ = the GMARKET catalog code) safe-empty validation for the
 * attention surface (PR #131–133). That surface reads the Cafe24-specific
 * {@code cafe24_community_articles} store by {@code orgId + accountId + window}
 * with <b>no channel guard</b>, so a non-Cafe24 account simply owns zero such rows.
 * The contract must therefore <b>fail closed into an empty state</b> — no throw, no
 * Cafe24 assumption leaking — rather than fabricate signals for a channel that has
 * no VOC source yet. (The data-source gap is documented in
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
        service = new OperatorAttentionService(sellerAccounts, channels, articles);
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
