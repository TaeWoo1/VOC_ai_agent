package com.sellerops.organization.profile;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.style.AnswerStyleSafetyFloor;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.organization.profile.dto.SellerProfileRequest;
import com.sellerops.organization.profile.dto.SellerProfileView;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seller Context v1-B — read and write the one sentence-or-paragraph that says what this company is.
 *
 * <p><b>What it is for, and what it is not for.</b> The business summary tells a drafter who is
 * speaking ("전선몰딩 제조사, 기업·시공업체 주문이 많다") so a reply can be worded for that company.
 * It is NOT a source of operational facts: a summary that says "B2B 주문이 많은 전기자재 업체" proves
 * nothing about delivery days, refund eligibility or a product's spec, and no reader of this class
 * may treat it as evidence. That rule is enforced where evidence is decided —
 * {@code AnswerBasisState} never sees this text — not by trusting readers to remember it.
 *
 * <p><b>Seller-authored only.</b> {@link #save} is the only writer, and its only caller is the
 * settings controller. Nothing derives, suggests or rewrites a summary; an AI that filled this in
 * would be inventing the company it is about to speak for.
 *
 * <p><b>The safety floor applies here too.</b> The text reaches a model as quoted data on a user
 * turn, which is exactly the class of string {@link AnswerStyleSafetyFloor} was written to check —
 * so a summary that tries to be an instruction is refused at write time, with the phrase named.
 */
@Service
public class SellerProfileService {

    /** ~500 characters: a paragraph about the company, not a catalogue. */
    static final int MAX_SUMMARY = 500;

    private final OrganizationProfileRepository profiles;
    private final OrganizationRepository organizations;

    public SellerProfileService(OrganizationProfileRepository profiles,
                                OrganizationRepository organizations) {
        this.profiles = profiles;
        this.organizations = organizations;
    }

    /**
     * The registered summary, or empty. <b>Bounded READ, one row, org-keyed</b> — the seam the draft
     * composer and the Agent runtime read on the turn that needs it, and never anything wider.
     */
    @Transactional(readOnly = true)
    public Optional<String> summaryFor(UUID orgId) {
        return profiles.findById(orgId).map(OrganizationProfile::getBusinessSummary)
                .filter(s -> s != null && !s.isBlank());
    }

    @Transactional(readOnly = true)
    public SellerProfileView view(UUID orgId) {
        String name = organizations.findById(orgId).map(Organization::getName).orElse(null);
        Optional<OrganizationProfile> row = profiles.findById(orgId);
        String summary = row.map(OrganizationProfile::getBusinessSummary)
                .filter(s -> s != null && !s.isBlank()).orElse(null);
        return new SellerProfileView(name, summary, summary != null,
                summary == null ? null : row.map(OrganizationProfile::getUpdatedAt).orElse(null));
    }

    /** Save the summary. Blank clears it; over-length and unsafe text are refused, never truncated. */
    @Transactional
    public SellerProfileView save(UUID orgId, SellerProfileRequest request, UUID actorUserId) {
        String raw = request == null ? null : request.businessSummary();
        String summary = raw == null || raw.isBlank() ? null : raw.strip();
        if (summary != null && summary.length() > MAX_SUMMARY) {
            throw ApiException.badRequest("회사 소개는 " + MAX_SUMMARY + "자 이내로 적어 주세요. (현재 "
                    + summary.length() + "자)");
        }
        if (summary != null) {
            List<AnswerStyleSafetyFloor.Violation> violations =
                    AnswerStyleSafetyFloor.checkAll(Map.of("회사 소개", summary));
            if (!violations.isEmpty()) {
                throw ApiException.badRequest(violations.stream()
                        .map(AnswerStyleSafetyFloor.Violation::messageKo)
                        .reduce((a, b) -> a + " " + b).orElse("저장할 수 없습니다."));
            }
        }
        OrganizationProfile row = profiles.findById(orgId).orElseGet(() -> {
            OrganizationProfile fresh = new OrganizationProfile();
            fresh.setOrgId(orgId);
            return fresh;
        });
        row.setBusinessSummary(summary);
        row.setUpdatedBy(actorUserId);
        profiles.save(row);
        return view(orgId);
    }
}
