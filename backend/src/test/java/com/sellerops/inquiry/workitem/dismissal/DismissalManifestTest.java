package com.sellerops.inquiry.workitem.dismissal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The approved-manifest contract, validated purely (no DB). Proves the manifest is
 * the only key that unlocks execution — it must be explicitly approved, name a seller
 * account, carry a supported disposition and idempotency commandId, and list a
 * bounded, duplicate-free set of exact ids. Every violation fails closed with a 400.
 */
class DismissalManifestTest {

    private static final int CAP = 500;
    private static final UUID ACCOUNT = UUID.randomUUID();

    private static String json(String extraOrOverride) {
        // A well-formed, approved manifest with two ids; callers splice overrides.
        return """
            {
              "approved": true,
              "approved_by": "operator@sellerops.ai",
              "approved_at": "2026-07-06T00:00:00Z",
              "sellerAccountId": "%s",
              "disposition": "SPAM",
              "commandId": "cafe24-spam-dismiss-2026-07-06-chunk-01",
              "workItemIds": ["%s", "%s"]
              %s
            }
            """.formatted(ACCOUNT, UUID.randomUUID(), UUID.randomUUID(), extraOrOverride);
    }

    @Test
    void parsesAWellFormedApprovedManifest() {
        DismissalManifest m = DismissalManifest.parse(json(""), CAP);

        assertThat(m.approved()).isTrue();
        assertThat(m.approvedBy()).isEqualTo("operator@sellerops.ai");
        assertThat(m.approvedAt()).isEqualTo("2026-07-06T00:00:00Z");
        assertThat(m.sellerAccountId()).isEqualTo(ACCOUNT);
        assertThat(m.resolvedDisposition()).isEqualTo(InquiryWorkItemDisposition.SPAM);
        assertThat(m.commandId()).isEqualTo("cafe24-spam-dismiss-2026-07-06-chunk-01");
        assertThat(m.workItemIds()).hasSize(2);
    }

    @Test
    void rejectsMissingApproval() {
        assertThatThrownBy(() -> DismissalManifest.parse(json("").replace("\"approved\": true", "\"approved\": false"), CAP))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsBlankApprovedByOrApprovedAt() {
        assertThatThrownBy(() -> DismissalManifest.parse(
                json("").replace("\"operator@sellerops.ai\"", "\"\""), CAP))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> DismissalManifest.parse(
                json("").replace("\"2026-07-06T00:00:00Z\"", "\"\""), CAP))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsUnsupportedDisposition() {
        assertThatThrownBy(() -> DismissalManifest.parse(
                json("").replace("\"SPAM\"", "\"DELETE\""), CAP))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsBlankCommandId() {
        assertThatThrownBy(() -> DismissalManifest.parse(
                json("").replace("\"cafe24-spam-dismiss-2026-07-06-chunk-01\"", "\"\""), CAP))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsDuplicateIds() {
        UUID dup = UUID.randomUUID();
        String body = """
            {
              "approved": true, "approved_by": "op", "approved_at": "t",
              "sellerAccountId": "%s", "disposition": "SPAM", "commandId": "c",
              "workItemIds": ["%s", "%s"]
            }
            """.formatted(ACCOUNT, dup, dup);
        assertThatThrownBy(() -> DismissalManifest.parse(body, CAP))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsEmptyIdList() {
        String body = """
            {
              "approved": true, "approved_by": "op", "approved_at": "t",
              "sellerAccountId": "%s", "disposition": "SPAM", "commandId": "c",
              "workItemIds": []
            }
            """.formatted(ACCOUNT);
        assertThatThrownBy(() -> DismissalManifest.parse(body, CAP))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsMoreThanTheHardCap() {
        DismissalManifest overCap = new DismissalManifest(
                true, "op", "t", ACCOUNT, "SPAM", "c",
                List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID()));
        assertThatThrownBy(() -> overCap.validated(2)).isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsMalformedJson() {
        assertThatThrownBy(() -> DismissalManifest.parse("{ not json", CAP))
                .isInstanceOf(ApiException.class);
    }
}
