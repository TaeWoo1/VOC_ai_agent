import { NavContent } from "./NavContent";

/** Desktop sidebar. Hidden below `md`, where the mobile drawer (MobileNav) takes
 *  over. Both render the same {@link NavContent}, so the two IAs stay in sync. */
export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-line bg-surface px-3 py-6 md:block">
      <NavContent />
    </aside>
  );
}
