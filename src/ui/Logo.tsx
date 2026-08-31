/**
 * The Waypoint mark — a map pin carrying a pulse trace.
 *
 * Kept as inline SVG rather than an image so it inherits colour, stays crisp
 * at any size, and costs nothing to load. The geometry is identical to the app
 * icon, so the launcher and the app agree on what this thing looks like.
 */

const PIN =
  'M54 16 c-16 0 -28 12 -28 27 c0 19 22 38 28 49 c6 -11 28 -30 28 -49 c0 -15 -12 -27 -28 -27 Z'
const TRACE = 'M39 43 H47 L50 35 L55 53 L59 43 H69'

export function Mark({
  size = 28,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="8 10 92 88"
      role="img"
      aria-label="SimpleSOAP"
    >
      <path d={PIN} fill="currentColor" />
      {/* the trace is cut out of the pin, so one colour draws the whole mark */}
      <path
        d={TRACE}
        fill="none"
        stroke="var(--bg, #0c1116)"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Mark plus name, for the home header. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={26} className="wordmarkIcon" />
      <span className="wordmarkText">
        Simple<b>SOAP</b>
      </span>
    </span>
  )
}
