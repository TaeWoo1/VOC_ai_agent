package com.sellerops.selleraccount;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.dto.AccountSessionSlotView;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * **The opaque account slot for one of the caller's own accounts, plus whether that account is empty.**
 *
 * <p>The slot is what the Action Window wire and the credential handoff carry INSTEAD of a seller-account id,
 * so something has to be able to produce one. Until now nothing could, from outside the process: the launch
 * resolver minted slots internally and the credential-handoff harness had no way to name the account it was
 * about to store into except by hand.
 *
 * <p><b>Why the two facts travel together.</b> A handoff needs a slot for an account with NO credential on it,
 * and reading those separately is how a caller ends up minting a slot for one account and checking emptiness on
 * another. One read answers both, so they cannot disagree.
 *
 * <p><b>What it is not.</b> The slot is not a capability: it is long-lived and reused, and the org still comes
 * from the JWT everywhere it is accepted. Handing it to a caller who is already authenticated for that account
 * grants nothing they did not have — which is exactly why the handoff endpoint resolves the slot inside the
 * caller's org rather than trusting it. A foreign or unknown account id is a 404 here, like everywhere else.
 *
 * <p>Read-only and idempotent apart from first-use slot minting, which is find-or-create by construction. It
 * never decrypts a credential — {@code credentialPresent} is a row-existence check — and it calls no
 * marketplace.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}")
public class AccountSessionSlotController {

    private final SellerAccountRepository accounts;
    private final AccountSessionSlotService slots;
    private final CredentialVault vault;

    public AccountSessionSlotController(SellerAccountRepository accounts, AccountSessionSlotService slots,
                                        CredentialVault vault) {
        this.accounts = accounts;
        this.slots = slots;
        this.vault = vault;
    }

    /** The account's stable slot, and whether a credential is already stored against it. */
    @GetMapping("/session-slot")
    public AccountSessionSlotView sessionSlot(@AuthenticationPrincipal AuthPrincipal principal,
                                              @PathVariable UUID accountId) {
        UUID orgId = principal.orgId();
        SellerAccount account = accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        String slot = slots.resolveSlot(orgId, account.getId(), account.getChannelId());
        return new AccountSessionSlotView(slot, vault.hasCredential(orgId, account.getId()));
    }
}
