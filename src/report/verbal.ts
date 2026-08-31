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

/**
 * Region names as they are said out loud.
 *
 * The picker stores compact labels — "R forearm", "Abdomen RUQ" — which are
 * right on a screen and wrong on a radio. Lowercasing them, as this used to,
 * turned "R forearm" into "r forearm" and threw away the laterality, which is
 * the single most consequential word in the sentence.
 */
function spokenRegion(region: string): string {
  const quadrant = /^Abdomen ([RL])([UL])Q$/.exec(region)
  if (quadrant) {
    const side = quadrant[1] === 'R' ? 'right' : 'left'
    const level = quadrant[2] === 'U' ? 'upper' : 'lower'
    return `${side} ${level} quadrant`
  }
  return region.replace(/^R /, 'right ').replace(/^L /, 'left ').toLowerCase()
}

/**
 * Drop the capital a text box put there, but never on an acronym.
 *
 * "Abrasions" mid-sentence should read "abrasions"; CSM, PERRL and MOI carry
 * meaning in their case and must survive intact.
 */
function uncapitalize(text: string): string {
  const first = text.split(/\s+/)[0] ?? ''
  if (first.length > 1 && first === first.toUpperCase()) return text
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** Join clauses the way a person says a list, not the way a form prints one. */
function spokenList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/**
 * Head-to-toe findings as speech.
 *
 * This used to emit "chest: Point source tenderness along R chest; r forearm:
 * Abrasions" — punctuation nobody says, laterality destroyed, and the site
 * named twice because the responder had already written it into the
 * description. A region is only announced when the description has not
 * already said where it is.
 */
function pertinentFindings(a: Assessment): { text: string; missing: boolean } {
  const found = a.findings
    .filter((f) => f.description.trim())
    .map((f) => {
      const description = uncapitalize(f.description.trim())
      const region = spokenRegion(f.region)
      const said = description.toLowerCase()
      const noun = region.split(' ').pop() ?? region
      const abbreviation = /([RL][UL]Q)/.exec(f.region)?.[1]
      const alreadyPlaced =
        said.includes(noun.toLowerCase()) ||
        (abbreviation !== undefined && said.includes(abbreviation.toLowerCase()))
      return alreadyPlaced ? description : `${description} on the ${region}`
    })
  if (found.length) return { text: spokenList(found), missing: false }
  if (a.headToToeClear) {
    return { text: 'no abnormal findings on a full head-to-toe survey', missing: false }
  }
  return { text: BLANK, missing: true }
}

/**
 * SAMPLE history as sentences rather than a form read aloud.
 *
 * Every value used to be glued to its own label, so a note whose fields
 * already read as complete answers came out as "allergies No known allergies,
 * medications No medications" — the labels roughly doubled the length and
 * buried the content they were meant to introduce.
 *
 * A value that already names its own element is spoken as it stands. Only a
 * bare one gets a stem to hang on, so "Penicillin" still arrives as "allergic
 * to penicillin" rather than as a word on its own.
 */
const SAMPLE_PARTS: ReadonlyArray<{
  get: (s: Assessment['sample']) => string
  /** the value already introduces itself, so no stem is needed */
  names: RegExp
  stem: (value: string) => string
}> = [
  {
    get: (s) => s.allergies,
    names: /allerg|\bnkda?\b/i,
    stem: (v) => `allergic to ${v}`,
  },
  {
    get: (s) => s.medications,
    names: /medicat|\bmeds?\b/i,
    stem: (v) => `taking ${v}`,
  },
  {
    get: (s) => s.pastHistory,
    names: /histor/i,
    stem: (v) => `history of ${v}`,
  },
  {
    get: (s) => s.lastIntakeOutput,
    names: /intake|output|\bins?\b|\bouts?\b|\bate\b|\bdrank\b|\bvoided\b/i,
    stem: (v) => `last intake and output was ${v}`,
  },
  {
    // events are narrative by nature — "fell while scrambling" needs no stem,
    // and every phrasing we tried read worse than the responder's own words
    get: (s) => s.events,
    names: /.*/,
    stem: (v) => v,
  },
]

function sampleSummary(a: Assessment): { text: string; missing: boolean } {
  const clauses = SAMPLE_PARTS.map(({ get, names, stem }) => {
    const value = get(a.sample).trim()
    if (!value) return null
    const spoken = oneLine(value) || value
    return uncapitalize(names.test(spoken) ? spoken : stem(spoken))
  }).filter((clause): clause is string => clause !== null)

  return clauses.length
    ? { text: clauses.join('; '), missing: false }
    : { text: BLANK, missing: true }
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
        line(['Pertinent history: ', sampleSummary(a), '.']),
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
