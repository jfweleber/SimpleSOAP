/**
 * Persistence for assessments.
 *
 * IndexedDB, wrapped thin. Records are whole documents keyed by id, which
 * mirrors how they are used: always read and written entire. The repository
 * surface is deliberately small so it can be swapped for SQLite later without
 * touching any calling code.
 *
 * Durability note: this is a patient record. Every mutation is written through
 * immediately rather than batched, and reads never come from a cache.
 */

import type { Assessment, AssessmentSummary, Id, MedicationGiven, Tri } from './types'
import { DOSE_UNITS, EVAC_MODE, EVAC_PRIORITY, ROUTES, summarize } from './types'
import { celsiusToFahrenheit } from '../format/time'

/**
 * Bring a stored record up to the current shape.
 *
 * Field types have changed since the first builds — sex became a domain,
 * weight split from its unit, and the spinal criteria became three-state so a
 * confirmed negative is distinguishable from an unanswered question. An old
 * `false` meant "unchecked", which is exactly the ambiguity the change removes,
 * so it migrates to null rather than to 'no'.
 */
/**
 * Pull the old single `urgency` string apart into mode and priority.
 *
 * `startLocation` is dropped rather than carried: the Location section records
 * where the incident is with a GPS fix, and two places to write the same thing
 * is how they end up disagreeing.
 */
function migrateEvacuation(raw: unknown): Assessment['evacuation'] {
  const e = (raw ?? {}) as Record<string, unknown>
  const legacy = typeof e.urgency === 'string' ? e.urgency : ''

  const mode: Assessment['evacuation']['mode'] =
    (EVAC_MODE as readonly string[]).includes(e.mode as string)
      ? (e.mode as Assessment['evacuation']['mode'])
      : legacy.startsWith('air')
        ? 'air'
        : legacy.startsWith('ground')
          ? 'ground'
          : legacy.startsWith('none')
            ? 'none — patient released'
            : null

  const priority: Assessment['evacuation']['priority'] =
    (EVAC_PRIORITY as readonly string[]).includes(e.priority as string)
      ? (e.priority as Assessment['evacuation']['priority'])
      : legacy.includes('non-urgent')
        ? 'non-urgent'
        : legacy.includes('urgent')
          ? 'urgent'
          : null

  return {
    mode,
    priority,
    destination: typeof e.destination === 'string' ? e.destination : '',
    // the old free-text `plan` was in practice the method
    method: typeof e.method === 'string' ? e.method : typeof e.plan === 'string' ? e.plan : '',
    supportRequested: typeof e.supportRequested === 'string' ? e.supportRequested : '',
    anticipatedProblems: typeof e.anticipatedProblems === 'string' ? e.anticipatedProblems : '',
  }
}

/**
 * Bring one vital set up to date.
 *
 * Temperature moved from Celsius to Fahrenheit, so a stored number has to be
 * converted rather than reinterpreted — 37 read as Fahrenheit would be a
 * severely hypothermic patient. 'clammy' folds into 'moist'; the cool half of
 * what it meant is already recorded in skin temperature.
 */
function migrateVitalSet(v: Assessment['vitals'][number]): Assessment['vitals'][number] {
  const raw = v as unknown as Record<string, unknown>
  const celsius = raw.temperatureC
  return {
    ...v,
    temperatureF:
      typeof raw.temperatureF === 'number'
        ? raw.temperatureF
        : typeof celsius === 'number'
          ? celsiusToFahrenheit(celsius)
          : null,
    skinMoisture:
      raw.skinMoisture === 'clammy'
        ? 'moist'
        : raw.skinMoisture === 'diaphoretic'
          ? 'sweaty'
          : (raw.skinMoisture as Assessment['vitals'][number]['skinMoisture']) ?? null,
    // 'easy' was renamed, not redefined
    breathQuality:
      raw.breathQuality === 'easy'
        ? 'normal'
        : (raw.breathQuality as Assessment['vitals'][number]['breathQuality']) ?? null,
    palpablePulse:
      (raw.palpablePulse as Assessment['vitals'][number]['palpablePulse']) ?? null,
  }
}

