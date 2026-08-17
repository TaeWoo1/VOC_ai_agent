import type { InboxFilters, PeriodFilter, StateFilter, TypeFilter } from "../../lib/inboxWorkspace";
import {
  PERIOD_OPTIONS,
  STATE_OPTIONS,
  TYPE_OPTIONS,
  channelOptions,
} from "../../lib/inboxWorkspace";
import type { FeedItem } from "../../lib/types";

function OptionRow<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`min-h-[36px] rounded-lg px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${
                active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Filter rail for the inbox.
 *
 * The channel list is built from the loaded rows — never from a fixed catalogue. A fixed list here
 * would tell the seller which marketplaces the product supports, which is a claim the capability
 * record does not back; what is offered is only what has actually arrived.
 */
export function InboxFilterRail({
  items,
  filters,
  onChange,
  /** False when the surface already fixes the type (the 문의 page): the 유형 row is then noise. */
  showType = true,
  /** The state options this surface offers, in its own order (the 문의 page: 답변 필요 → 답변함 → 전체). */
  stateOptions = STATE_OPTIONS,
}: {
  items: readonly FeedItem[];
  filters: InboxFilters;
  onChange: (next: InboxFilters) => void;
  showType?: boolean;
  stateOptions?: ReadonlyArray<{ value: StateFilter; label: string }>;
}) {
  const channels = channelOptions(items);

  return (
    <aside aria-label="인박스 필터" className="space-y-6">
      {showType ? (
        <OptionRow<TypeFilter>
          legend="유형"
          options={TYPE_OPTIONS}
          value={filters.type}
          onChange={(type) => onChange({ ...filters, type })}
        />
      ) : null}
      <OptionRow<StateFilter>
        legend="상태"
        options={stateOptions}
        value={filters.state}
        onChange={(state) => onChange({ ...filters, state })}
      />
      <OptionRow<PeriodFilter>
        legend="기간"
        options={PERIOD_OPTIONS}
        value={filters.period}
        onChange={(period) => onChange({ ...filters, period })}
      />

      {channels.length > 0 ? (
        <fieldset className="border-0 p-0">
          <legend className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            채널
          </legend>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={filters.channel === null}
              onClick={() => onChange({ ...filters, channel: null })}
              className={`min-h-[36px] rounded-lg px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${
                filters.channel === null
                  ? "bg-brand-50 text-brand-700"
                  : "text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              전체
            </button>
            {channels.map((channel) => {
              const active = filters.channel === channel.value;
              return (
                <button
                  key={channel.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ ...filters, channel: channel.value })}
                  className={`min-h-[36px] rounded-lg px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${
                    active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-canvas hover:text-ink"
                  }`}
                >
                  {channel.value}
                  <span className="ml-1.5 tabular-nums text-muted">{channel.count}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </aside>
  );
}
