import type { ChannelStatus } from "../lib/types";

const MAP: Record<ChannelStatus, { label: string; cls: string }> = {
  CONNECTED: { label: "연결됨", cls: "bg-good/10 text-good" },
  AVAILABLE: { label: "연결 가능", cls: "bg-brand/10 text-brand-700" },
  FILE_UPLOAD_SUPPORTED: { label: "파일 업로드 지원", cls: "bg-ink/5 text-ink" },
  PREPARING: { label: "준비 중", cls: "bg-muted/15 text-muted" },
  REQUEST_AVAILABLE: { label: "요청 가능", cls: "bg-warn/10 text-warn" },
};

export function StatusBadge({ status }: { status: ChannelStatus }) {
  const { label, cls } = MAP[status];
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${cls}`}>
      {label}
    </span>
  );
}
