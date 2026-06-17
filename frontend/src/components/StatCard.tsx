type Tone = "default" | "warn" | "bad";

const VALUE_TONE: Record<Tone, string> = {
  default: "text-ink",
  warn: "text-warn",
  bad: "text-bad",
};

export function StatCard({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
}) {
  return (
    <div className="card p-5">
      <p className="text-base text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${VALUE_TONE[tone]}`}>
        {value}
        {unit ? <span className="ml-1 text-lg font-semibold text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}
