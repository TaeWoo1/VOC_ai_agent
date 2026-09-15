package com.sellerops.responsibility;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.DataType;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>Who owns routine collection of a source — one owner, never two.</b>
 *
 * <p>While an organisation's responsibility is ACTIVE, the scheduled collection of each of its required sources
 * (for CUSTOMER_OPERATIONS_V1: Cafe24 INQUIRY and REVIEW on its API accounts) belongs to the responsibility runtime.
 * The collection scheduler ({@code SyncScheduleRunner}) asks here before running a schedule and defers an owned one:
 * no job, no second read of the same source in the same window.
 *
 * <p>What is not owned stays exactly as it was: other data types (ORDER_SUMMARY, PRODUCT), other channels, and any
 * organisation whose responsibility is PAUSED, STOPPED or absent — the legacy schedule collects those. A seller's
 * own 「지금 동기화」 is never blocked; it goes through the same single-flight gate and a responsibility run that meets
 * it adopts its result.
 */
@Component
public class ResponsibilitySourceOwnership {

    private final ResponsibilityRepository responsibilities;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;

    public ResponsibilitySourceOwnership(ResponsibilityRepository responsibilities, SellerAccountRepository accounts,
                                         ChannelRepository channels) {
        this.responsibilities = responsibilities;
        this.accounts = accounts;
        this.channels = channels;
    }

    /**
     * Whether this organisation has delegated customer work to a responsibility. While it has, the Proactive Operations
     * Agent yields the organisation: the same inquiries and reviews must not be investigated by two loops, and the one
     * open card per subject belongs to the responsibility's case.
     */
    public boolean ownsCustomerWork(UUID orgId) {
        return orgId != null && responsibilities.existsByOrgIdAndTemplateCodeAndStatus(orgId,
                ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1, ResponsibilityStatus.ACTIVE);
    }

    public boolean ownsScheduledCollection(UUID orgId, UUID sellerAccountId, String dataTypeName) {
        DataType dataType;
        try {
            dataType = DataType.valueOf(dataTypeName);
        } catch (RuntimeException e) {
            return false;
        }
        for (ResponsibilityTemplate template : ResponsibilityTemplate.values()) {
            if (!responsibilities.existsByOrgIdAndTemplateCodeAndStatus(orgId, template, ResponsibilityStatus.ACTIVE)) {
                continue;
            }
            SellerAccount account = accounts.findById(sellerAccountId)
                    .filter(a -> orgId.equals(a.getOrgId()))
                    .orElse(null);
            if (account == null || account.isFileUpload()) {
                return false;
            }
            String code = channels.findById(account.getChannelId()).map(Channel::getCode).orElse(null);
            if (code != null && template.requires(code, dataType)) {
                return true;
            }
        }
        return false;
    }
}
