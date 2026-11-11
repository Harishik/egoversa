import { useId, type CSSProperties, type ReactNode } from 'react';

export function Tip({ text, children, side = 'top', align = 'center' }: { text: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; align?: 'center' | 'start' | 'end' }) {
  return (
    <span className="tip" data-side={side} data-align={align}>
      {children}
      <span role="tooltip">{text}</span>
    </span>
  );
}

/** Small "i" affordance that explains a control. Focusable so the tooltip is keyboard reachable. */
export function Info({ text, align }: { text: ReactNode; align?: 'center' | 'start' | 'end' }) {
  return (
    <Tip text={text} align={align}>
      <button type="button" aria-label="More information" className="grid h-4 w-4 place-items-center rounded-full border border-night-500 text-[10px] font-bold leading-none text-dim hover:text-ink">
        i
      </button>
    </Tip>
  );
}

export function Section({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b hairline px-4 py-4 last:border-b-0">
      <header className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-bold tracking-tight text-ink">{title}</h3>
        {hint && <Info text={hint} align="start" />}
        <span className="ml-auto flex items-center gap-1">{action}</span>
      </header>
      {children}
    </section>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: ReactNode;
  color?: string;
}

export function Slider({ label, value, min, max, step, onChange, format, hint, color = '#7C87FF' }: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[12.5px]">
        <label htmlFor={id} className="font-medium text-muted">{label}</label>
        {hint && <Info text={hint} align="start" />}
        <output htmlFor={id} className="num ml-auto text-ink">{format ? format(value) : value}</output>
      </div>
      <input
        id={id}
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%`, '--fill': color } as CSSProperties}
      />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-night-600 bg-night-900 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md font-semibold transition-colors ${size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]'} ${value === o.value ? 'bg-night-600 text-ink' : 'text-dim hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num rounded border border-night-500 bg-night-800 px-1.5 py-0.5 text-[11px] text-muted">{children}</kbd>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-night-600 px-6 py-12 text-center">
      <div className="max-w-md">
        <p className="font-display text-2xl text-ink">{title}</p>
        {children && <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{children}</p>}
        {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** Colour swatches for the two reference frames, used everywhere a coordinate is shown. */
export function FrameTag({ frame, children }: { frame: 'world' | 'viewer'; children?: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${frame === 'world' ? 'text-world' : 'text-viewer'}`}>
      <span className={`h-2 w-2 rounded-sm ${frame === 'world' ? 'bg-world' : 'bg-viewer'}`} />
      {children ?? (frame === 'world' ? 'World frame' : 'Viewer frame')}
    </span>
  );
}
