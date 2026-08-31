/**
 * SOAP note data model.
 *
 * One assessment is one record. Nested collections are stored inline rather
 * than in separate tables — an assessment is always read and written whole,
 * and keeping it in one object makes export, transfer and backup trivial.
 */

export type Id = string

// --- vitals ---------------------------------------------------------------

/** AVPU, expanded with orientation for alert patients. */
export const RESPONSIVENESS = [
  'A+Ox4',
  'A+Ox3',
  'A+Ox2',
  'A+Ox1',
  'V — responds to voice',
  'P — responds to pain',
  'U — unresponsive',
] as const
export type Responsiveness = (typeof RESPONSIVENESS)[number]

export const PULSE_QUALITY = ['strong', 'weak', 'thready', 'bounding'] as const
export const RHYTHM = ['regular', 'irregular'] as const
export const BREATH_QUALITY = ['normal', 'labored', 'shallow', 'noisy'] as const

export const SKIN_COLOR = ['pink', 'pale', 'flushed', 'cyanotic', 'jaundiced', 'mottled'] as const
export const SKIN_TEMP = ['warm', 'hot', 'cool', 'cold'] as const
// 'clammy' is dropped: it describes moisture AND temperature at once, which
// the separate skin-temperature field already covers.
export const SKIN_MOISTURE = ['dry', 'moist', 'sweaty'] as const

/**
 * Where a pulse could still be felt, for the common SAR case of no cuff in
 * anyone's pack. The most distal site that is palpable is a rough floor on
 * systolic pressure, so the list runs distal to proximal and ends with the
 * confirmed negative.
 */
export const PALPABLE_PULSE = ['radial', 'pedal', 'femoral', 'carotid', 'none palpable'] as const

export const PUPILS = [
  'PERRL',
  'equal, sluggish',
  'unequal',
  'fixed',
  'dilated',
  'constricted',
] as const

/** Where a number came from. Device readings are marked so they can be trusted differently. */
export interface VitalSource {
  kind: 'manual' | 'device'
  /** adapter id, when kind is 'device' */
  adapterId?: string
  deviceName?: string
}

export interface VitalSet {
  id: Id
  /** ms since epoch — when the vitals were taken, not when they were typed */
  takenAt: number
  responsiveness: Responsiveness | null
  heartRate: number | null
  pulseRhythm: (typeof RHYTHM)[number] | null
  pulseQuality: (typeof PULSE_QUALITY)[number] | null
  respiratoryRate: number | null
  breathRhythm: (typeof RHYTHM)[number] | null
  breathQuality: (typeof BREATH_QUALITY)[number] | null
  systolic: number | null
  diastolic: number | null
  /** true when BP was taken by palpation, so diastolic is legitimately absent */
  bpPalpated: boolean
  /** pulse felt by hand when no cuff was available — never a substitute for a reading */
  palpablePulse: (typeof PALPABLE_PULSE)[number] | null
  spo2: number | null
  /** Fahrenheit — this is used in the US */
  temperatureF: number | null
  skinColor: (typeof SKIN_COLOR)[number] | null
  skinTemp: (typeof SKIN_TEMP)[number] | null
  skinMoisture: (typeof SKIN_MOISTURE)[number] | null
  pupils: (typeof PUPILS)[number] | null
  notes: string
  source: VitalSource
}

/**
 * One reading captured from a connected monitor.
 *
 * Kept apart from VitalSet on purpose. A vital set is something a responder
 * observed and stands behind; these are machine samples taken on a timer, and
 * conflating the two would let an unreviewed number look like an assessment.
 */
export interface TelemetrySample {
  at: number
  heartRate: number | null
  spo2: number | null
  perfusionIndex: number | null
  respiratoryRate: number | null
  /** adapter id, e.g. 'ble_hr' */
  adapterId: string
  deviceName: string | null
}

// --- patient and history --------------------------------------------------

export const SEX = ['M', 'F'] as const
export type Sex = (typeof SEX)[number]

// pounds first: this is used in the US. kg stays one tap away, since
// weight-based drug dosing is written in kg.
export const WEIGHT_UNITS = ['lb', 'kg'] as const
export type WeightUnit = (typeof WEIGHT_UNITS)[number]

