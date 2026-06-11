package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ContentHashTest {

    @Test
    void isStableForSameInputs() {
        String a = ContentHash.of("ch1", "prod1", "2026-06-01", "접착력이 약해요");
        String b = ContentHash.of("ch1", "prod1", "2026-06-01", "접착력이 약해요");
        assertThat(a).isEqualTo(b).hasSize(64);
    }

    @Test
    void ignoresCaseAndSurroundingWhitespace() {
        String a = ContentHash.of("ch1", "prod1", "2026-06-01", "Broken Item");
        String b = ContentHash.of("ch1", "prod1", "2026-06-01", "  broken   item  ");
        assertThat(a).isEqualTo(b);
    }

    @Test
    void differsWhenBodyDiffers() {
        String a = ContentHash.of("ch1", "prod1", "2026-06-01", "접착력이 약해요");
        String b = ContentHash.of("ch1", "prod1", "2026-06-01", "색상이 달라요");
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void differsWhenChannelDiffers() {
        String a = ContentHash.of("ch1", "prod1", "2026-06-01", "same");
        String b = ContentHash.of("ch2", "prod1", "2026-06-01", "same");
        assertThat(a).isNotEqualTo(b);
    }
}
