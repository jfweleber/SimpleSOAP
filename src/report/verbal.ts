/**
 * Verbal SOAP report — the script you read over the radio.
 *
 * Follows the NOLS Wilderness Medicine verbal report format, with location
 * moved to the top: the receiving end needs to know where you are before
 * anything else is useful to them.
 *
 * Blanks are left visible as ____ rather than quietly dropped. A gap you can
 * see is one you can fill from memory while transmitting; a sentence that
 * silently omits it reads as complete and the information is simply lost.
 */

import type { Assessment, ChiefComplaint, VitalSet } from '../model/types'
import { mechanismLabel, spinalVerdict } from '../model/types'
import { describeLocation, formatCoordsSpoken } from '../model/location'
import { hhmm } from '../format/time'

export interface VerbalLine {
  /** the sentence to read */
  text: string
  /** true when something in it is still blank */
  incomplete: boolean
}

export interface VerbalSection {
  heading: string
  hint?: string
  lines: VerbalLine[]
}

const BLANK = '____'

/**
 * Flatten a multi-line field into something speakable.
 *
 * These are entered one item per line, which is right for reading on paper and
 * wrong for reading aloud — a line break becomes an awkward pause rather than
 * the list separator it was meant to be.
 */
function oneLine(value: string): string {
  return value
    .split('\n')
    .map((part) => part.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)
    .join('; ')
}

/** Lead-in for the mechanism sentence, spoken from the same label the PDF prints. */
function mechanismLead(nature: ChiefComplaint['nature']): string {
  return `The ${mechanismLabel(nature).toLowerCase()} is `
}

function fill(value: string | null | undefined): { text: string; missing: boolean } {
  const trimmed = (value ?? '').trim()
  return trimmed ? { text: trimmed, missing: false } : { text: BLANK, missing: true }
}

function line(parts: Array<string | { text: string; missing: boolean }>): VerbalLine {
  let incomplete = false
  const text = parts
    .map((part) => {
      if (typeof part === 'string') return part
      if (part.missing) incomplete = true
      return part.text
    })
    .join('')
  return { text, incomplete }
}

/** The most recent set of observed vitals, which is what gets reported. */
export function latestVitals(a: Assessment): VitalSet | null {
  if (a.vitals.length === 0) return null
  return [...a.vitals].sort((x, y) => y.takenAt - x.takenAt)[0]
}

const clockTime = hhmm

/** Vitals spoken in the order they are charted: LOR, HR, RR, SCTM, BP, pupils, temp. */
export function spokenVitals(v: VitalSet | null): { text: string; missing: boolean } {
  if (!v) return { text: BLANK, missing: true }

  const parts: string[] = []
  if (v.responsiveness) parts.push(v.responsiveness)
  if (v.heartRate !== null) {
    const detail = [v.pulseRhythm, v.pulseQuality].filter(Boolean).join(' and ')
    parts.push(`heart rate ${v.heartRate}${detail ? `, ${detail}` : ''}`)
  }
  if (v.respiratoryRate !== null) {
    const detail = [v.breathRhythm, v.breathQuality].filter(Boolean).join(' and ')
    parts.push(`respirations ${v.respiratoryRate}${detail ? `, ${detail}` : ''}`)
  }
  const sctm = [v.skinColor, v.skinTemp, v.skinMoisture].filter(Boolean)
  if (sctm.length) parts.push(`skin ${sctm.join(', ')}`)
  if (v.systolic !== null) {
    parts.push(
      `blood pressure ${v.systolic} over ${v.bpPalpated ? 'palp' : (v.diastolic ?? BLANK)}`,
    )
  }
  if (v.pupils) parts.push(`pupils ${v.pupils}`)
  if (v.temperatureF !== null) parts.push(`temperature ${v.temperatureF} degrees`)
  if (v.spo2 !== null) parts.push(`oxygen saturation ${v.spo2} percent`)

  if (parts.length === 0) return { text: BLANK, missing: true }
  return { text: parts.join(', '), missing: false }
}

function pertinentFindings(a: Assessment): { text: string; missing: boolean } {
  const found = a.findings
    .filter((f) => f.description.trim())
    .map((f) => `${f.region.toLowerCase()}: ${f.description.trim()}`)
  if (found.length) return { text: found.join('; '), missing: false }
  if (a.headToToeClear) {
    return { text: 'no abnormal findings on a full head-to-toe survey', missing: false }
  }
  return { text: BLANK, missing: true }
}

function sampleSummary(a: Assessment): { text: string; missing: boolean } {
  const bits: string[] = []
  const s = a.sample
  if (s.allergies.trim()) bits.push(`allergies ${s.allergies.trim()}`)
  if (s.medications.trim()) bits.push(`medications ${s.medications.trim()}`)
  if (s.pastHistory.trim()) bits.push(`history of ${s.pastHistory.trim()}`)
  if (s.lastIntakeOutput.trim()) bits.push(`last intake and output ${s.lastIntakeOutput.trim()}`)
  if (s.events.trim()) bits.push(`events ${s.events.trim()}`)
  return bits.length ? { text: bits.join(', '), missing: false } : { text: BLANK, missing: true }
}

