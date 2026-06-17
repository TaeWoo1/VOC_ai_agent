export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line py-10 text-center text-muted">
      {message}
    </div>
  );
}
