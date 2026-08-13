import type { LucideIcon } from 'lucide-react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional lucide icon. Icon-only segments are not supported on purpose —
   *  an operational tool should never make the user decode a glyph. */
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  /** `null` means "no segment selected" — used when a different control (e.g. a
   *  matrix cell) has taken over the selection and none of these apply. */
  value: T | null;
  onChange: (value: T) => void;
  /** Accessible name for the group (e.g. "Submódulo", "Período"). */
  label: string;
  /** `full` stretches segments to fill the width — for 2–4 options acting as a
   *  primary view switch. Default `auto` sizes to content and scrolls. */
  width?: 'auto' | 'full';
  className?: string;
}

/** One bordered track containing borderless segments — replaces the
 *  `px-3 py-1.5 rounded-lg …border` chip that had been copy-pasted across ten
 *  files. N chips each carrying their own stroke read as N little boxes in a
 *  row; a single track with a filled selected segment reads as one control.
 *
 *  Scrolls horizontally rather than wrapping, so an 8-option group (Warehouse
 *  Digital Twin) stays one line on a tablet instead of stacking into a tower
 *  that pushes content below the fold. `scrollbar-width: none` keeps the track
 *  clean — the partially-visible segment is the affordance.
 *
 *  Keyboard: native buttons + roving arrow keys via `role="tablist"` semantics
 *  are intentionally NOT used here, because these switch content in place
 *  rather than acting as ARIA tabs; plain buttons in a labelled group give
 *  correct screen-reader output without lying about the widget type. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  width = 'auto',
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-control border border-edge bg-surface-3 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        width === 'full' ? 'w-full' : ''
      } ${className}`}
    >
      {options.map(option => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={`flex min-h-[36px] flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[0.4rem] px-3 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
              width === 'full' ? 'flex-1' : ''
            } ${
              selected
                ? 'bg-surface text-fg shadow-control'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {Icon && <Icon size={14} className="flex-shrink-0" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
