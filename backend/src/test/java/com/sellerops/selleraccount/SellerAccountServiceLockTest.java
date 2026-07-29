package com.sellerops.selleraccount;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.selleraccount.dto.ApiChannelRequest;
import jakarta.persistence.LockModeType;
import java.lang.reflect.Method;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.data.jpa.repository.Lock;

/**
 * Structurally pins the concurrency guard on the connection-start path (a true multi-connection race test
 * needs a real RDBMS with SELECT … FOR UPDATE; the test DB is H2, so the lock USAGE is fixed structurally):
 *  1. the channel lookup carries a {@code PESSIMISTIC_WRITE} lock, and
 *  2. {@code registerApiChannel} takes that lock BEFORE it looks up / creates the account, and never uses
 *     the unlocked {@code findById}.
 * Together these serialize concurrent starts on a channel so two tabs / a retried request cannot both
 * insert a PENDING API account for the same (org, channel).
 */
class SellerAccountServiceLockTest {

    @Test
    void channelLookupForUpdateIsAnnotatedPessimisticWrite() throws NoSuchMethodException {
        Method m = ChannelRepository.class.getMethod("findByIdForUpdate", UUID.class);
        Lock lock = m.getAnnotation(Lock.class);
        assertThat(lock).as("findByIdForUpdate must carry @Lock").isNotNull();
        assertThat(lock.value()).isEqualTo(LockModeType.PESSIMISTIC_WRITE);
    }

    @Test
    void registerApiChannelLocksTheChannelRowBeforeTheAccountLookupAndCreate() {
        ChannelRepository channels = mock(ChannelRepository.class);
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        UUID org = UUID.randomUUID();
        UUID channelId = UUID.randomUUID();

        Channel channel = new Channel();
        channel.setCode("NAVER");
        channel.setNameKo("네이버");
        channel.setStatus(ChannelStatus.AVAILABLE);
        when(channels.findByIdForUpdate(channelId)).thenReturn(Optional.of(channel));
        when(accounts.findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(eq(org), any(), eq(false)))
                .thenReturn(Optional.empty());
        when(accounts.save(any(SellerAccount.class))).thenAnswer(inv -> inv.getArgument(0));

        new SellerAccountService(accounts, channels).registerApiChannel(org, new ApiChannelRequest(channelId, null));

        // Never the unlocked read; always the FOR UPDATE lock, and BEFORE the account find-or-create → save.
        verify(channels, never()).findById(any());
        InOrder order = inOrder(channels, accounts);
        order.verify(channels).findByIdForUpdate(channelId);
        order.verify(accounts).findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(eq(org), any(), eq(false));
        order.verify(accounts).save(any(SellerAccount.class));
    }
}
