import { Link } from "react-router-dom";
import type { HomePreparedItem } from "../../lib/types";

/**
 * <b>How a piece of already-decided work reads on a Home — in one place, for every Home there is.</b>
 *
 * <p>Each row is something a record already says is ready: a reply the seller approved, a draft that exists, an
 * improvement they accepted. Nothing here is derived from 「이건 답장이 필요해 보인다」 — a Home that invented work
 * would be asking for something no record supports.
 *
 * <p><b>Every row is a link out and nothing else.</b> No button, no verb that sounds like dispatch: this product
 * has no dispatcher, and the seller finishes the work on the surface that owns it — the review's own reply screen,
 * the inquiry, the problem. Rendering a control here that looked like 「보내기」 would promise a send this
 * component cannot perform and no approval covers.
 *
 * <p>The distinguishing fact leads when there is one. Four rows reading 「승인된 리뷰 답변」 are four links a seller
 * cannot choose between; the kind of work follows as the quieter half.
 */
export function PreparedWorkList({ rows }: { rows: readonly HomePreparedItem[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
      {rows.map((row) => (
        <li key={`${row.kind}-${row.id}`} className="p-3">
          <Link
            to={row.to}
            className="block rounded break-keep text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            {row.detail ? (
              <>
                <span className="break-keep">{row.detail}</span>
                <span className="ml-2 text-sm text-muted">{row.label}</span>
              </>
            ) : (
              <span className="break-keep">{row.label}</span>
            )}
            <span className="ml-1 text-brand-700" aria-hidden="true">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
