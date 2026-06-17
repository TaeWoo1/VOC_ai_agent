export function DataBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-lg bg-canvas px-2.5 py-1 text-sm text-muted">
      {label}
    </span>
  );
}
