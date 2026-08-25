package com.sellerops.inquiry.publish.cafe24;

import com.sellerops.connector.cafe24.onboarding.Cafe24ScopeContract;
import com.sellerops.credential.CredentialVault;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Whether this seller has actually agreed to let SellerOps post an answer on their mall.
 *
 * <p>The answer is read from what the MALL granted, not from what a deployment asked for. Cafe24
 * returns the granted scope list on every token exchange and refresh, and
 * {@code CredentialVault.recordGrantedScopes} has been storing it since before there was a write to
 * gate — so the check costs nothing and cannot drift from a configuration file.
 *
 * <p>Absence is the default and the safe answer: a connection made before the option existed, a
 * seller who declined it, and a credential that will not open all answer false, and the publish path
 * treats all three the same way — nothing is sent, and the seller sees that the permission is needed.
 */
@Component
public class Cafe24AnswerExecutionGrant {

    private final CredentialVault vault;

    public Cafe24AnswerExecutionGrant(CredentialVault vault) {
        this.vault = vault;
    }

    /** True only when the recorded grant carries {@code mall.write_community}. */
    public boolean hasWriteGrant(UUID orgId, UUID sellerAccountId) {
        try {
            return Cafe24ScopeContract.grantsWrite(vault.diagnose(orgId, sellerAccountId).grantedScopes());
        } catch (RuntimeException e) {
            return false;
        }
    }
}
