import type { BodyRegion } from '../model/types'
import { BODY_ZONES, OFF_DIAGRAM_REGION } from './bodyZones'

/**
 * Segmented body map for the head-to-toe survey.
 *
 * Each segment is both the drawing and the tap target, so what you see is what
 * you hit. Left and right are the PATIENT's, which is mirrored on screen — the
 * same convention as an anatomical chart, and labelled on the figure because
 * getting it backwards on a limb injury matters.
 */

export function BodyDiagram({
  counts,
  selected,
  onSelect,
}: {
  counts: Partial<Record<BodyRegion, number>>
  selected: BodyRegion | null
  onSelect: (region: BodyRegion) => void
}) {
  const backCount = counts[OFF_DIAGRAM_REGION] ?? 0

  return (
    <div className="bodyWrap">
      <svg viewBox="0 0 220 322" className="body" role="group" aria-label="Body map">
        {BODY_ZONES.map((zone) => {
          const count = counts[zone.region] ?? 0
          const className = [
            'zone',
            count > 0 ? 'hasFindings' : '',
            selected === zone.region ? 'selected' : '',
          ]
            .filter(Boolean)
            .join(' ')

          const props = {
            className,
            onClick: () => onSelect(zone.region),
            role: 'button',
            tabIndex: 0,
            'aria-label': `${zone.region}${count ? `, ${count} finding${count === 1 ? '' : 's'}` : ''}`,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(zone.region)
              }
            },
          }

          return zone.shape === 'ellipse' ? (
            <ellipse key={zone.region} {...zone.attrs} {...props} />
          ) : (
            <rect key={zone.region} {...zone.attrs} {...props} />
          )
        })}

        {BODY_ZONES.map((zone) => {
          const count = counts[zone.region] ?? 0
          if (count === 0) return null
          return (
            <g key={`${zone.region}-b`} className="badgeG" aria-hidden="true">
              <circle cx={zone.bx} cy={zone.by} r="7.5" />
              <text x={zone.bx} y={zone.by + 3.2}>
                {count}
              </text>
            </g>
          )
        })}

        <text x="30" y="12" className="sideLabel">
          PT RIGHT
        </text>
        <text x="190" y="12" className="sideLabel">
          PT LEFT
        </text>
      </svg>

      <button
        type="button"
        className={[
          'btn',
          'small',
          'backBtn',
          backCount > 0 ? 'hasFindings' : selected === OFF_DIAGRAM_REGION ? 'selected' : 'ghost',
        ].join(' ')}
        onClick={() => onSelect(OFF_DIAGRAM_REGION)}
      >
        Back / Spine
        {backCount > 0 && <em> · {backCount}</em>}
      </button>
    </div>
  )
}
