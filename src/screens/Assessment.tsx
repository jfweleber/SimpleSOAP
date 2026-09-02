import { useCallback, useEffect, useRef, useState } from 'react'
import type { Assessment, BodyRegion, VitalSet } from '../model/types'
import type { Measurement } from '../ble/types'
import {
  BODY_REGIONS,
  BREATH_QUALITY,
  DOSE_UNITS,
  EVAC_MODE,
  EVAC_PRIORITY,
  ROUTES,
  SEX,
  WEIGHT_UNITS,
  spinalVerdict,
  PALPABLE_PULSE,
  PULSE_QUALITY,
  PUPILS,
  RESPONSIVENESS,
  RHYTHM,
  SKIN_COLOR,
  SKIN_MOISTURE,
  SKIN_TEMP,
} from '../model/types'
import {
  isBlankVitalSet,
  newComplaint,
  newFinding,
  newMedication,
  newTreatment,
  newVitalSet,
} from '../model/factory'
import * as store from '../model/store'
import { exportReport } from '../report/pdf'
import { Area, Choice, Field, NumberField, Row, Section, TimeField, Toggle, TriChoice } from '../ui/fields'
import { useMonitorSession } from '../ble/useMonitorSession'
import * as session from '../ble/monitorSession'
import { LocationField } from '../ui/LocationField'
import { locationSummary } from '../model/location'
import { hhmm } from '../format/time'
import { BodyDiagram } from '../ui/BodyDiagram'

const AUTOSAVE_MS = 600

const clock = hhmm

