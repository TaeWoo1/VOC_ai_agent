package com.sellerops.selleraccount;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.dto.ApiChannelRequest;
import com.sellerops.selleraccount.dto.FileChannelRequest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The guided-connection start invariants: a first-time seller gets a PENDING API account to attach
 * credentials to (so the wizard is no longer stranded with no account), re-entering is idempotent and
 * never downgrades a settled connection, an unknown channel fails closed, and an API-mode account is
 * kept separate from a file-upload account on the same channel (cookies/creds never mix by construction).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SellerAccountServiceTest {

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;

    private final UUID org = UUID.randomUUID();

    private SellerAccountService service() {
        return new SellerAccountService(accounts, channels);
    }

    private Channel seedNaverChannel() {
        Channel c = new Channel();
        c.setCode("NAVER-" + UUID.randomUUID());
        c.setNameKo("네이버");
        c.setStatus(ChannelStatus.AVAILABLE);
        c.setSortOrder(1);
        return channels.save(c);
    }

    @Test
    void createsAPendingApiAccountForAFirstTimeSeller() {
        SellerAccountService svc = service();
        Channel naver = seedNaverChannel();

        var res = svc.registerApiChannel(org, new ApiChannelRequest(naver.getId(), null));

        assertThat(res.channelId()).isEqualTo(naver.getId());
        assertThat(res.connectionStatus()).isEqualTo(ChannelStatus.PENDING); // not CONNECTED — no creds/test/sync yet
        assertThat(res.fileUpload()).isFalse();
        assertThat(res.lastSyncedAt()).isNull();
        assertThat(res.alias()).isEqualTo("네이버"); // defaults to the channel name
        assertThat(accounts.findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(org, naver.getId(), false)).isPresent();
    }

    @Test
    void isIdempotentAndNeverDowngradesASettledConnection() {
        SellerAccountService svc = service();
        Channel naver = seedNaverChannel();

        var first = svc.registerApiChannel(org, new ApiChannelRequest(naver.getId(), null));

        // Simulate the account settling to CONNECTED after a real register → test → sync.
        SellerAccount settled = accounts.findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(org, naver.getId(), false).orElseThrow();
        settled.setConnectionStatus(ChannelStatus.CONNECTED);
        accounts.save(settled);

        var second = svc.registerApiChannel(org, new ApiChannelRequest(naver.getId(), null));

        assertThat(second.id()).isEqualTo(first.id());                          // find-or-create, not a new row
        assertThat(second.connectionStatus()).isEqualTo(ChannelStatus.CONNECTED); // NOT downgraded to PENDING
        assertThat(accounts.findAllByOrgId(org)).hasSize(1);
    }

    @Test
    void unknownChannelFailsClosed() {
        SellerAccountService svc = service();

        assertThatThrownBy(() -> svc.registerApiChannel(org, new ApiChannelRequest(UUID.randomUUID(), null)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void anApiAccountIsSeparateFromAFileUploadAccountOnTheSameChannel() {
        SellerAccountService svc = service();
        Channel naver = seedNaverChannel();

        // A pre-existing file-upload account must not be reused (or overwritten) by the API start.
        SellerAccount fileAcct = new SellerAccount();
        fileAcct.setOrgId(org);
        fileAcct.setChannelId(naver.getId());
        fileAcct.setAlias("파일 업로드");
        fileAcct.setConnectionStatus(ChannelStatus.CONNECTED);
        fileAcct.setFileUpload(true);
        accounts.save(fileAcct);

        var api = svc.registerApiChannel(org, new ApiChannelRequest(naver.getId(), null));

        assertThat(api.fileUpload()).isFalse();
        assertThat(api.id()).isNotEqualTo(fileAcct.getId());
        assertThat(accounts.findAllByOrgId(org)).hasSize(2); // the two coexist, distinct rows
    }

    @Test
    void aFileChannelRegistrationDoesNotClobberAnExistingApiAccount() {
        SellerAccountService svc = service();
        Channel naver = seedNaverChannel();

        // Seller starts the API wizard (PENDING API account), THEN registers a file channel on the same
        // channel. The file flow must land on its own row — never overwrite the API account mid-flow.
        var api = svc.registerApiChannel(org, new ApiChannelRequest(naver.getId(), null));
        var file = svc.registerFileChannel(org, new FileChannelRequest(naver.getId(), null));

        assertThat(file.id()).isNotEqualTo(api.id());                          // distinct rows, not a clobber
        assertThat(file.fileUpload()).isTrue();
        SellerAccount apiRow = accounts.findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(
                org, naver.getId(), false).orElseThrow();
        assertThat(apiRow.getConnectionStatus()).isEqualTo(ChannelStatus.PENDING); // API account untouched
        assertThat(apiRow.isFileUpload()).isFalse();
        assertThat(accounts.findAllByOrgId(org)).hasSize(2);
    }
}
