import { useState } from 'react'
import type { Assessment } from '../model/types'
import { LocationField } from '../ui/LocationField'
import { describeLocation } from '../model/location'

/**
 * Asked once, at the start of a note.
 *
 * Location is the first thing a receiving party wants and the easiest thing to
 * forget once the patient has your attention — and a fix taken at the scene is
 * worth more than one taken later from the trailhead. Skippable, because
 * sometimes the patient cannot wait.
 */
export function NewNoteLocation({
  assessment,
  onDone,
}: {
  assessment: Assessment
  onDone: (assessment: Assessment) => void
}) {
  const [location, setLocation] = useState(assessment.location)
  const has = describeLocation(location).length > 0

  return (
    <main className="screen">
      <header className="apphead">
        <b>New SOAP note</b>
        <button className="headBtn primary" onClick={() => onDone({ ...assessment, location })}>
          {has ? 'Continue' : 'Skip'}
        </button>
      </header>

      <div className="head">
        <h1>Where are you?</h1>
        <p className="sub">
          Take a fix now while you are at the scene. You can add or change this at any time.
        </p>
      </div>

      <LocationField value={location} onChange={setLocation} autoFocusFix />

      <button className="btn wide" onClick={() => onDone({ ...assessment, location })}>
        {has ? 'Start the note' : 'Start without a location'}
      </button>
    </main>
  )
}
