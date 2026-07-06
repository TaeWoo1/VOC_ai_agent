package com.sellerops.inquiry.workitem.dismissal;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The exact, approved on-disk format required to execute a bulk work-item dismissal.
 * It is deliberately explicit and self-approving: an execution is authorized only by
 * a manifest that names the exact work-item ids, the seller account they must belong
 * to, a structured disposition, an idempotency {@code commandId}, and an approval
 * stamp. There is no way to dismiss by date range, free-text, or inferred spam
 * criteria — only by exact ids listed here.
 *
 * <p><b>Required fields</b> (all validated by {@link #parse}, which fails closed):
 * <ul>
 *   <li>{@code approved} — must be {@code true};</li>
 *   <li>{@code approved_by} — non-blank approver tag;</li>
 *   <li>{@code approved_at} — non-blank approval timestamp (opaque string);</li>
 *   <li>{@code sellerAccountId} — the exact seller connection the items must be on;</li>
 *   <li>{@code disposition} — must be {@code SPAM} in this slice;</li>
 *   <li>{@code commandId} — non-blank idempotency key (&le; {@value #MAX_COMMAND_ID_LEN} chars);</li>
 *   <li>{@code workItemIds} — non-empty, unique, &le; {@link #maxIds} ids.</li>
 * </ul>
 *
 * <p>The manifest carries <b>no</b> inquiry titles, bodies, author data, or buyer
 * PII — only opaque ids and the approval envelope — so it is safe to read and log.
 */
public record DismissalManifest(
        boolean approved,
        @JsonProperty("approved_by") String approvedBy,
        @JsonProperty("approved_at") String approvedAt,
        UUID sellerAccountId,
        String disposition,
        String commandId,
        List<UUID> workItemIds) {

    static final int MAX_COMMAND_ID_LEN = 120;

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /**
     * Parse and fully validate a manifest, rejecting (fail closed) any of: missing or
     * false approval, missing approver/timestamp/account/commandId, an unsupported
     * disposition, an empty/oversized id list, or duplicate ids. {@code maxIds} is the
     * hard per-execution cap the caller enforces (see the dismissal service).
     *
     * @throws ApiException {@code 400} on any structural or approval violation, or if
     *                      the JSON itself is malformed.
     */
    public static DismissalManifest parse(String json, int maxIds) {
        DismissalManifest m;
        try {
            m = MAPPER.readValue(json, DismissalManifest.class);
        } catch (Exception e) {
            // Never surface raw content in the message — only that parsing failed.
            throw ApiException.badRequest("반려 매니페스트 JSON을 해석할 수 없습니다.");
        }
        return m.validated(maxIds);
    }

    /**
     * Validate an already-materialized manifest against the hard cap. Returns {@code
     * this} when valid; throws {@link ApiException} {@code 400} otherwise.
     */
    public DismissalManifest validated(int maxIds) {
        if (!approved) {
            throw ApiException.badRequest("승인되지 않은 매니페스트입니다 (approved=true 필요).");
        }
        if (isBlank(approvedBy)) {
            throw ApiException.badRequest("approved_by가 필요합니다.");
        }
        if (isBlank(approvedAt)) {
            throw ApiException.badRequest("approved_at이 필요합니다.");
        }
        if (sellerAccountId == null) {
            throw ApiException.badRequest("sellerAccountId가 필요합니다.");
        }
        if (resolvedDisposition() == null) {
            throw ApiException.badRequest("disposition은 SPAM이어야 합니다.");
        }
        if (isBlank(commandId)) {
            throw ApiException.badRequest("commandId가 필요합니다.");
        }
        if (commandId.length() > MAX_COMMAND_ID_LEN) {
            throw ApiException.badRequest("commandId가 너무 깁니다.");
        }
        if (workItemIds == null || workItemIds.isEmpty()) {
            throw ApiException.badRequest("workItemIds가 비어 있습니다.");
        }
        if (workItemIds.size() > maxIds) {
            throw ApiException.badRequest(
                    "한 번에 처리 가능한 최대 개수(" + maxIds + ")를 초과했습니다.");
        }
        Set<UUID> seen = new HashSet<>();
        for (UUID id : workItemIds) {
            if (id == null) {
                throw ApiException.badRequest("workItemIds에 빈 값이 있습니다.");
            }
            if (!seen.add(id)) {
                throw ApiException.badRequest("workItemIds에 중복된 항목이 있습니다.");
            }
        }
        return this;
    }

    /** The disposition as the closed enum, or {@code null} if unrecognized/unsupported. */
    public InquiryWorkItemDisposition resolvedDisposition() {
        if (disposition == null) {
            return null;
        }
        for (InquiryWorkItemDisposition d : InquiryWorkItemDisposition.values()) {
            if (d.name().equals(disposition)) {
                return d;
            }
        }
        return null;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
