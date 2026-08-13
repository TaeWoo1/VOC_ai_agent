package com.sellerops.selleraccount.dto;

/**
 * One account's opaque session slot and whether it already holds a credential.
 *
 * @param accountSlot       the stable, opaque 24-hex slot — never a seller-account id, and never derived from
 *                          one in a way a caller could invert. Stable across restarts by design.
 * @param credentialPresent whether a credential row exists for this account. A row-existence check: nothing is
 *                          decrypted, and no field of the credential is read or implied. It travels with the
 *                          slot because a credential handoff needs an EMPTY account, and reading the two
 *                          separately is how a caller mints a slot for one account and checks the other.
 */
public record AccountSessionSlotView(String accountSlot, boolean credentialPresent) {
}
