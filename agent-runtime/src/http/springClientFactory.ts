/**
 * The production {@link SpringClientFactory}: one {@link HttpSpringClient} per forwarded operator
 * token, serving all three domain client interfaces (it implements all three). The org is derived
 * from the token on the backend — this factory never sees or sets an org, and holds no credential
 * beyond the short-lived bearer it is handed per request.
 */
import { HttpSpringClient } from "../spring/SpringClient";
import type { SpringClientBundle, SpringClientFactory } from "./AgentRunService";

export function defaultSpringClientFactory(backendBaseUrl: string): SpringClientFactory {
  return (token: string): SpringClientBundle => {
    const client = new HttpSpringClient({ baseUrl: backendBaseUrl, token });
    return { inquiry: client, review: client, issue: client, identity: client };
  };
}
