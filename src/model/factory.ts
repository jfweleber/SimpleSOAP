import type { Assessment, Complaint, Finding, Id, MedicationGiven, Treatment, VitalSet } from './types'
import { emptyLocation } from './location'

export function newId(): Id {
  // crypto.randomUUID is available in the Android WebView from API 26
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function newAssessment(attendingProvider = ''): Assessment {
  const now = Date.now()
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    handoffAt: null,
    finalizedAt: null,
    careRefusedAt: null,
    practice: false,
    attendingProvider,
    location: emptyLocation(),
    patient: { name: '', age: '', sex: null, weight: '', weightUnit: 'lb', emergencyContact: '' },
    chiefComplaint: { summary: '', nature: null, incidentAt: null, mechanism: '' },
    complaints: [],
    sample: {
      symptoms: '',
      allergies: '',
      medications: '',
      pastHistory: '',
      lastIntakeOutput: '',
      events: '',
    },
    spinal: {
      mechanism: null,
      reliablePatient: null,
      spineTenderness: null,
      neuroDeficit: null,
      notes: '',
    },
    findings: [],
    headToToeClear: false,
    vitals: [],
    telemetry: [],
    treatments: [],
    medications: [],
    evacuation: {
      mode: null,
      priority: null,
      destination: '',
      method: '',
      supportRequested: '',
      anticipatedProblems: '',
    },
    problems: '',
    notes: '',
  }
}

export function newVitalSet(takenAt = Date.now()): VitalSet {
  return {
    id: newId(),
    takenAt,
    responsiveness: null,
    heartRate: null,
    pulseRhythm: null,
    pulseQuality: null,
    respiratoryRate: null,
    breathRhythm: null,
    breathQuality: null,
    systolic: null,
    diastolic: null,
    bpPalpated: false,
    palpablePulse: null,
    spo2: null,
    temperatureF: null,
    skinColor: null,
    skinTemp: null,
    skinMoisture: null,
    pupils: null,
    notes: '',
    source: { kind: 'manual' },
  }
}

/**
 * A complaint to characterise with OPQRST.
 *
 * `what` can be seeded from the chief complaint so the first one does not have
 * to be retyped. Only the first — a second complaint is a different problem,
 * and prefilling it with the first one's text would be actively misleading.
 */
export function newComplaint(what = ''): Complaint {
  return {
    id: newId(),
    what,
    onset: '',
    provocation: '',
    palliation: '',
    quality: '',
    radiation: '',
    severity: null,
    time: '',
  }
}

export function newFinding(region: Finding['region']): Finding {
  return { id: newId(), region, description: '', treated: false }
}

export function newTreatment(): Treatment {
  return { id: newId(), at: Date.now(), forWhat: '', what: '' }
}

export function newMedication(): MedicationGiven {
  return { id: newId(), at: Date.now(), name: '', dose: '', doseUnit: null, route: null }
}

/**
 * True when a vital set carries nothing worth recording. Used to avoid
 * littering the record with blank rows if someone opens and abandons one.
 */
export function isBlankVitalSet(v: VitalSet): boolean {
  return (
    v.responsiveness === null &&
    v.heartRate === null &&
    v.respiratoryRate === null &&
    v.systolic === null &&
    v.palpablePulse === null &&
    v.spo2 === null &&
    v.temperatureF === null &&
    v.skinColor === null &&
    v.pupils === null &&
    v.notes.trim() === ''
  )
}