function treatmentSummary(a: Assessment): { text: string; missing: boolean } {
  const given = a.treatments.filter((t) => t.what.trim()).map((t) => t.what.trim())
  const meds = a.medications
    .filter((m) => m.name.trim())
    .map((m) =>
      [m.name.trim(), m.dose.trim() && `${m.dose.trim()} ${m.doseUnit ?? ''}`.trim(), m.route]
        .filter(Boolean)
        .join(' '),
    )
  const all = [...given, ...meds]
  return all.length ? { text: all.join('; '), missing: false } : { text: BLANK, missing: true }
}

/**
 * The evacuation, as a sentence someone can say.
 *
 * The old version comma-joined every field into a stem that wanted a verb
 * phrase, producing "our evacuation plan is to ground, non-urgent, Schultz TH".
 * Knowing which slot each value fills is what lets it read as English.
 */
function evacuationLine(a: Assessment): VerbalLine {
  const e = a.evacuation

  if (e.mode === 'none — patient released') {
    return {
      text: 'The patient is being released on scene. No evacuation is required.',
      incomplete: false,
    }
  }

  if (e.mode === 'bivouac in place') {
    const detail = e.method.trim()
    return {
      text: detail
        ? `We plan to bivouac in place: ${detail}.`
        : 'We plan to bivouac in place.',
      incomplete: false,
    }
  }

  return line([
    'Our evacuation plan is a ',
    fill(e.priority),
    ' ',
    fill(e.mode),
    ' evacuation to ',
    fill(e.destination),
    ' by ',
    fill(e.method),
    '.',
  ])
}

export function buildVerbalReport(a: Assessment): VerbalSection[] {
  const v = latestVitals(a)
  const verdict = spinalVerdict(a.spinal)
  const spoken = formatCoordsSpoken(a.location)
  const place = describeLocation(a.location)

  const age = a.patient.age.trim()
  const sex = a.patient.sex
  const who = [age && `${age}-year-old`, sex === 'M' ? 'male' : sex === 'F' ? 'female' : null]
    .filter(Boolean)
    .join(' ')

  return [
    {
      heading: 'Location first',
      lines: [
        line([
          'We are currently located at ',
          fill(place || null),
          spoken ? `. Coordinates ${spoken}.` : '.',
        ]),
      ],
    },
    {
      heading: 'Subjective',
      hint: 'Who, what, where',
      lines: [
        line([
          'This is ',
          fill(a.attendingProvider),
          ' with a patient report and evacuation request.',
        ]),
        line(['I have a ', fill(who || null), ' whose chief complaint is ', fill(a.chiefComplaint.summary), '.']),
        line([mechanismLead(a.chiefComplaint.nature), fill(a.chiefComplaint.mechanism), '.']),
        line([
          'The patient is currently ',
          fill(v?.responsiveness ?? null),
          '.',
        ]),
      ],
    },
    {
      heading: 'Objective',
      hint: 'Head to toe, vitals, history',
      lines: [
        line(['Patient has ', pertinentFindings(a), '.']),
        line([
          v ? `As of ${clockTime(v.takenAt)}, the patient's vital signs are ` : "The patient's vital signs are ",
          spokenVitals(v),
          '.',
        ]),
        line(['Pertinent SAMPLE history includes ', sampleSummary(a), '.']),
      ],
    },
    {
      heading: 'Assessment',
      hint: 'Problem list',
      lines: [
        {
          text:
            verdict.code === 'no-moi'
              ? 'Based on the mechanism there is not a possible spine injury.'
              : verdict.code === 'incomplete'
                ? `Based on the mechanism there ${BLANK} a possible spine injury.`
                : 'Based on the mechanism there is a possible spine injury.',
          incomplete: verdict.code === 'incomplete',
        },
        line(['We suspect the following problems: ', fill(oneLine(a.problems)), '.']),
      ],
    },
    {
      heading: 'Plan',
      hint: 'Treatment, evacuation, anticipated problems',
      lines: [
        {
          text:
            verdict.code === 'protect'
              ? 'We performed a focused spine assessment and maintained spine protection.'
              : verdict.code === 'cleared'
                ? 'We performed a focused spine assessment and released spine protection.'
                : verdict.code === 'no-moi'
                  ? 'No spine protection was indicated.'
                  : `We ${BLANK} a focused spine assessment.`,
          incomplete: verdict.code === 'incomplete',
        },
        line(['Our treatment has included ', treatmentSummary(a), '.']),
        evacuationLine(a),
        line([
          'We request the following supplies and support: ',
          fill(oneLine(a.evacuation.supportRequested)),
          '.',
        ]),
        line(['We will monitor for ', fill(oneLine(a.evacuation.anticipatedProblems)), '.']),
      ],
    },
  ]
}

/** Flatten to plain text, for copying or sharing. */
export function verbalReportText(a: Assessment): string {
  return buildVerbalReport(a)
    .map((section) => `${section.heading.toUpperCase()}\n${section.lines.map((l) => l.text).join('\n')}`)
    .join('\n\n')
}
