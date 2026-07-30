/**
 * The review-reply tool registry bound to a backend client. Reuses the same
 * {@link ToolRegistry} class as the inquiry domain — the registry is capability-agnostic;
 * only the bound tool set differs.
 */
import { ToolRegistry } from "./ToolRegistry";
import { buildReviewTools } from "./reviewTools";
import type { ReviewSpringClient } from "../spring/ReviewSpringClient";

export function buildReviewToolRegistry(client: ReviewSpringClient): ToolRegistry {
  return new ToolRegistry(buildReviewTools(client));
}
