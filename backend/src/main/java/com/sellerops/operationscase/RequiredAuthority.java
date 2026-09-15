package com.sellerops.operationscase;

/** Who may carry a case's next step. AUTO PROCESS is Reviewnary state; anything that leaves Reviewnary is HUMAN. */
public enum RequiredAuthority {
    AUTO,
    HUMAN
}
