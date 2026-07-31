package com.sellerops.connector.cafe24.spike;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SpikeGrantedScopeTest {

    @Test
    void writeGrantedWhenPresentSpaceSeparated() {
        String scopes = "mall.read_order mall.read_community mall.write_community";
        assertThat(SpikeGrantedScope.writeCommunityGranted(scopes)).isTrue();
        assertThat(SpikeGrantedScope.readCommunityGranted(scopes)).isTrue();
        assertThat(SpikeGrantedScope.spikeScopesGranted(scopes)).isTrue();
    }

    @Test
    void writeGrantedWhenPresentCommaSeparated() {
        assertThat(SpikeGrantedScope.writeCommunityGranted(
                "mall.read_community,mall.write_community")).isTrue();
    }

    @Test
    void writeNotGrantedForReadOnly() {
        String scopes = "mall.read_order mall.read_community";
        assertThat(SpikeGrantedScope.writeCommunityGranted(scopes)).isFalse();
        assertThat(SpikeGrantedScope.spikeScopesGranted(scopes)).isFalse();
    }

    @Test
    void spikeScopesRequireBothReadAndWrite() {
        // write only, no read → not safe to run the spike
        assertThat(SpikeGrantedScope.spikeScopesGranted("mall.write_community")).isFalse();
    }

    @Test
    void blankOrNullFailsClosed() {
        assertThat(SpikeGrantedScope.writeCommunityGranted(null)).isFalse();
        assertThat(SpikeGrantedScope.writeCommunityGranted("")).isFalse();
        assertThat(SpikeGrantedScope.writeCommunityGranted("   ")).isFalse();
    }

    @Test
    void caseInsensitiveAndIgnoresUnknownScopes() {
        String scopes = "MALL.READ_COMMUNITY MALL.WRITE_COMMUNITY mall.some_future_scope";
        assertThat(SpikeGrantedScope.writeCommunityGranted(scopes)).isTrue();
        assertThat(SpikeGrantedScope.readCommunityGranted(scopes)).isTrue();
    }

    @Test
    void similarButDifferentScopeDoesNotCount() {
        // guards against a naive "contains write" substring check
        assertThat(SpikeGrantedScope.writeCommunityGranted("mall.write_order")).isFalse();
    }
}
