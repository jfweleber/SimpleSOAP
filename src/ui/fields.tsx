import type { ReactNode } from 'react'
import type { Tri } from '../model/types'

/** Text input with a label. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  disabled?: boolean
  inputMode?: 'text' | 'numeric' | 'tel'
}) {
  return (
    <label className="field">
      <span className="fieldLabel">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="fieldHint">{hint}</span>}
    </label>
  )
}

/** Multi-line text. Grows with content up to a cap. */
export function Area({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 3,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  rows?: number
  disabled?: boolean
}) {
  return (
    <label className="field">
      <span className="fieldLabel">{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="fieldHint">{hint}</span>}
    </label>
  )
}

/**
 * Integer entry that keeps an empty box empty.
 *
 * A vitals field left blank means "not measured", which is different from
 * zero — so the value is null until something valid is typed.
 */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  disabled,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  unit?: string
  min?: number
  max?: number
  disabled?: boolean
}) {
  const outOfRange =
    value !== null && ((min !== undefined && value < min) || (max !== undefined && value > max))
  return (
    <label className="field num">
      <span className="fieldLabel">{label}</span>
      <span className="numWrap">
        <input
          type="number"
          inputMode="numeric"
          value={value === null ? '' : value}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onChange(null)
            const parsed = Number(raw)
            onChange(Number.isFinite(parsed) ? parsed : null)
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
      {outOfRange && <span className="fieldHint warn">Outside the usual range — check it.</span>}
    </label>
  )
}

/** Single choice from a short list, as tappable chips. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: readonly T[]
  value: T | null
  onChange: (v: T | null) => void
  disabled?: boolean
}) {
  return (
    <div className="field">
      <span className="fieldLabel">{label}</span>
      <div className="chips">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={value === option ? 'chip on' : 'chip'}
            // tapping the active chip clears it — nothing is mandatory
            onClick={() => onChange(value === option ? null : option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

/** Date + time entry backed by an epoch value. */
export function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
}) {
  const asInput = value === null ? '' : toLocalInput(value)
  return (
    <label className="field">
      <span className="fieldLabel">{label}</span>
      <input
        type="datetime-local"
        value={asInput}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value
          if (!raw) return onChange(null)
          const parsed = new Date(raw).getTime()
          onChange(Number.isFinite(parsed) ? parsed : null)
        }}
      />
    </label>
  )
}

/** datetime-local wants local wall-clock, not an ISO instant. */
function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Collapsible section of the SOAP note. */
export function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string
  summary?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className={open ? 'card open' : 'card'}>
      <button type="button" className="cardHead" onClick={onToggle} aria-expanded={open}>
        <span className="cardTitle">{title}</span>
        {summary && !open && <span className="cardSummary">{summary}</span>}
        <span className="cardChevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="cardBody">{children}</div>}
    </section>
  )
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="row2">{children}</div>
}

/**
 * Yes / No with an unanswered third state.
 *
 * Tapping the active answer clears it back to unanswered, so a mis-tap is
 * recoverable and nothing is silently assumed. The unanswered state is shown
 * explicitly rather than looking like a "no".
 */
export function TriChoice({
  label,
  value,
  onChange,
  yesLabel = 'Yes',
  noLabel = 'No',
  /** which answer is clinically concerning, for colouring */
  alarmOn,
  disabled,
}: {
  label: string
  value: Tri
  onChange: (v: Tri) => void
  yesLabel?: string
  noLabel?: string
  alarmOn?: 'yes' | 'no'
  disabled?: boolean
}) {
  const pick = (answer: 'yes' | 'no') => onChange(value === answer ? null : answer)
  return (
    <div className="field">
      <span className="fieldLabel">{label}</span>
      <div className="chips">
        <button
          type="button"
          disabled={disabled}
          className={`chip${value === 'yes' ? (alarmOn === 'yes' ? ' on alarm' : ' on') : ''}`}
          onClick={() => pick('yes')}
        >
          {yesLabel}
        </button>
        <button
          type="button"
          disabled={disabled}
          className={`chip${value === 'no' ? (alarmOn === 'no' ? ' on alarm' : ' on') : ''}`}
          onClick={() => pick('no')}
        >
          {noLabel}
        </button>
        {value === null && <span className="unanswered">not assessed</span>}
      </div>
    </div>
  )
}
