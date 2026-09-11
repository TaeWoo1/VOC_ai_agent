/**
 * **Which execution provider a boot may select, and what happens when it selects one this build cannot honour.**
 *
 * `REVIEWNARY_EXECUTION_PROVIDER` is an EXPERIMENT switch (Aside Acquisition Track, M2). The default is and
 * stays `LOCAL_HELPER`; the production rollout of `ASIDE` is not approved, and nothing here changes a default
 * silently. Selecting `ASIDE` in a build that binds no export workflow for the channel is refused at boot,
 * loudly — never quietly downgraded to `LOCAL_HELPER`, because an operator who asked for one executor and got
 * another would read the run's outcome as evidence about the wrong thing.
 */
import { DEFAULT_EXECUTION_PROVIDER, isExecutionProviderKind, type ExecutionProviderKind } from "./execution-provider";

export const EXECUTION_PROVIDER_ENV = "REVIEWNARY_EXECUTION_PROVIDER" as const;

/** Pure: parse the switch. Absent/blank ⇒ the default. An unknown value is a configuration error, not a default. */
export function parseExecutionProvider(raw: string | undefined): ExecutionProviderKind {
  const value = (raw ?? "").trim();
  if (value.length === 0) return DEFAULT_EXECUTION_PROVIDER;
  if (isExecutionProviderKind(value)) return value;
  throw new Error(`${EXECUTION_PROVIDER_ENV}: unknown execution provider "${value}" (expected LOCAL_HELPER or ASIDE)`);
}

/**
 * Pure boot gate. `LOCAL_HELPER` always boots. `ASIDE` boots only when the build binds a workflow for the
 * channel; in M2 no channel does, so the selection is refused with the reason spelled out.
 */
export function assertExecutionProviderBootable(kind: ExecutionProviderKind, boundWorkflowIds: readonly string[]): void {
  if (kind === "LOCAL_HELPER") return;
  if (boundWorkflowIds.length > 0) return;
  throw new Error(
    `${EXECUTION_PROVIDER_ENV}=${kind}: this build binds no export workflow for the Aside provider (NAVER workflow is Aside Acquisition Track M3). Refusing to start rather than falling back to LOCAL_HELPER.`,
  );
}
