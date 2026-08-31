import { useCallback, useEffect, useState } from 'react'
import type { AssessmentSummary } from '../model/types'
import * as store from '../model/store'
import { Mark, Wordmark } from '../ui/Logo'
import { whenText } from '../format/time'

const when = whenText

export function HomeScreen({
  onOpen,
  onNew,
  onMonitors,
  onBackup,
}: {
  onOpen: (id: string) => void
  onNew: () => void
  onMonitors: () => void
  onBackup: () => void
}) {
  const [notes, setNotes] = useState<AssessmentSummary[] | null>(null)

  const refresh = useCallback(() => {
    store
      .list()
      .then(setNotes)
      .catch(() => setNotes([]))
  }, [])

  useEffect(refresh, [refresh])

  const active = notes?.filter((n) => !n.finalized) ?? []
  const closed = notes?.filter((n) => n.finalized) ?? []

  return (
    <main className="screen">
      <header className="apphead">
        <Wordmark />
        <span className="homeActions">
          <button className="link" onClick={onMonitors}>
            Monitors
          </button>
          <button className="link" onClick={onBackup}>
            Backup
          </button>
        </span>
      </header>

      <button className="btn big" onClick={onNew}>
        Start new SOAP note
      </button>

      {notes === null && <p className="empty">Loading…</p>}
      {notes !== null && notes.length === 0 && (
        <div className="blank">
          <Mark size={72} className="blankMark" />
          <p className="blankTitle">No notes yet</p>
          <p className="empty">Start one when you take over patient care.</p>
        </div>
      )}

      {active.length > 0 && (
        <section className="group">
          <h2 className="groupHead">Open</h2>
          <NoteList notes={active} onOpen={onOpen} />
        </section>
      )}

      {closed.length > 0 && (
        <section className="group">
          <h2 className="groupHead">Finalized</h2>
          <NoteList notes={closed} onOpen={onOpen} />
        </section>
      )}
    </main>
  )
}

function NoteList({
  notes,
  onOpen,
}: {
  notes: AssessmentSummary[]
  onOpen: (id: string) => void
}) {
  return (
    <ul className="list">
      {notes.map((n) => (
        <li key={n.id} className="dev">
          <button className="noteRow" onClick={() => onOpen(n.id)}>
            <div className="devMain">
              <div className="devName">{n.patientName}</div>
              <div className="devMeta">
                <span>{when(n.startedAt)}</span>
                {n.vitalCount > 0 && <span>{n.vitalCount} vitals</span>}
                {n.practice && <span className="tag small">Practice</span>}
              </div>
              {n.complaint && <div className="badge unknown">{n.complaint.slice(0, 70)}</div>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