export interface Patient {
  name: string
  age: string
  sex: Sex | null
  /** numeric only — the unit is carried separately so the keypad stays numeric */
  weight: string
  weightUnit: WeightUnit
  /** next of kin or whoever should be told, not the patient's own number */
  emergencyContact: string
}

export interface Sample {
  symptoms: string
  allergies: string
  medications: string
  pastHistory: string
  lastIntakeOutput: string
  events: string
}

export interface ChiefComplaint {
  /** free text — the patient's own words where possible */
  summary: string
  nature: 'injury' | 'illness' | null
  /** ms since epoch */
  incidentAt: number | null
  mechanism: string
}

/**
 * What to call the mechanism field for this complaint.
 *
 * "Mechanism of injury" is the wrong phrase for a sick patient — a reader or
 * a receiving provider hears trauma when what we have is an onset. Nature is
 * not always set by the time a note is printed or read over the radio, so the
 * unset case stays deliberately neutral rather than guessing one or the other.
 */
export function mechanismLabel(nature: ChiefComplaint['nature']): string {
  if (nature === 'illness') return 'History of present illness'
  if (nature === 'injury') return 'Mechanism of injury'
  return 'Mechanism or onset'
}

/** OPQRST, recorded per complaint. */
export interface Complaint {
  id: Id
  what: string
  onset: string
  /** what makes it worse */
  provocation: string
  /** what makes it better — a positive response is a finding in its own right */
  palliation: string
  quality: string
  radiation: string
  severity: number | null
  time: string
}

// --- findings -------------------------------------------------------------

/**
 * Survey regions, in head-to-toe working order.
 * L and R are the PATIENT's left and right throughout.
 */
export const BODY_REGIONS = [
  'Head',
  'Face',
  'Neck',
  'Chest',
  'Abdomen RUQ',
  'Abdomen LUQ',
  'Abdomen RLQ',
  'Abdomen LLQ',
  'Pelvis',
  'R upper arm',
  'R elbow',
  'R forearm',
  'R hand',
  'L upper arm',
  'L elbow',
  'L forearm',
  'L hand',
  'R thigh',
  'R knee',
  'R lower leg',
  'R foot',
  'L thigh',
  'L knee',
  'L lower leg',
  'L foot',
  'Back / Spine',
] as const
export type BodyRegion = (typeof BODY_REGIONS)[number]

export interface Finding {
  id: Id
  region: BodyRegion
  description: string
  treated: boolean
}

export interface Treatment {
  id: Id
  at: number
  forWhat: string
  what: string
}

/** Units a field dose is actually measured in. */
export const DOSE_UNITS = ['mg', 'g', 'mcg', 'mL', 'units', 'mEq', 'tab', 'puff', 'spray'] as const
export type DoseUnit = (typeof DOSE_UNITS)[number]

/** Routes of administration, as charted. */
export const ROUTES = ['Oral', 'SL', 'IN', 'IM', 'IV', 'IO', 'SC', 'PR', 'Neb', 'Topical'] as const
export type Route = (typeof ROUTES)[number]

export interface MedicationGiven {
  id: Id
  at: number
  name: string
  /** numeric amount; the unit is carried separately so the keypad stays numeric */
  dose: string
  doseUnit: DoseUnit | null
  route: Route | null
}

// --- plan -----------------------------------------------------------------

/**
 * How the patient leaves, kept as separate facts.
 *
 * These were one field holding "ground, non-urgent", which reads badly in a
 * spoken report and cannot be recombined into a sentence. Mode and priority
 * answer different questions — whether you need aircraft, and how fast — and
 * the receiving end acts on them separately.
 */
export const EVAC_MODE = [
  'ground',
  'air',
  'bivouac in place',
  'none — patient released',
] as const
export type EvacMode = (typeof EVAC_MODE)[number]

export const EVAC_PRIORITY = ['urgent', 'non-urgent'] as const
export type EvacPriority = (typeof EVAC_PRIORITY)[number]

