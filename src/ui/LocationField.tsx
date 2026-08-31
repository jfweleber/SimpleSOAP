import { useState } from 'react'
import type { IncidentLocation } from '../model/types'
import { currentPosition, formatCoords, formatCoordsSpoken } from '../model/location'
import { Area } from './fields'
import { hhmm } from '../format/time'

/**
 * Place name and coordinates together.
 *
 * A GPS fix is what an aircraft needs; a place name is what dispatch
 * recognises, and reading "the second switchback above the trailhead" is
 * faster and harder to garble over a radio than eleven digits. Both are worth
 * having, so neither replaces the other.
 */
export function LocationField({
  value,
  disabled,
  onChange,
  autoFocusFix,
}: {
  value: IncidentLocation
  disabled?: boolean
  onChange: (next: IncidentLocation) => void
  /** offer the fix prominently, for the start-of-note prompt */
  autoFocusFix?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const takeFix = async () => {
    setBusy(true)
    setError(null)
    try {
      const fix = await currentPosition()
      onChange({ ...value, ...fix })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const coords = formatCoords(value)
  const spoken = formatCoordsSpoken(value)

  return (
    <div className="locField">
      {error && <div className="alert">{error}</div>}

      <button
        className={autoFocusFix && !coords ? 'btn wide' : 'btn small ghost'}
        onClick={takeFix}
        disabled={busy || disabled}
      >
        {busy ? 'Getting a fix…' : coords ? 'Update GPS fix' : 'Use current location'}
      </button>

      {coords && (
        <div className="fixBox">
          <div className="fixRow">
            <span className="fixLabel">Decimal</span>
            <span className="mono">{coords}</span>
          </div>
          <div className="fixRow">
            <span className="fixLabel">Spoken</span>
            <span className="mono">{spoken}</span>
          </div>
          <div className="fixMeta">
            {value.accuracyM !== null && `± ${Math.round(value.accuracyM)} m`}
            {value.fixedAt && ` · ${hhmm(value.fixedAt)}`}
          </div>
          {!disabled && (
            <button
              className="link danger"
              onClick={() =>
                onChange({ ...value, latitude: null, longitude: null, accuracyM: null, fixedAt: null })
              }
            >
              Clear fix
            </button>
          )}
        </div>
      )}

      <Area
        label="Place name"
        rows={2}
        value={value.description}
        disabled={disabled}
        placeholder="Trail, drainage, mile marker — whatever dispatch will recognise"
        onChange={(description) => onChange({ ...value, description })}
      />
    </div>
  )
}
