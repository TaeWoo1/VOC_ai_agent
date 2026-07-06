package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Determinism, scoping, and normalization of the v1 inquiry fingerprint. The timestamp
 * argument is the <b>canonical</b> received time ({@code yyyy-MM-dd HH:mm:ss}, produced by
 * {@link EsmInquiryTimestamp#canonical}), not a lexical raw string — the vectors below use
 * the dash form, which is already canonical. Separator equivalence (dot vs dash producing
 * one fingerprint) is proven end-to-end in {@code EsmInquiryRowMapperTest}.
 */
class EsmInquiryFingerprintTest {

    private static final UUID ACCT = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Test
    void isDeterministicForIdenticalInput() {
        String a = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "ORDER1", "PROD1", "2026-07-01 09:00:00", "안녕하세요 배송 문의드립니다");
        String b = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "ORDER1", "PROD1", "2026-07-01 09:00:00", "안녕하세요 배송 문의드립니다");
        assertThat(a).isEqualTo(b).hasSize(64);
    }

    @Test
    void differsByMarketplace() {
        String g = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "O", "P", "2026-07-01 09:00:00", "본문");
        String a = EsmInquiryFingerprint.compute(EsmMarketplace.AUCTION, ACCT, "배송",
                "O", "P", "2026-07-01 09:00:00", "본문");
        assertThat(g).isNotEqualTo(a);
    }

    @Test
    void differsBySellerAccount() {
        UUID other = UUID.fromString("22222222-2222-2222-2222-222222222222");
        String one = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "O", "P", "2026-07-01 09:00:00", "본문");
        String two = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, other, "배송",
                "O", "P", "2026-07-01 09:00:00", "본문");
        assertThat(one).isNotEqualTo(two);
    }

    @Test
    void usesFullTimestampNotDayLevel() {
        // Canonical second-precision times: two distinct instants must not collide.
        String morning = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "O", "P", "2026-07-01 09:00:00", "본문");
        String evening = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "O", "P", "2026-07-01 21:30:15", "본문");
        assertThat(morning).isNotEqualTo(evening);
    }

    @Test
    void normalizesBodyWhitespaceButNotDistinctContent() {
        String tight = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "O", "P", "2026-07-01 09:00:00", "배송 문의");
        String loose = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "O", "P", "2026-07-01 09:00:00", "  배송   문의  ");
        assertThat(tight).isEqualTo(loose);

        String different = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "배송",
                "O", "P", "2026-07-01 09:00:00", "환불 문의");
        assertThat(tight).isNotEqualTo(different);
    }

    @Test
    void nullOptionalFieldsTreatedAsEmptyAndStable() {
        String withNulls = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, null,
                null, null, "2026-07-01 09:00:00", "본문");
        String withEmpties = EsmInquiryFingerprint.compute(EsmMarketplace.GMARKET, ACCT, "",
                "", "", "2026-07-01 09:00:00", "본문");
        assertThat(withNulls).isEqualTo(withEmpties);
    }

    @Test
    void externalIdEmbedsMarketplaceAccountAndFingerprint() {
        String fp = "abc123";
        assertThat(EsmInquiryFingerprint.externalId(EsmMarketplace.AUCTION, ACCT, fp))
                .isEqualTo("esm:AUCTION:" + ACCT + ":abc123");
    }
}
