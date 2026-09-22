import type { ReactNode } from "react";
import { PageHead } from "./ui/PageHead";

/**
 * The legacy page header, now the v2 {@link PageHead} (UI/UX v2 Phase 4). It kept its own `text-2xl` title — a size
 * no v2 screen uses — so the screens still on it opened louder than every screen around them. Same slots, one header.
 */
export function PageHeader({
  title,
  description,
  meta,
  action,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return <PageHead title={title} description={description} meta={meta} action={action} />;
}