function migrate(record: Assessment): Assessment {
  const raw = record as unknown as Record<string, unknown>
  const patient = (raw.patient ?? {}) as Record<string, unknown>
  const spinal = (raw.spinal ?? {}) as Record<string, unknown>

  const tri = (value: unknown): Tri => {
    if (value === 'yes' || value === 'no') return value
    // a legacy boolean carried no "assessed" signal, so treat it as unanswered
    return null
  }

  const sex = patient.sex
  const weight = typeof patient.weight === 'string' ? patient.weight : ''

  return {
    ...record,
    attendingProvider:
      (raw.attendingProvider as string | undefined) ?? (raw.responderName as string) ?? '',
    patient: {
      name: (patient.name as string) ?? '',
      age: (patient.age as string) ?? '',
      sex: sex === 'M' || sex === 'F' ? sex : null,
      // strip any unit the old free-text field carried
      weight: weight.replace(/[^0-9.]/g, ''),
      weightUnit: patient.weightUnit === 'kg' ? 'kg' : 'lb',
      emergencyContact:
        (patient.emergencyContact as string | undefined) ?? (patient.contact as string) ?? '',
    },
    spinal: {
      mechanism: tri(spinal.mechanism),
      reliablePatient: tri(spinal.reliablePatient),
      spineTenderness: tri(spinal.spineTenderness),
      neuroDeficit: tri(spinal.neuroDeficit),
      notes: (spinal.notes as string) ?? '',
    },
    headToToeClear: raw.headToToeClear === true,
    problems: typeof raw.problems === 'string' ? raw.problems : '',
    evacuation: migrateEvacuation(raw.evacuation),
    location: {
      description: '',
      latitude: null,
      longitude: null,
      accuracyM: null,
      fixedAt: null,
      ...((raw.location as object) ?? {}),
    },
    findings: Array.isArray(record.findings) ? record.findings : [],
    vitals: Array.isArray(record.vitals) ? record.vitals.map(migrateVitalSet) : [],
    telemetry: Array.isArray(record.telemetry) ? record.telemetry : [],
    complaints: Array.isArray(record.complaints)
      ? record.complaints.map((c) => ({ ...c, palliation: c.palliation ?? '' }))
      : [],
    treatments: Array.isArray(record.treatments) ? record.treatments : [],
    medications: Array.isArray(record.medications)
      ? record.medications.map((m) => {
          const raw = m as unknown as Record<string, unknown>
          // dose used to be free text like "400 mg" — split it apart
          const dose = typeof raw.dose === 'string' ? raw.dose : ''
          const unitFromText = /([a-zA-Z]+)\s*$/.exec(dose)?.[1]
          const known = (DOSE_UNITS as readonly string[]).find(
            (u) => u.toLowerCase() === unitFromText?.toLowerCase(),
          )
          const route = (ROUTES as readonly string[]).find(
            (r) => r.toLowerCase() === String(raw.route ?? '').toLowerCase(),
          )
          return {
            ...m,
            dose: dose.replace(/[^0-9.]/g, ''),
            doseUnit: (raw.doseUnit as MedicationGiven['doseUnit']) ?? (known as MedicationGiven['doseUnit']) ?? null,
            route: (raw.route === null ? null : (route as MedicationGiven['route'])) ?? null,
          }
        })
      : [],
  }
}

const DB_NAME = 'simplesoap'
const DB_VERSION = 1
const STORE = 'assessments'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('startedAt', 'startedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        transaction.onabort = () => reject(transaction.error)
      }),
  )
}

/**
 * Writes are serialized through one chain.
 *
 * Two writers touch a record at once: the note being edited on screen, and the
 * monitor appending samples on a timer. Both do read-modify-write, so without
 * ordering a sample can be written and then immediately overwritten by a save
 * that was holding an older copy — the sample is counted but silently lost.
 */
let writeChain: Promise<unknown> = Promise.resolve()

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = writeChain.then(work, work)
  // keep the chain alive even if this write rejects
  writeChain = next.catch(() => {})
  return next
}

export async function save(assessment: Assessment): Promise<void> {
  await serialize(async () => {
    const record = { ...assessment, updatedAt: Date.now() }
    await tx('readwrite', (store) => store.put(record))
  })
}

/**
 * Save the note without touching monitor samples.
 *
 * The screen holds a copy of the record from whenever it was opened. Telemetry
 * belongs to the monitor session and may have moved on since, so it is taken
 * from storage rather than from the caller.
 */
export async function saveNoteFields(assessment: Assessment): Promise<void> {
  await serialize(async () => {
    const stored = await tx<Assessment | undefined>('readonly', (s) => s.get(assessment.id))
    const record = {
      ...assessment,
      telemetry: stored ? migrate(stored).telemetry : assessment.telemetry,
      updatedAt: Date.now(),
    }
    await tx('readwrite', (s) => s.put(record))
  })
}

/** Discard every monitor sample on a record. */
export async function clearTelemetry(id: Id): Promise<void> {
  await serialize(async () => {
    const stored = await tx<Assessment | undefined>('readonly', (s) => s.get(id))
    if (!stored) return
    await tx('readwrite', (s) => s.put({ ...migrate(stored), telemetry: [], updatedAt: Date.now() }))
  })
}

export async function load(id: Id): Promise<Assessment | null> {
  const record = await tx<Assessment | undefined>('readonly', (store) => store.get(id))
  return record ? migrate(record) : null
}

export async function remove(id: Id): Promise<void> {
  await tx('readwrite', (store) => store.delete(id))
}

/** Newest first, by when care started. */
export async function list(): Promise<AssessmentSummary[]> {
  const all = await tx<Assessment[]>('readonly', (store) => store.getAll())
  return all.map(migrate).sort((a, b) => b.startedAt - a.startedAt).map(summarize)
}

/** Every record, whole — for backup and for the transfer QR. */
export async function exportAll(): Promise<Assessment[]> {
  const all = await tx<Assessment[]>('readonly', (store) => store.getAll())
  return all.map(migrate).sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * Append monitor samples to an assessment.
 *
 * Read-modify-write against storage rather than through screen state — the
 * monitor runs on a timer while the responder is elsewhere in the app, and
 * writing through a stale copy in memory would drop whatever they typed in
 * the meantime.
 */
export async function appendTelemetry(
  id: Id,
  samples: Assessment['telemetry'],
): Promise<void> {
  if (samples.length === 0) return
  await serialize(async () => {
    const stored = await tx<Assessment | undefined>('readonly', (s) => s.get(id))
    if (!stored) return
    const current = migrate(stored)
    await tx('readwrite', (s) =>
      s.put({
        ...current,
        telemetry: [...current.telemetry, ...samples],
        updatedAt: Date.now(),
      }),
    )
  })
}

/**
 * Restore records from a backup.
 * Existing records with the same id are overwritten, so a restore is
 * idempotent and a partial restore can safely be re-run.
 */
export async function importAll(records: Assessment[]): Promise<number> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    for (const record of records) store.put(record)
    transaction.oncomplete = () => resolve(records.length)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
