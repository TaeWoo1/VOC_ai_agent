package com.sellerops.attention.reply;

import com.sellerops.attention.reply.dto.ReviewReplyTemplateView;
import com.sellerops.attention.reply.dto.ReviewReplyTemplatesView;
import com.sellerops.common.ApiException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read and write one organization's review reply templates — the style layer over the taxonomy
 * {@link ReviewReplyTemplateKey} already had.
 *
 * <p><b>Two levels, and there is no third.</b> An org override wins; otherwise the shipped default.
 * There is no product-level, account-level, channel-level or conditional override in v1, and adding
 * one later is a schema decision rather than a branch somebody slips into this method — which is why
 * {@link #bodyFor} takes an org and a key and nothing else.
 *
 * <p><b>Restoring the default deletes the row.</b> Writing the shipped text back would look identical
 * on screen and behave differently forever after: the org would stop following a wording it never
 * chose to freeze. So {@link #reset} removes the override and the read falls through.
 *
 * <p><b>Style only.</b> Nothing here reads a product, a policy, an order, an inquiry, a past answer or
 * a model, and the value it produces is a whole reply body chosen by category — never a fact spliced
 * into one. {@code ReviewReplyTemplateFenceTest} asserts that by name, so a later grounded drafter
 * composes WITH this layer instead of arriving through it.
 */
@Service
public class ReviewReplyTemplateService {

    /**
     * The same bound a saved reply draft gets ({@link ReviewReplyValidation#BODY_MAX_BYTES}). A
     * template IS a reply body, so inventing a second number here would let a seller save a template
     * that no draft could hold.
     */
    static final int MAX_BODY_BYTES = ReviewReplyValidation.BODY_MAX_BYTES;

    private final ReviewReplyTemplateRepository templates;

    public ReviewReplyTemplateService(ReviewReplyTemplateRepository templates) {
        this.templates = templates;
    }

    /**
     * The wording this org answers a {@code key} review with — the override, or the shipped default.
     * Never empty, never null; an unreadable repository is not a reason to answer with nothing.
     */
    @Transactional(readOnly = true)
    public String bodyFor(UUID orgId, ReviewReplyTemplateKey key) {
        if (orgId == null || key == null) {
            return key == null ? "" : key.defaultBody();
        }
        return templates.findByOrgIdAndTemplateKey(orgId, key.category())
                .map(ReviewReplyTemplate::getBody)
                .filter(body -> !body.isBlank())
                .orElseGet(key::defaultBody);
    }

    /** Whether this org has its own wording for {@code key} — provenance, never a gate. */
    @Transactional(readOnly = true)
    public boolean isCustomized(UUID orgId, ReviewReplyTemplateKey key) {
        return orgId != null && key != null
                && templates.findByOrgIdAndTemplateKey(orgId, key.category()).isPresent();
    }

    /** Every template, effective wording included, in the provider's own decision order. */
    @Transactional(readOnly = true)
    public ReviewReplyTemplatesView view(UUID orgId) {
        Map<String, String> overrides = new HashMap<>();
        for (ReviewReplyTemplate row : templates.findByOrgId(orgId)) {
            overrides.put(row.getTemplateKey(), row.getBody());
        }
        List<ReviewReplyTemplateView> rows = new ArrayList<>();
        for (ReviewReplyTemplateKey key : ReviewReplyTemplateKey.values()) {
            rows.add(viewOf(key, overrides.get(key.category())));
        }
        return new ReviewReplyTemplatesView(rows);
    }

    /**
     * Save this org's wording for one template. Idempotent on content: re-saving identical text
     * updates nothing a reader could see.
     *
     * @throws ApiException 400 for an unknown key, a blank body, or a body over the storage bound.
     */
    @Transactional
    public ReviewReplyTemplateView save(UUID orgId, String rawKey, String rawBody, UUID actorUserId) {
        ReviewReplyTemplateKey key = requireKey(rawKey);
        String body = ReviewReplyValidation.normalize(rawBody);
        if (ReviewReplyValidation.isBlank(body)) {
            throw ApiException.badRequest("답변 문구를 입력하세요. 비워 두시려면 기본값 복원을 사용해 주세요.");
        }
        if (ReviewReplyValidation.utf8Bytes(body) > MAX_BODY_BYTES) {
            throw ApiException.badRequest("답변 문구가 너무 깁니다 (최대 " + MAX_BODY_BYTES + " 바이트).");
        }
        ReviewReplyTemplate row = templates.findByOrgIdAndTemplateKey(orgId, key.category())
                .orElseGet(() -> {
                    ReviewReplyTemplate fresh = new ReviewReplyTemplate();
                    fresh.setOrgId(orgId);
                    fresh.setTemplateKey(key.category());
                    return fresh;
                });
        row.setBody(body);
        row.setUpdatedBy(actorUserId);
        row.setUpdatedAt(Instant.now());
        templates.save(row);
        return viewOf(key, body);
    }

    /**
     * Restore reviewnary's wording for one template by removing the override. Deleting nothing is a
     * success: a seller pressing 기본값 복원 on an untouched template gets the state they asked for.
     */
    @Transactional
    public ReviewReplyTemplateView reset(UUID orgId, String rawKey) {
        ReviewReplyTemplateKey key = requireKey(rawKey);
        templates.deleteByOrgIdAndTemplateKey(orgId, key.category());
        return viewOf(key, null);
    }

    private static ReviewReplyTemplateKey requireKey(String rawKey) {
        return ReviewReplyTemplateKey.of(rawKey)
                .orElseThrow(() -> ApiException.badRequest("알 수 없는 답변 유형입니다."));
    }

    private static ReviewReplyTemplateView viewOf(ReviewReplyTemplateKey key, String override) {
        boolean customized = override != null && !override.isBlank();
        return new ReviewReplyTemplateView(key.category(), customized ? override : key.defaultBody(),
                key.defaultBody(), customized, key.keywords());
    }
}
