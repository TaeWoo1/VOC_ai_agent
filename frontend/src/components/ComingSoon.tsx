export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-16 text-center">
      <span className="text-3xl">🛠️</span>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="max-w-md text-lg text-muted">{description}</p>
      <span className="rounded-full bg-canvas px-4 py-1.5 text-base font-semibold text-muted">
        준비 중
      </span>
    </div>
  );
}