export function AssessmentScreen({
  initial,
  onClose,
  onDeleted,
  onOpenMonitor,
  onVerbalReport,
}: {
  initial: Assessment
  onClose: () => void
  onDeleted: () => void
  onOpenMonitor: (assessment: Assessment) => void
  onVerbalReport: (assessment: Assessment) => void
}) {
  const [a, setA] = useState<Assessment>(initial)
  // opens in documentation order: location is already done, so patient is next
  const [open, setOpen] = useState<string | null>('patient')
  const [editingVital, setEditingVital] = useState<VitalSet | null>(null)
  const [showBody, setShowBody] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const live = useMonitorSession()
  const [saved, setSaved] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const locked = a.finalizedAt !== null
  const timer = useRef<number | null>(null)

  // autosave — a patient record should never depend on the user pressing save
  useEffect(() => {
    setSaved(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // never write telemetry from here — the monitor owns it
      store
        .saveNoteFields(a)
        .then(() => setSaved(true))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    }, AUTOSAVE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [a])

  // flush pending edits on the way out
  const close = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    await store.saveNoteFields(a).catch(() => {})
    onClose()
  }, [a, onClose])

  const patch = useCallback((changes: Partial<Assessment>) => {
    setA((prev) => ({ ...prev, ...changes }))
  }, [])

  /**
   * Pull in samples the monitor recorded behind our back.
   *
   * Only the telemetry is taken. Replacing the whole record would throw away
   * whatever is half-typed on screen, since the monitor writes straight to
   * storage while the responder is still editing.
   */
  const reload = useCallback(async () => {
    const fresh = await store.load(a.id)
    if (fresh) setA((prev) => ({ ...prev, telemetry: fresh.telemetry }))
  }, [a.id])

  /*
   * A monitor connected before this note was started would otherwise stream to
   * nothing, and nothing on screen would say so. Adopt an unattached one as
   * soon as the note is open. A finalized note is read-only, so it takes no
   * new samples, and a monitor already recording elsewhere is left alone.
   */
  useEffect(() => {
    if (locked) return
    session.adoptIfUnattached(a.id, a.patient.name.trim() || 'this note')
  }, [locked, live.connection, live.assessmentId, a.id, a.patient.name])

  // keep the sample count honest while a monitor is recording into this note
  useEffect(() => {
    if (live.assessmentId !== a.id) return
    const id = setInterval(reload, 10_000)
    return () => clearInterval(id)
  }, [live.assessmentId, a.id, reload])

  const toggle = (key: string) => setOpen((cur) => (cur === key ? null : key))

  const saveVital = useCallback(
    (v: VitalSet) => {
      setA((prev) => {
        const exists = prev.vitals.some((x) => x.id === v.id)
        const vitals = exists
          ? prev.vitals.map((x) => (x.id === v.id ? v : x))
          : [...prev.vitals, v]
        return { ...prev, vitals: vitals.sort((x, y) => x.takenAt - y.takenAt) }
      })
      setEditingVital(null)
    },
    [],
  )

  const doExport = useCallback(
    async (includeTelemetry: boolean) => {
      setExporting(false)
      setMenuOpen(false)
      try {
        await store.saveNoteFields(a)
        // export whatever is actually stored, samples included
        const fresh = (await store.load(a.id)) ?? a
        await exportReport(fresh, { includeTelemetry })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [a],
  )

  /** Skip the options sheet when there is nothing optional to decide. */
  const beginExport = useCallback(() => {
    setMenuOpen(false)
    if (a.telemetry.length === 0) {
      doExport(false)
      return
    }
    setExporting(true)
  }, [a.telemetry.length, doExport])

  const doFinalize = useCallback(() => {
    setMenuOpen(false)
    const now = Date.now()
    patch({ finalizedAt: now, handoffAt: a.handoffAt ?? now })
  }, [a.handoffAt, patch])

  const doDelete = useCallback(async () => {
    setMenuOpen(false)
    if (!window.confirm('Permanently delete this assessment? This cannot be undone.')) return
    await store.remove(a.id)
    onDeleted()
  }, [a.id, onDeleted])

  const verdict = spinalVerdict(a.spinal)
  const realFindings = a.findings.filter((f) => f.description.trim()).length
  const problemCount = a.problems.split('\n').filter((l) => l.trim()).length
  // anatomical order, matching the survey and the printed report
  const orderedFindings = BODY_REGIONS.flatMap((region) =>
    a.findings.filter((f) => f.region === region && f.description.trim()),
  )
  const findingCounts = a.findings.reduce<Partial<Record<BodyRegion, number>>>((acc, f) => {
    if (f.description.trim()) acc[f.region] = (acc[f.region] ?? 0) + 1
    return acc
  }, {})

  if (showBody) {
    return (
      <HeadToToe
        assessment={a}
        locked={locked}
        counts={findingCounts}
        onChange={patch}
        onBack={() => setShowBody(false)}
      />
    )
  }

  return (
    <main className="screen">
      <header className="apphead">
        <button className="headBtn" onClick={close}>
          ‹ All notes
        </button>
        <div className="saveState">{saved ? 'Saved' : 'Saving…'}</div>
        <button
          className={`headBtn${menuOpen ? ' open' : ''}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          Menu
        </button>
      </header>

      {menuOpen && (
        <div className="menu">
          <button onClick={beginExport}>Export / print PDF</button>
          <button
            onClick={() => {
              setMenuOpen(false)
              onVerbalReport(a)
            }}
          >
            Verbal SOAP report
          </button>
          <button
            onClick={() => {
              setMenuOpen(false)
              onOpenMonitor(a)
            }}
          >
            Connect a monitor
          </button>
          {!locked && <button onClick={doFinalize}>Finalize note</button>}
          {locked && (
            <button onClick={() => { setMenuOpen(false); patch({ finalizedAt: null }) }}>
              Reopen note
            </button>
          )}
          <button className="danger" onClick={doDelete}>
            Delete permanently
          </button>
        </div>
      )}

      {error && <div className="alert">{error}</div>}

      <div className="ptHead">
        <h1>{a.patient.name.trim() || 'Name unknown'}</h1>
        <div className="ptMeta">
          Started {clock(a.startedAt)}
          {a.handoffAt && ` · Handoff ${clock(a.handoffAt)}`}
        </div>
        <div className="tags">
          {a.practice && <span className="tag">Practice</span>}
          {locked && <span className="tag lock">Finalized — read only</span>}
          {a.careRefusedAt && <span className="tag">Care refused</span>}
        </div>
      </div>

      <Section
        title="Location"
        summary={locationSummary(a.location).slice(0, 40)}
        open={open === 'location'}
        onToggle={() => toggle('location')}
      >
        <LocationField
          value={a.location}
          disabled={locked}
          onChange={(location) => patch({ location })}
        />
      </Section>

      <Section
        title="Patient"
        summary={[a.patient.age, a.patient.sex].filter(Boolean).join(', ')}
        open={open === 'patient'}
        onToggle={() => toggle('patient')}
      >
        <Field
          label="Name"
          value={a.patient.name}
          disabled={locked}
          onChange={(v) => patch({ patient: { ...a.patient, name: v } })}
        />
        <Row>
          <Field
            label="Age"
            value={a.patient.age}
            disabled={locked}
            inputMode="numeric"
            onChange={(v) => patch({ patient: { ...a.patient, age: v } })}
          />
          <Field
            label="Weight"
            value={a.patient.weight}
            disabled={locked}
            inputMode="numeric"
            onChange={(v) =>
              // strip anything non-numeric so the keypad stays a keypad
              patch({ patient: { ...a.patient, weight: v.replace(/[^0-9.]/g, '') } })
            }
          />
        </Row>
        <Row>
          <Choice
            label="Sex"
            options={SEX}
            value={a.patient.sex}
            disabled={locked}
            onChange={(v) => patch({ patient: { ...a.patient, sex: v } })}
          />
          <Choice
            label="Weight unit"
            options={WEIGHT_UNITS}
            value={a.patient.weightUnit}
            disabled={locked}
            onChange={(v) =>
              patch({ patient: { ...a.patient, weightUnit: v ?? a.patient.weightUnit } })
            }
          />
        </Row>
        <Field
          label="Emergency contact"
          value={a.patient.emergencyContact}
          hint="Name and phone number"
          disabled={locked}
          onChange={(v) => patch({ patient: { ...a.patient, emergencyContact: v } })}
        />
        <Field
          label="Attending provider"
          value={a.attendingProvider}
          disabled={locked}
          onChange={(v) => patch({ attendingProvider: v })}
        />
      </Section>

      <Section
        title="Chief complaint"
        summary={a.chiefComplaint.summary.slice(0, 40)}
        open={open === 'complaint'}
        onToggle={() => toggle('complaint')}
      >
        <Area
          label="Patient's main issue"
          hint="What is wrong"
          value={a.chiefComplaint.summary}
          disabled={locked}
          placeholder="In the patient's own words where possible"
          onChange={(v) => patch({ chiefComplaint: { ...a.chiefComplaint, summary: v } })}
        />
        <Choice
          label="Nature"
          options={['injury', 'illness'] as const}
          value={a.chiefComplaint.nature}
          disabled={locked}
          onChange={(v) => patch({ chiefComplaint: { ...a.chiefComplaint, nature: v } })}
        />
        <TimeField
          label="Incident time"
          value={a.chiefComplaint.incidentAt}
          disabled={locked}
          onChange={(v) => patch({ chiefComplaint: { ...a.chiefComplaint, incidentAt: v } })}
        />
        <Area
          label="Mechanism"
          hint="How it happened"
          value={a.chiefComplaint.mechanism}
          rows={2}
          disabled={locked}
          placeholder="Forces involved, or how the illness came on"
          onChange={(v) => patch({ chiefComplaint: { ...a.chiefComplaint, mechanism: v } })}
        />
      </Section>

      <Section
        title="Complaint detail (OPQRST)"
        summary={a.complaints.length ? `${a.complaints.length}` : ''}
        open={open === 'opqrst'}
        onToggle={() => toggle('opqrst')}
      >
        {a.complaints.map((c) => (
          <div key={c.id} className="sub">
            <Field
              label="Complaint"
              value={c.what}
              disabled={locked}
              onChange={(v) =>
                patch({ complaints: a.complaints.map((x) => (x.id === c.id ? { ...x, what: v } : x)) })
              }
            />
            <Field label="Onset" value={c.onset} disabled={locked}
              onChange={(v) => patch({ complaints: a.complaints.map((x) => x.id === c.id ? { ...x, onset: v } : x) })} />
            <Row>
              <Field label="Provokes" hint="Makes it worse" value={c.provocation} disabled={locked}
                onChange={(v) => patch({ complaints: a.complaints.map((x) => x.id === c.id ? { ...x, provocation: v } : x) })} />
              <Field label="Palliates" hint="Makes it better" value={c.palliation} disabled={locked}
                onChange={(v) => patch({ complaints: a.complaints.map((x) => x.id === c.id ? { ...x, palliation: v } : x) })} />
            </Row>
            <Row>
              <Field label="Quality" value={c.quality} disabled={locked}
                onChange={(v) => patch({ complaints: a.complaints.map((x) => x.id === c.id ? { ...x, quality: v } : x) })} />
              <Field label="Radiation" value={c.radiation} disabled={locked}
                onChange={(v) => patch({ complaints: a.complaints.map((x) => x.id === c.id ? { ...x, radiation: v } : x) })} />
            </Row>
            <Row>
              <NumberField label="Severity" unit="/10" min={0} max={10} value={c.severity} disabled={locked}
                onChange={(v) => patch({ complaints: a.complaints.map((x) => x.id === c.id ? { ...x, severity: v } : x) })} />
              <Field label="Time / duration" value={c.time} disabled={locked}
                onChange={(v) => patch({ complaints: a.complaints.map((x) => x.id === c.id ? { ...x, time: v } : x) })} />
            </Row>
            {!locked && (
              <button className="link danger"
                onClick={() => patch({ complaints: a.complaints.filter((x) => x.id !== c.id) })}>
                Remove
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <button
            className="btn small ghost"
            onClick={() =>
              patch({
                complaints: [
                  ...a.complaints,
                  // seed only the first from the chief complaint
                  newComplaint(
                    a.complaints.length === 0 ? a.chiefComplaint.summary.trim() : '',
                  ),
                ],
              })
            }
          >
            {a.complaints.length === 0 && a.chiefComplaint.summary.trim()
              ? '+ Add complaint (from chief complaint)'
              : '+ Add complaint'}
          </button>
        )}
      </Section>

      <Section
        title="History (SAMPLE)"
        open={open === 'sample'}
        onToggle={() => toggle('sample')}
      >
        <Area label="Symptoms" rows={2} value={a.sample.symptoms} disabled={locked}
          onChange={(v) => patch({ sample: { ...a.sample, symptoms: v } })} />
        {!locked &&
          a.chiefComplaint.summary.trim() &&
          !a.sample.symptoms.includes(a.chiefComplaint.summary.trim()) && (
            <button
              className="link"
              onClick={() => {
                const complaint = a.chiefComplaint.summary.trim()
                // append rather than replace — symptoms already written are
                // observations, and the chief complaint is only one of them
                const symptoms = a.sample.symptoms.trim()
                patch({
                  sample: {
                    ...a.sample,
                    symptoms: symptoms ? `${symptoms}
${complaint}` : complaint,
                  },
                })
              }}
            >
              + Copy from chief complaint
            </button>
          )}
        <Area label="Allergies" rows={2} value={a.sample.allergies} disabled={locked}
          onChange={(v) => patch({ sample: { ...a.sample, allergies: v } })} />
        {!locked && !a.sample.allergies.trim() && (
          <button
            className="link"
            onClick={() => patch({ sample: { ...a.sample, allergies: 'No known allergies' } })}
          >
            + No known allergies
          </button>
        )}

        <Area label="Medications" rows={2} value={a.sample.medications} disabled={locked}
          onChange={(v) => patch({ sample: { ...a.sample, medications: v } })} />
        {!locked && !a.sample.medications.trim() && (
          <button
            className="link"
            onClick={() => patch({ sample: { ...a.sample, medications: 'No medications' } })}
          >
            + No medications
          </button>
        )}

        <Area label="Past history" rows={2} value={a.sample.pastHistory} disabled={locked}
          onChange={(v) => patch({ sample: { ...a.sample, pastHistory: v } })} />
        {!locked && !a.sample.pastHistory.trim() && (
          <button
            className="link"
            onClick={() =>
              patch({ sample: { ...a.sample, pastHistory: 'No pertinent past medical history' } })
            }
          >
            + No pertinent past medical history
          </button>
        )}
        <Area label="Last intake / output" rows={2} value={a.sample.lastIntakeOutput} disabled={locked}
          onChange={(v) => patch({ sample: { ...a.sample, lastIntakeOutput: v } })} />
        <Area label="Events leading up" rows={2} value={a.sample.events} disabled={locked}
          onChange={(v) => patch({ sample: { ...a.sample, events: v } })} />
      </Section>

      <Section
        title="Vitals"
        summary={a.vitals.length ? `${a.vitals.length} set${a.vitals.length === 1 ? '' : 's'}` : ''}
        open={open === 'vitals'}
        onToggle={() => toggle('vitals')}
      >
        {a.vitals.length === 0 && <p className="empty">No vitals yet.</p>}
        <ul className="vitalList">
          {a.vitals.map((v) => (
            <li key={v.id}>
              <button className="vitalRow" onClick={() => setEditingVital(v)}>
                <span className="vTime">{clock(v.takenAt)}</span>
                <span className="vSummary">
                  {v.heartRate !== null && <b>{v.heartRate}</b>}
                  {v.heartRate !== null && ' hr'}
                  {v.respiratoryRate !== null && ` · ${v.respiratoryRate} rr`}
                  {v.systolic !== null && ` · ${v.systolic}/${v.bpPalpated ? 'P' : (v.diastolic ?? '—')}`}
                  {v.systolic === null && v.palpablePulse !== null && ` · ${v.palpablePulse}`}
                  {v.spo2 !== null && ` · ${v.spo2}%`}
                  {v.responsiveness && ` · ${v.responsiveness}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!locked && (
          <button className="btn" onClick={() => setEditingVital(newVitalSet())}>
            + Take vitals
          </button>
        )}
      </Section>

      <Section
        title="Head to toe"
        summary={
          realFindings > 0
            ? `${realFindings} finding${realFindings === 1 ? '' : 's'}`
            : a.headToToeClear
              ? 'Survey clear'
              : ''
        }
        open={open === 'h2t'}
        onToggle={() => toggle('h2t')}
      >
        <button className="btn" onClick={() => setShowBody(true)}>
          Open body map
        </button>
        <Toggle
          label="Survey completed, no abnormal findings"
          checked={a.headToToeClear}
          disabled={locked || realFindings > 0}
          onChange={(v) => patch({ headToToeClear: v })}
        />
        {realFindings > 0 && (
          <span className="fieldHint">
            Findings are recorded, so this cannot be marked clear.
          </span>
        )}
      </Section>

      <Section
        title="Spinal assessment"
        summary={a.spinal.mechanism !== null ? verdict.label : ''}
        open={open === 'spinal'}
        onToggle={() => toggle('spinal')}
      >
        <TriChoice
          label="MOI capable of causing spinal injury"
          value={a.spinal.mechanism}
          alarmOn="yes"
          yesLabel="MOI present"
          noLabel="No MOI"
          disabled={locked}
          onChange={(v) => patch({ spinal: { ...a.spinal, mechanism: v } })}
        />

        {a.spinal.mechanism === 'yes' && (
          <>
            <TriChoice
              label="Patient reliable (sober, alert, no distracting injury)"
              value={a.spinal.reliablePatient}
              alarmOn="no"
              disabled={locked}
              onChange={(v) => patch({ spinal: { ...a.spinal, reliablePatient: v } })}
            />
            <TriChoice
              label="Spine tenderness on palpation"
              value={a.spinal.spineTenderness}
              alarmOn="yes"
              disabled={locked}
              onChange={(v) => patch({ spinal: { ...a.spinal, spineTenderness: v } })}
            />
            <TriChoice
              label="Motor or sensory deficit"
              value={a.spinal.neuroDeficit}
              alarmOn="yes"
              disabled={locked}
              onChange={(v) => patch({ spinal: { ...a.spinal, neuroDeficit: v } })}
            />
          </>
        )}

        <div className={`verdict ${verdict.code}`}>{verdict.label}</div>

        <Area label="Notes" rows={2} value={a.spinal.notes} disabled={locked}
          onChange={(v) => patch({ spinal: { ...a.spinal, notes: v } })} />
      </Section>

      <Section
        title="Assessment — problem list"
        summary={problemCount ? `${problemCount} problem${problemCount === 1 ? '' : 's'}` : ''}
        open={open === 'problems'}
        onToggle={() => toggle('problems')}
      >
        <Area
          label="Problems"
          rows={4}
          value={a.problems}
          disabled={locked}
          placeholder={'One per line, e.g.\nProbable distal radius fracture\nMild dehydration'}
          onChange={(v) => patch({ problems: v })}
        />
        <span className="fieldHint">
          What you think is wrong, in your words — not a copy of what you observed. This is what
          gets read out as the problem list; keep general observations in Notes.
        </span>

        {realFindings > 0 && problemCount === 0 && (
          <div className="alert soft">
            {realFindings} finding{realFindings === 1 ? '' : 's'} recorded and no problems listed
            yet.
          </div>
        )}

        {orderedFindings.length > 0 && (
          <div className="fromFindings">
            <span className="fieldLabel">From the head-to-toe survey</span>
            <ul className="findingPicks">
              {orderedFindings.map((f) => {
                const asLine = `${f.region}: ${f.description.trim()}`
                const already = a.problems.includes(f.description.trim())
                return (
                  <li key={f.id}>
                    <span className="pickText">
                      <b>{f.region}</b> {f.description.trim()}
                      {f.treated && <em className="pickTreated"> · treated</em>}
                    </span>
                    {!locked && !already && (
                      <button
                        className="btn small ghost"
                        onClick={() =>
                          patch({
                            problems: a.problems.trim()
                              ? `${a.problems.trim()}\n${asLine}`
                              : asLine,
                          })
                        }
                      >
                        + Add
                      </button>
                    )}
                    {already && <span className="pickAdded">added</span>}
                  </li>
                )
              })}
            </ul>
            <span className="fieldHint">
              Treated does not mean resolved — a splinted fracture is still the problem. Pick what
              belongs on the list and reword it as an assessment.
            </span>
          </div>
        )}
      </Section>

      <Section
        title="Treatments"
        summary={a.treatments.length ? `${a.treatments.length}` : ''}
        open={open === 'treat'}
        onToggle={() => toggle('treat')}
      >
        {a.treatments.map((t) => (
          <div key={t.id} className="sub">
            <TimeField label="Time" value={t.at} disabled={locked}
              onChange={(v) => patch({ treatments: a.treatments.map((x) => x.id === t.id ? { ...x, at: v ?? x.at } : x) })} />
            <Field label="For" value={t.forWhat} disabled={locked}
              onChange={(v) => patch({ treatments: a.treatments.map((x) => x.id === t.id ? { ...x, forWhat: v } : x) })} />
            <Area label="Treatment" rows={2} value={t.what} disabled={locked}
              onChange={(v) => patch({ treatments: a.treatments.map((x) => x.id === t.id ? { ...x, what: v } : x) })} />
            {!locked && (
              <button className="link danger" onClick={() => patch({ treatments: a.treatments.filter((x) => x.id !== t.id) })}>
                Remove
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <button className="btn small ghost" onClick={() => patch({ treatments: [...a.treatments, newTreatment()] })}>
            + Add treatment
          </button>
        )}
      </Section>

      <Section
        title="Medications given"
        summary={a.medications.length ? `${a.medications.length}` : ''}
        open={open === 'meds'}
        onToggle={() => toggle('meds')}
      >
        {a.medications.map((m) => (
          <div key={m.id} className="sub">
            <Field label="Medication" value={m.name} disabled={locked}
              onChange={(v) => patch({ medications: a.medications.map((x) => x.id === m.id ? { ...x, name: v } : x) })} />
            <TimeField label="Time given" value={m.at} disabled={locked}
              onChange={(v) => patch({ medications: a.medications.map((x) => x.id === m.id ? { ...x, at: v ?? x.at } : x) })} />
            <Field label="Dose" value={m.dose} inputMode="numeric" disabled={locked}
              onChange={(v) => patch({ medications: a.medications.map((x) => x.id === m.id ? { ...x, dose: v.replace(/[^0-9.]/g, '') } : x) })} />
            <Choice label="Unit" options={DOSE_UNITS} value={m.doseUnit} disabled={locked}
              onChange={(v) => patch({ medications: a.medications.map((x) => x.id === m.id ? { ...x, doseUnit: v } : x) })} />
            <Choice label="Route" options={ROUTES} value={m.route} disabled={locked}
              onChange={(v) => patch({ medications: a.medications.map((x) => x.id === m.id ? { ...x, route: v } : x) })} />
            {!locked && (
              <button className="link danger" onClick={() => patch({ medications: a.medications.filter((x) => x.id !== m.id) })}>
                Remove
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <button className="btn small ghost" onClick={() => patch({ medications: [...a.medications, newMedication()] })}>
            + Add medication
          </button>
        )}
      </Section>

      <Section
        title="Evacuation plan"
        summary={[a.evacuation.priority, a.evacuation.mode].filter(Boolean).join(' ')}
        open={open === 'evac'}
        onToggle={() => toggle('evac')}
      >
        <Choice
          label="Mode"
          options={EVAC_MODE}
          value={a.evacuation.mode}
          disabled={locked}
          onChange={(v) => patch({ evacuation: { ...a.evacuation, mode: v } })}
        />

        {a.evacuation.mode !== 'none — patient released' && (
          <>
            <Choice
              label="Priority"
              options={EVAC_PRIORITY}
              value={a.evacuation.priority}
              disabled={locked}
              onChange={(v) => patch({ evacuation: { ...a.evacuation, priority: v } })}
            />
            <Field
              label="Destination"
              value={a.evacuation.destination}
              placeholder="Trailhead, road, LZ"
              disabled={locked}
              onChange={(v) => patch({ evacuation: { ...a.evacuation, destination: v } })}
            />
            <Field
              label="Method"
              value={a.evacuation.method}
              placeholder="Litter carry, walk out with escort, short-haul"
              disabled={locked}
              onChange={(v) => patch({ evacuation: { ...a.evacuation, method: v } })}
            />
          </>
        )}

        <Area
          label="Support requested"
          rows={2}
          value={a.evacuation.supportRequested}
          placeholder="Litter team, extra light, warm fluids, ALS at the trailhead"
          disabled={locked}
          onChange={(v) => patch({ evacuation: { ...a.evacuation, supportRequested: v } })}
        />
<Area
          label="Will monitor for"
          rows={2}
          value={a.evacuation.anticipatedProblems}
          placeholder="What you will watch for, and what you will do about it"
          disabled={locked}
          onChange={(v) => patch({ evacuation: { ...a.evacuation, anticipatedProblems: v } })}
        />
        <span className="fieldHint">
          Read out as &ldquo;We will monitor for&hellip;&rdquo; in the verbal report.
        </span>
      </Section>

      <Section title="Notes" open={open === 'notes'} onToggle={() => toggle('notes')}>
        <Area label="Overall notes" rows={6} value={a.notes} disabled={locked}
          onChange={(v) => patch({ notes: v })} />
      </Section>

      <Section
        title="Monitor data"
        summary={
          a.telemetry.length
            ? `${a.telemetry.length} sample${a.telemetry.length === 1 ? '' : 's'}`
            : ''
        }
        open={open === 'stream'}
        onToggle={() => toggle('stream')}
      >
        {a.telemetry.length === 0 ? (
          <p className="empty">
            No monitor samples yet. Connect a heart rate or SpO₂ device and it will record a sample
            every 5 minutes for as long as it stays connected.
          </p>
        ) : (
          <>
            <p className="empty">
              Recorded automatically. These stay separate from the vitals you observe, and are
              included in the PDF only if you ask for them.
            </p>
            <ul className="vitalList">
              {a.telemetry.slice(-8).reverse().map((t) => (
                <li key={t.at}>
                  <div className="vitalRow as-row">
                    <span className="vTime">{clock(t.at)}</span>
                    <span className="vSummary">
                      {t.heartRate !== null && `${t.heartRate} hr`}
                      {t.spo2 !== null && ` · ${t.spo2}%`}
                      {t.perfusionIndex !== null && ` · PI ${t.perfusionIndex.toFixed(1)}`}
                      {t.respiratoryRate !== null && ` · ${t.respiratoryRate} rr`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {!locked && (
              <button
                className="link danger"
                onClick={() => {
                  if (!window.confirm('Discard all recorded monitor samples?')) return
                  store.clearTelemetry(a.id).then(reload)
                }}
              >
                Clear monitor data
              </button>
            )}
          </>
        )}
        {live.connection ? (
          <div className="recBox">
            <div className="recLine">
              <b>{live.connection.adapter.name} connected</b>
              <span className="dim">
                {live.assessmentId === a.id
                  ? `Recording here · ${live.recorded} sample${live.recorded === 1 ? '' : 's'} this session`
                  : 'Not recording into this note yet'}
              </span>
            </div>
            {live.assessmentId === a.id ? (
              <button
                className="btn small"
                disabled={!live.latest}
                onClick={() => {
                  // the write is queued, so re-read once it has landed
                  if (session.captureSample()) setTimeout(reload, 150)
                }}
              >
                Record a sample now
              </button>
            ) : (
              <button
                className="btn small"
                onClick={() => session.attachTo(a.id, a.patient.name.trim() || 'this note')}
              >
                Record into this note
              </button>
            )}
            <button className="link" onClick={() => onOpenMonitor(a)}>
              Open monitor
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => onOpenMonitor(a)}>
            Connect a monitor
          </button>
        )}
      </Section>

      <Section title="Disposition" open={open === 'disp'} onToggle={() => toggle('disp')}>
        <TimeField label="Handoff time" value={a.handoffAt} disabled={locked}
          onChange={(v) => patch({ handoffAt: v })} />
        <Toggle label="Care was refused" checked={a.careRefusedAt !== null} disabled={locked}
          onChange={(v) => patch({ careRefusedAt: v ? Date.now() : null })} />
        <Toggle label="Practice — not a real incident" checked={a.practice} disabled={locked}
          onChange={(v) => patch({ practice: v })} />
      </Section>

      <button className="btn wide" onClick={beginExport}>
        Export / print PDF
      </button>

      <button className="btn wide stop" onClick={() => onVerbalReport(a)}>
        Verbal SOAP report
      </button>

      {exporting && (
        <ExportSheet
          sampleCount={a.telemetry.length}
          onCancel={() => setExporting(false)}
          onExport={doExport}
        />
      )}

      {editingVital && (
        <VitalsEditor
          vital={editingVital}
          locked={locked}
          live={live.connection ? live.latest : null}
          liveDeviceName={live.connection?.adapter.name ?? null}
          liveAdapterId={live.connection?.adapter.id ?? null}
          onSave={saveVital}
          onCancel={() => setEditingVital(null)}
          onDelete={
            a.vitals.some((x) => x.id === editingVital.id)
              ? () => {
                  patch({ vitals: a.vitals.filter((x) => x.id !== editingVital.id) })
                  setEditingVital(null)
                }
              : undefined
          }
        />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------

function VitalsEditor({
  vital,
  locked,
  live,
  liveDeviceName,
  liveAdapterId,
  onSave,
  onCancel,
  onDelete,
}: {
  vital: VitalSet
  locked: boolean
  live: Measurement | null
  liveDeviceName: string | null
  liveAdapterId: string | null
  onSave: (v: VitalSet) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [v, setV] = useState<VitalSet>(vital)
  const set = (changes: Partial<VitalSet>) => setV((prev) => ({ ...prev, ...changes }))

  /**
   * Copy the current monitor reading into this set.
   *
   * It fills the fields rather than saving — the responder still confirms it,
   * and can correct anything the sensor got wrong before it becomes part of
   * the record. The set is stamped as device-sourced so the report can mark it.
   */
  const pullFromMonitor = () => {
    if (!live) return
    set({
      heartRate: live.heartRate ?? v.heartRate,
      spo2: live.spo2 ?? v.spo2,
      respiratoryRate: live.respiratoryRate ?? v.respiratoryRate,
      source: {
        kind: 'device',
        adapterId: liveAdapterId ?? undefined,
        deviceName: liveDeviceName ?? undefined,
      },
    })
  }

  const hasLiveValue =
    live !== null && (live.heartRate !== null || live.spo2 !== null || live.respiratoryRate !== null)

  return (
    <div className="sheet" role="dialog" aria-label="Vitals">
      <div className="sheetInner">
        <header className="sheetHead">
          <button className="headBtn" onClick={onCancel}>
            Cancel
          </button>
          <b>Vitals</b>
          <button
            className="headBtn primary"
            onClick={() => onSave(v)}
            disabled={locked || isBlankVitalSet(v)}
          >
            Done
          </button>
        </header>

        <div className="sheetBody">
          {hasLiveValue && !locked && (
            <div className="recBox">
              <div className="recLine">
                <b>{liveDeviceName} is connected</b>
                <span className="dim">
                  {live?.heartRate !== null && `${live?.heartRate} bpm`}
                  {live?.spo2 !== null && ` · ${live?.spo2}%`}
                  {live?.respiratoryRate !== null && ` · ${live?.respiratoryRate} br/min`}
                </span>
              </div>
              <button className="btn small" onClick={pullFromMonitor}>
                Use this reading
              </button>
            </div>
          )}

          {v.source.kind === 'device' && (
            <p className="fieldHint">
              Taken from {v.source.deviceName ?? 'a connected device'}. Check it before saving —
              the report marks device readings.
            </p>
          )}

          <TimeField label="Time taken" value={v.takenAt} disabled={locked}
            onChange={(t) => set({ takenAt: t ?? v.takenAt })} />

          <Choice label="Level of responsiveness" options={RESPONSIVENESS}
            value={v.responsiveness} disabled={locked}
            onChange={(x) => set({ responsiveness: x })} />

          <NumberField label="Heart rate" unit="bpm" min={20} max={250}
            value={v.heartRate} disabled={locked} onChange={(x) => set({ heartRate: x })} />
          <Choice label="Pulse rhythm" options={RHYTHM} value={v.pulseRhythm} disabled={locked}
            onChange={(x) => set({ pulseRhythm: x })} />
          <Choice label="Pulse quality" options={PULSE_QUALITY} value={v.pulseQuality} disabled={locked}
            onChange={(x) => set({ pulseQuality: x })} />

          <NumberField label="Respiratory rate" unit="br/min" min={4} max={60}
            value={v.respiratoryRate} disabled={locked}
            onChange={(x) => set({ respiratoryRate: x })} />
          <Choice label="Breathing" options={BREATH_QUALITY} value={v.breathQuality} disabled={locked}
            onChange={(x) => set({ breathQuality: x })} />

          <Row>
            <NumberField label="BP systolic" min={40} max={260} value={v.systolic} disabled={locked}
              onChange={(x) => set({ systolic: x })} />
            <NumberField label="BP diastolic" min={20} max={180} value={v.diastolic}
              disabled={locked || v.bpPalpated} onChange={(x) => set({ diastolic: x })} />
          </Row>
          <Toggle label="Taken by palpation (no diastolic)" checked={v.bpPalpated} disabled={locked}
            onChange={(x) => set({ bpPalpated: x, diastolic: x ? null : v.diastolic })} />

          <Choice label="Palpable pulse (no cuff)" options={PALPABLE_PULSE}
            value={v.palpablePulse} disabled={locked}
            onChange={(x) => set({ palpablePulse: x })} />
          <p className="fieldHint">
            The most distal pulse you could feel. It is a rough floor on systolic pressure, not a
            blood pressure — the report prints it as what it is.
          </p>

          <Row>
            <NumberField label="SpO₂" unit="%" min={50} max={100} value={v.spo2} disabled={locked}
              onChange={(x) => set({ spo2: x })} />
            <NumberField label="Temperature" unit="°F" min={77} max={110} value={v.temperatureF}
              disabled={locked} onChange={(x) => set({ temperatureF: x })} />
          </Row>

          <Choice label="Skin colour" options={SKIN_COLOR} value={v.skinColor} disabled={locked}
            onChange={(x) => set({ skinColor: x })} />
          <Choice label="Skin temperature" options={SKIN_TEMP} value={v.skinTemp} disabled={locked}
            onChange={(x) => set({ skinTemp: x })} />
          <Choice label="Skin moisture" options={SKIN_MOISTURE} value={v.skinMoisture} disabled={locked}
            onChange={(x) => set({ skinMoisture: x })} />
          <Choice label="Pupils" options={PUPILS} value={v.pupils} disabled={locked}
            onChange={(x) => set({ pupils: x })} />

          <Area label="Notes" rows={2} value={v.notes} disabled={locked}
            onChange={(x) => set({ notes: x })} />

          {onDelete && !locked && (
            <button className="link danger" onClick={onDelete}>
              Delete this set
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function HeadToToe({
  assessment,
  locked,
  counts,
  onChange,
  onBack,
}: {
  assessment: Assessment
  locked: boolean
  counts: Partial<Record<BodyRegion, number>>
  onChange: (changes: Partial<Assessment>) => void
  onBack: () => void
}) {
  const [region, setRegion] = useState<BodyRegion | null>(null)
  const forRegion = region ? assessment.findings.filter((f) => f.region === region) : []
  const totalFindings = assessment.findings.filter((f) => f.description.trim()).length

  return (
    <main className="screen">
      <header className="apphead">
        <button className="headBtn" onClick={onBack}>
          ‹ Back
        </button>
        <b>Head to toe</b>
        <span />
      </header>

      <BodyDiagram counts={counts} selected={region} onSelect={setRegion} />

      {assessment.headToToeClear && totalFindings === 0 && (
        <div className="clearBanner">Survey completed — no abnormal findings.</div>
      )}

      {totalFindings === 0 && !locked && (
        <button
          className={assessment.headToToeClear ? 'btn small' : 'btn small ghost'}
          onClick={() => onChange({ headToToeClear: !assessment.headToToeClear })}
        >
          {assessment.headToToeClear ? 'Clear this confirmation' : 'Mark survey clear — no findings'}
        </button>
      )}

      {!region && <p className="empty">Tap a region to record what you find.</p>}

      {region && (
        <section className="group">
          <h2 className="groupHead">{region}</h2>
          {forRegion.map((f) => (
            <div key={f.id} className="sub">
              <Area
                label="Finding"
                rows={2}
                value={f.description}
                disabled={locked}
                placeholder="Deformity, contusion, abrasion, tenderness…"
                onChange={(v) =>
                  onChange({
                    findings: assessment.findings.map((x) =>
                      x.id === f.id ? { ...x, description: v } : x,
                    ),
                  })
                }
              />
              <Toggle
                label="Treated"
                checked={f.treated}
                disabled={locked}
                onChange={(v) =>
                  onChange({
                    findings: assessment.findings.map((x) =>
                      x.id === f.id ? { ...x, treated: v } : x,
                    ),
                  })
                }
              />
              {!locked && (
                <button
                  className="link danger"
                  onClick={() =>
                    onChange({ findings: assessment.findings.filter((x) => x.id !== f.id) })
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {!locked && (
            <button
              className="btn small ghost"
              onClick={() =>
                onChange({
                  findings: [...assessment.findings, newFinding(region)],
                  // a finding and a clear survey cannot both be true
                  headToToeClear: false,
                })
              }
            >
              + Add finding in {region}
            </button>
          )}
        </section>
      )}

      <details className="support">
        <summary>All regions</summary>
        <ul className="regionList">
          {BODY_REGIONS.map((r) => (
            <li key={r}>
              <button className="link" onClick={() => setRegion(r)}>
                {r}
              </button>
              {(counts[r] ?? 0) > 0 && <span className="dim"> · {counts[r]}</span>}
            </li>
          ))}
        </ul>
      </details>
    </main>
  )
}

// ---------------------------------------------------------------------------

function ExportSheet({
  sampleCount,
  onCancel,
  onExport,
}: {
  sampleCount: number
  onCancel: () => void
  onExport: (includeTelemetry: boolean) => void
}) {
  const [include, setInclude] = useState(false)
  return (
    <div className="sheet" role="dialog" aria-label="Export options">
      <div className="sheetInner">
        <header className="sheetHead">
          <button className="headBtn" onClick={onCancel}>
            Cancel
          </button>
          <b>Export PDF</b>
          <button className="headBtn primary" onClick={() => onExport(include)}>
            Export
          </button>
        </header>
        <div className="sheetBody">
          <Toggle
            label={`Include streamed biometrics (${sampleCount} sample${sampleCount === 1 ? '' : 's'})`}
            checked={include}
            onChange={setInclude}
          />
          <p className="empty">
            Adds an appendix after the signature listing every reading captured from a connected
            monitor. Useful for a trend, but it is device data rather than observed vitals — leave
            it off for a routine handoff.
          </p>
        </div>
      </div>
    </div>
  )
}
