import { useCallback, useEffect, useState } from 'react'
import type { Assessment } from './model/types'
import { newAssessment } from './model/factory'
import * as store from './model/store'
import { HomeScreen } from './screens/Home'
import { AssessmentScreen } from './screens/Assessment'
import { MonitorsScreen } from './screens/Monitors'
import { useMonitorSession } from './ble/useMonitorSession'
import { VerbalReportScreen } from './screens/VerbalReport'
import { NewNoteLocation } from './screens/NewNoteLocation'
import { BackupScreen } from './screens/Backup'
import { requestPersistentStorage } from './platform'

type Route =
  | { name: 'home' }
  | { name: 'assessment'; assessment: Assessment }
  | { name: 'monitors'; from: Assessment | null }
  | { name: 'verbal'; assessment: Assessment }
  /** location prompt shown once, when a note is started */
  | { name: 'newLocation'; assessment: Assessment }
  | { name: 'backup' }

/** Remembers the attending provider so it does not need retyping each callout. */
const PROVIDER_KEY = 'simplesoap.attendingProvider'

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [error, setError] = useState<string | null>(null)
  const live = useMonitorSession()

  const goHome = useCallback(() => setRoute({ name: 'home' }), [])

  // ask once, early — a browser is far more likely to grant this before it has
  // decided the site is idle
  useEffect(() => {
    requestPersistentStorage()
  }, [])

  const openAssessment = useCallback(async (id: string) => {
    try {
      const assessment = await store.load(id)
      if (!assessment) {
        setError('That note could not be found.')
        return
      }
      setRoute({ name: 'assessment', assessment })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const startNew = useCallback(async () => {
    try {
      const provider = localStorage.getItem(PROVIDER_KEY) ?? ''
      const assessment = newAssessment(provider)
      await store.save(assessment)
      // where you are is the first thing dispatch asks and the easiest thing
      // to forget once the patient has your attention
      setRoute({ name: 'newLocation', assessment })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  /**
   * Leaving the monitor returns to wherever you came from, and re-reads the
   * note so samples recorded while you were away are visible.
   */
  const leaveMonitor = useCallback(
    async (from: Assessment | null) => {
      if (!from) {
        goHome()
        return
      }
      const fresh = await store.load(from.id)
      setRoute(fresh ? { name: 'assessment', assessment: fresh } : { name: 'home' })
    },
    [goHome],
  )

  // carry the provider name forward to the next note
  useEffect(() => {
    if (route.name !== 'assessment') return
    const name = route.assessment.attendingProvider.trim()
    if (name) localStorage.setItem(PROVIDER_KEY, name)
  }, [route])

  if (error) {
    return (
      <main className="screen">
        <div className="alert">{error}</div>
        <button className="btn" onClick={() => { setError(null); goHome() }}>
          Back to notes
        </button>
      </main>
    )
  }

  /**
   * A connected monitor is reachable from anywhere. Without this the only way
   * back to a live connection would be to remember which note started it.
   *
   * The bar also has to say whether the monitor is recording, and where. A
   * connection that streams to nothing looks exactly like one filing samples,
   * and a responder who reads it the wrong way loses the whole trend they
   * believed they were building. Anything other than "recording into the note
   * in front of me" is called out rather than left to be inferred.
   */
  const openNoteId = route.name === 'assessment' ? route.assessment.id : null
  const orphaned = live.assessmentId === null
  const elsewhere = !orphaned && openNoteId !== null && live.assessmentId !== openNoteId

  const banner =
    live.connection && route.name !== 'monitors' ? (
      <button
        className={`liveBar${orphaned || elsewhere ? ' liveWarn' : ''}`}
        onClick={() =>
          setRoute({
            name: 'monitors',
            from: route.name === 'assessment' ? route.assessment : null,
          })
        }
      >
        <span className="liveDot" aria-hidden="true" />
        <span className="liveText">
          {live.connection.adapter.name}
          {orphaned ? (
            <> connected · <b>not recording</b></>
          ) : elsewhere ? (
            <> · <b>recording to {live.assessmentLabel}</b>, not this note</>
          ) : (
            <> · recording{live.assessmentLabel ? ` to ${live.assessmentLabel}` : ''}</>
          )}
          {live.latest?.heartRate !== null && live.latest?.heartRate !== undefined && (
            <b> · {live.latest.heartRate} bpm</b>
          )}
          {live.latest?.spo2 !== null && live.latest?.spo2 !== undefined && (
            <b> · {live.latest.spo2}%</b>
          )}
        </span>
        <span className="liveGo" aria-hidden="true">
          ›
        </span>
      </button>
    ) : null

  switch (route.name) {
    case 'assessment':
      return (
        <>
          {banner}
          <AssessmentScreen
            key={route.assessment.id}
            initial={route.assessment}
            onClose={goHome}
            onDeleted={goHome}
            onOpenMonitor={(assessment) => setRoute({ name: 'monitors', from: assessment })}
            onVerbalReport={(assessment) => setRoute({ name: 'verbal', assessment })}
          />
        </>
      )
    case 'newLocation':
      return (
        <NewNoteLocation
          assessment={route.assessment}
          onDone={async (assessment) => {
            await store.saveNoteFields(assessment)
            setRoute({ name: 'assessment', assessment })
          }}
        />
      )
    case 'backup':
      return <BackupScreen onBack={goHome} />
    case 'verbal':
      return (
        <VerbalReportScreen
          assessment={route.assessment}
          onBack={() => setRoute({ name: 'assessment', assessment: route.assessment })}
        />
      )
    case 'monitors':
      return (
        <MonitorsScreen
          onBack={() => leaveMonitor(route.from)}
          assessmentId={route.from?.id}
          assessmentLabel={
            route.from ? route.from.patient.name.trim() || 'this note' : undefined
          }
        />
      )
    default:
      return (
        <>
          {banner}
          <HomeScreen
            onOpen={openAssessment}
            onNew={startNew}
            onMonitors={() => setRoute({ name: 'monitors', from: null })}
            onBackup={() => setRoute({ name: 'backup' })}
          />
        </>
      )
  }
}
