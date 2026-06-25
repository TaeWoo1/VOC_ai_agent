package com.sellerops.community;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CommunitySourceKindTest {

    @Test
    void mapsKnownTokensCaseInsensitivelyAndTrimmed() {
        assertThat(CommunitySourceKind.normalize("REVIEW")).isEqualTo(CommunitySourceKind.REVIEW);
        assertThat(CommunitySourceKind.normalize("review")).isEqualTo(CommunitySourceKind.REVIEW);
        assertThat(CommunitySourceKind.normalize(" Product_Inquiry "))
                .isEqualTo(CommunitySourceKind.PRODUCT_INQUIRY);
        assertThat(CommunitySourceKind.normalize("one_to_one_inquiry"))
                .isEqualTo(CommunitySourceKind.ONE_TO_ONE_INQUIRY);
    }

    @Test
    void unknownOrBlankBecomesOther() {
        assertThat(CommunitySourceKind.normalize(null)).isEqualTo(CommunitySourceKind.OTHER);
        assertThat(CommunitySourceKind.normalize("")).isEqualTo(CommunitySourceKind.OTHER);
        assertThat(CommunitySourceKind.normalize("   ")).isEqualTo(CommunitySourceKind.OTHER);
        assertThat(CommunitySourceKind.normalize("notice")).isEqualTo(CommunitySourceKind.OTHER);
    }
}
