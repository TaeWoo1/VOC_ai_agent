package com.sellerops.selleraccount;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.dto.AccountSessionSlotView;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The account-slot read: the one way for tooling outside the process to NAME the account a credential handoff
 * will store into.
 *
 * <p>Two properties matter and both are here. The slot is org-scoped like everything else — a foreign account
 * id is a 404, never a slot. And the emptiness answer travels WITH the slot, because a caller that reads them
 * separately is a caller that can mint a slot for one account and check the other.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class AccountSessionSlotControllerTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired AccountSessionSlotRepository slots;
    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private CredentialVault vault;
    private AccountSessionSlotController controller;
    private UUID channelId;

    @BeforeEach
    void setUp() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        vault = new CredentialVault(credentials, new ObjectMapper(), Base64.getEncoder().encodeToString(key), "test-key");
        controller = new AccountSessionSlotController(accounts, new AccountSessionSlotService(slots), vault);
        Channel ch = new Channel();
        ch.setCode("COUPANG");
        ch.setNameKo("쿠팡");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSortOrder(0);
        channelId = channels.save(ch).getId();
    }

    private SellerAccount account(UUID ownerOrg) {
        SellerAccount a = new SellerAccount();
        a.setOrgId(ownerOrg);
        a.setChannelId(channelId);
        a.setConnectionStatus(ChannelStatus.PENDING);
        a.setFileUpload(false);
        return accounts.save(a);
    }

    private AuthPrincipal principal(UUID orgId) {
        return new AuthPrincipal(UUID.randomUUID(), orgId, "proof@sellerops.ai");
    }

    @Test
    void returnsAStableOpaqueSlotAndReportsTheAccountEmpty() {
        SellerAccount acc = account(org);

        AccountSessionSlotView first = controller.sessionSlot(principal(org), acc.getId());
        AccountSessionSlotView second = controller.sessionSlot(principal(org), acc.getId());

        assertThat(first.accountSlot()).matches("^[0-9a-f]{24}$");
        // Stable: the handoff's binding and the agent's profile directory both rest on the slot not moving.
        assertThat(second.accountSlot()).isEqualTo(first.accountSlot());
        assertThat(first.credentialPresent()).isFalse();
        // …and the slot is not the account id in disguise.
        assertThat(first.accountSlot()).doesNotContain(acc.getId().toString().replace("-", "").substring(0, 8));
    }

    @Test
    void reportsCredentialPresentOnceOneIsStored_soAHandoffKnowsToRefuseBeforeTheSitting() {
        SellerAccount acc = account(org);
        assertThat(controller.sessionSlot(principal(org), acc.getId()).credentialPresent()).isFalse();

        vault.store(org, acc.getId(), "API", "HMAC", Map.of("access_key", "a", "secret_key", "b"),
                null, null, UUID.randomUUID());

        AccountSessionSlotView after = controller.sessionSlot(principal(org), acc.getId());
        assertThat(after.credentialPresent()).isTrue();
        // The slot did not change because a credential appeared — it names the account, not its state.
        assertThat(after.accountSlot()).isEqualTo(controller.sessionSlot(principal(org), acc.getId()).accountSlot());
    }

    @Test
    void aForeignAccountIsA404_neverASlot() {
        SellerAccount theirs = account(UUID.randomUUID());

        assertThatThrownBy(() -> controller.sessionSlot(principal(org), theirs.getId()))
                .isInstanceOf(ApiException.class);
        // Nothing was minted for it either — a refused read leaves no row behind to be found later.
        assertThat(slots.count()).isZero();
    }

    @Test
    void anUnknownAccountIsA404() {
        assertThatThrownBy(() -> controller.sessionSlot(principal(org), UUID.randomUUID()))
                .isInstanceOf(ApiException.class);
        assertThat(slots.count()).isZero();
    }
}