export interface Evacuation {
  mode: EvacMode | null
  priority: EvacPriority | null
  destination: string
  /** how they are moved: litter carry, walk out with escort, short-haul */
  method: string
  /** what you are asking the receiving end to send */
  supportRequested: string
  /** what you will watch for, and what you will do about it */
  anticipatedProblems: string
}

/**
 * Three states, not two. A checkbox cannot tell "assessed and negative" apart
 * from "never assessed", and on a spinal clearing decision that distinction is
 * the whole point — a confirmed negative is a finding.
 */
export type Tri = 'yes' | 'no' | null

export interface SpinalAssessment {
  /** mechanism of injury capable of causing spinal injury */
  mechanism: Tri
  /** sober, alert, cooperative, no distracting injury */
  reliablePatient: Tri
  spineTenderness: Tri
  neuroDeficit: Tri
  notes: string
}

export type SpinalVerdict =
  | { code: 'no-moi'; label: string }
  | { code: 'cleared'; label: string }
  | { code: 'protect'; label: string }
  | { code: 'incomplete'; label: string }

/** Reads the criteria into a single conclusion. */
export function spinalVerdict(s: SpinalAssessment): SpinalVerdict {
  if (s.mechanism === 'no') {
    return { code: 'no-moi', label: 'No MOI for spinal injury — spinal protection not indicated' }
  }
  if (s.mechanism === null) {
    return { code: 'incomplete', label: 'Spinal assessment not completed' }
  }
  const positives =
    s.reliablePatient === 'no' || s.spineTenderness === 'yes' || s.neuroDeficit === 'yes'
  if (positives) {
    return { code: 'protect', label: 'Spinal protection indicated' }
  }
  const allAnswered =
    s.reliablePatient !== null && s.spineTenderness !== null && s.neuroDeficit !== null
  if (allAnswered) {
    return { code: 'cleared', label: 'MOI present; clearing criteria met — spine cleared' }
  }
  return { code: 'incomplete', label: 'MOI present; clearing criteria not fully assessed' }
}

/** Where the incident is — a place name, coordinates, or both. */
export interface IncidentLocation {
  /** free text: trail name, drainage, mile marker, whatever dispatch knows */
  description: string
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  fixedAt: number | null
}

// --- the record -----------------------------------------------------------

export interface Assessment {
  id: Id
  createdAt: number
  updatedAt: number
  /** when the responder took over care */
  startedAt: number
  /** when the patient left their care */
  handoffAt: number | null
  /** locked — no further edits */
  finalizedAt: number | null
  careRefusedAt: number | null
  practice: boolean

  attendingProvider: string
  location: IncidentLocation
  patient: Patient
  chiefComplaint: ChiefComplaint
  complaints: Complaint[]
  sample: Sample
  spinal: SpinalAssessment
  findings: Finding[]
  /** survey completed with nothing abnormal — a confirmed negative, not a blank */
  headToToeClear: boolean
  vitals: VitalSet[]
  /** timed samples from connected monitors, separate from observed vitals */
  telemetry: TelemetrySample[]
  treatments: Treatment[]
  medications: MedicationGiven[]
  evacuation: Evacuation
  /**
   * The A of SOAP — the problem list.
   *
   * Distinct from `notes`. This is what you think is wrong; notes is
   * everything else worth writing down. Conflating them made the spoken
   * report announce the running commentary as a diagnosis.
   */
  problems: string
  notes: string
}

/** Short summary for the assessment list. */
export interface AssessmentSummary {
  id: Id
  startedAt: number
  updatedAt: number
  patientName: string
  complaint: string
  finalized: boolean
  practice: boolean
  vitalCount: number
  telemetryCount: number
}

export function summarize(a: Assessment): AssessmentSummary {
  return {
    id: a.id,
    startedAt: a.startedAt,
    updatedAt: a.updatedAt,
    patientName: a.patient.name.trim() || 'Name unknown',
    complaint: a.chiefComplaint.summary.trim(),
    finalized: a.finalizedAt !== null,
    practice: a.practice,
    vitalCount: a.vitals.length,
    telemetryCount: a.telemetry.length,
  }
}
