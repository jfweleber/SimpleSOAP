import { describe, expect, it } from 'vitest'
import { renderReport } from './template'
import { newAssessment, newVitalSet } from '../model/factory'
import { spinalVerdict } from '../model/types'
import { buildVerbalReport } from './verbal'
import type { Assessment } from '../model/types'

function populated(): Assessment {
  const a = newAssessment('J. Weleber')
  a.patient = {
    name: 'Dana Reyes',
    age: '34',
    sex: 'F',
    weight: '61',
    weightUnit: 'kg',
    emergencyContact: 'Sam Reyes 555-0142',
  }
  a.chiefComplaint = {
    summary: 'Fell while scrambling, landed on outstretched arm',
    nature: 'injury',
    incidentAt: a.startedAt - 45 * 60_000,
    mechanism: 'Ground-level fall, ~2 m',
  }
  a.sample.allergies = 'NKDA'
  a.findings = [
    { id: 'f1', region: 'R forearm', description: 'Deformity distal radius', treated: true },
    { id: 'f2', region: 'R forearm', description: 'Good CSM distal to injury', treated: false },
    { id: 'f3', region: 'Head', description: 'No deformity, no bleeding', treated: false },
  ]
  a.spinal = {
    mechanism: 'yes',
    reliablePatient: 'yes',
    spineTenderness: 'no',
    neuroDeficit: 'no',
    notes: '',
  }
  const v = newVitalSet(a.startedAt)
  v.heartRate = 88
  v.pulseRhythm = 'regular'
  v.pulseQuality = 'strong'
  v.respiratoryRate = 16
  v.systolic = 124
  v.diastolic = 78
  v.spo2 = 97
  v.responsiveness = 'A+Ox4'
  v.skinColor = 'pink'
  v.skinTemp = 'warm'
  v.skinMoisture = 'dry'
  v.pupils = 'PERRL'
  v.temperatureF = 98
  a.vitals = [v]

  const fromDevice = newVitalSet(a.startedAt + 15 * 60_000)
  fromDevice.heartRate = 84
  fromDevice.spo2 = 98
  fromDevice.source = { kind: 'device', adapterId: 'ble_plx', deviceName: 'Test Oximeter' }
  a.vitals.push(fromDevice)

  a.treatments = [{ id: 't1', at: a.startedAt, forWhat: 'Deformity', what: 'SAM splint, sling and swathe' }]
  a.medications = [
    { id: 'm1', at: a.startedAt, name: 'Ibuprofen', dose: '400', doseUnit: 'mg', route: 'Oral' },
  ]
  a.evacuation = {
    mode: 'ground',
    priority: 'non-urgent',
    destination: 'Schultz TH',
    method: 'litter carry',
    supportRequested: 'Litter team of six, extra light',
    anticipatedProblems: 'Pain control on the carry',
  }
  a.problems = 'Probable distal radius fracture\nMild dehydration'
  return a
}

describe('report', () => {
  it('renders a complete document', () => {
    const html = renderReport(populated())
    expect(html).toContain('<!doctype html>')
    expect(html.trim().endsWith('</html>')).toBe(true)
  })

  it('includes every required section in the handoff order', () => {
    const html = renderReport(populated())
    const order = [
      'Chief complaint',
      'History (SAMPLE)',
      'Vitals',
      'Head to toe',
      'Spinal assessment',
      'Treatments',
      'Medications given',
      'Evacuation plan',
      'Notes',
    ]
    let cursor = -1
    for (const heading of order) {
      // section headings only — "Notes" is also a field label inside a section
      const at = html.indexOf(`<h2>${heading}</h2>`)
      expect(at, `${heading} missing`).toBeGreaterThan(-1)
      expect(at, `${heading} out of order`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('carries the recorded values through', () => {
    const html = renderReport(populated())
    expect(html).toContain('Dana Reyes')
    expect(html).toContain('124/78')
    expect(html).toContain('97%')
    expect(html).toContain('Deformity distal radius')
    expect(html).toContain('SAM splint')
    expect(html).toContain('Ibuprofen')
  })

  it('groups findings by body region', () => {
    const html = renderReport(populated())
    // both forearm findings should appear under one heading
    const arm = html.indexOf('R forearm')
    expect(arm).toBeGreaterThan(-1)
    expect(html.indexOf('R forearm', arm + 1)).toBe(-1)
    expect(html).toContain('[treated]')
  })

  it('lists findings in anatomical order, not entry order', () => {
    const html = renderReport(populated())
    // Head is recorded last but must print before the forearm
    expect(html.indexOf('>Head<')).toBeLessThan(html.indexOf('>R forearm<'))
  })

  it('renders age, sex and weight with its unit', () => {
    expect(renderReport(populated())).toContain('34 yo · F · 61 kg')
  })

  it('includes the emergency contact and attending provider', () => {
    const html = renderReport(populated())
    expect(html).toContain('Sam Reyes 555-0142')
    expect(html).toContain('Attending provider')
    expect(html).toContain('J. Weleber')
  })

  it('marks device-sourced readings', () => {
    const html = renderReport(populated())
    expect(html).toContain('from a connected device')
  })

  it('renders palpated blood pressure without a fabricated diastolic', () => {
    const a = populated()
    a.vitals[0].bpPalpated = true
    a.vitals[0].diastolic = null
    expect(renderReport(a)).toContain('124/P')
  })

  it('flags a draft that has not been finalized', () => {
    expect(renderReport(populated())).toContain('DRAFT')
  })

  it('marks practice notes prominently', () => {
    const a = populated()
    a.practice = true
    expect(renderReport(a)).toContain('PRACTICE')
  })

  it('escapes free text rather than emitting it as markup', () => {
    const a = populated()
    a.notes = 'Patient said <script>alert(1)</script> & then "rested"'
    const html = renderReport(a)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('preserves line breaks in free text', () => {
    const a = populated()
    a.notes = 'first line\nsecond line'
    expect(renderReport(a)).toContain('first line<br>second line')
  })

  it('renders an empty assessment without throwing', () => {
    const html = renderReport(newAssessment())
    expect(html).toContain('Name unknown')
    expect(html).toContain('No vitals recorded.')
  })
})

describe('confirmed negatives', () => {
  it('records a clear head-to-toe survey as a positive statement', () => {
    const a = newAssessment()
    a.headToToeClear = true
    const html = renderReport(a)
    expect(html).toContain('no abnormal findings')
    expect(html).not.toContain('No findings recorded')
  })

  it('distinguishes an unassessed survey from a clear one', () => {
    const html = renderReport(newAssessment())
    expect(html).toContain('No findings recorded')
  })

  it('states no MOI as a conclusion in its own right', () => {
    const a = newAssessment()
    a.spinal.mechanism = 'no'
    const html = renderReport(a)
    expect(html).toContain('No MOI for spinal injury')
    expect(html).toContain('spinal protection not indicated')
  })

  it('does not ask the remaining criteria once MOI is excluded', () => {
    const a = newAssessment()
    a.spinal.mechanism = 'no'
    const html = renderReport(a)
    expect(html).not.toContain('Spine tenderness')
  })

  it('spells out each negative criterion when MOI is present', () => {
    const a = newAssessment()
    a.spinal = {
      mechanism: 'yes',
      reliablePatient: 'yes',
      spineTenderness: 'no',
      neuroDeficit: 'no',
      notes: '',
    }
    const html = renderReport(a)
    expect(html).toContain('Spine tenderness: no')
    expect(html).toContain('Motor/sensory deficit: no')
    expect(html).toContain('spine cleared')
  })

  it('flags protection when any criterion is positive', () => {
    const a = newAssessment()
    a.spinal = {
      mechanism: 'yes',
      reliablePatient: 'yes',
      spineTenderness: 'yes',
      neuroDeficit: 'no',
      notes: '',
    }
    expect(renderReport(a)).toContain('Spinal protection indicated')
  })

  it('reports an unanswered criterion as not assessed rather than negative', () => {
    const a = newAssessment()
    a.spinal.mechanism = 'yes'
    const html = renderReport(a)
    expect(html).toContain('not assessed')
    expect(html).toContain('not fully assessed')
  })
})

describe('spinal verdict', () => {
  const base = { mechanism: null, reliablePatient: null, spineTenderness: null, neuroDeficit: null, notes: '' }

  it('is incomplete until MOI is answered', () => {
    expect(spinalVerdict({ ...base }).code).toBe('incomplete')
  })

  it('closes out on no MOI without needing the other criteria', () => {
    expect(spinalVerdict({ ...base, mechanism: 'no' }).code).toBe('no-moi')
  })

  it('clears only when every criterion is answered', () => {
    expect(
      spinalVerdict({ ...base, mechanism: 'yes', reliablePatient: 'yes', spineTenderness: 'no' }).code,
    ).toBe('incomplete')
    expect(
      spinalVerdict({
        ...base,
        mechanism: 'yes',
        reliablePatient: 'yes',
        spineTenderness: 'no',
        neuroDeficit: 'no',
      }).code,
    ).toBe('cleared')
  })

  it('indicates protection on an unreliable patient', () => {
    expect(spinalVerdict({ ...base, mechanism: 'yes', reliablePatient: 'no' }).code).toBe('protect')
  })
})

describe('body map on the report', () => {
  it('draws the figure whenever findings exist', () => {
    const html = renderReport(populated())
    expect(html).toContain('<svg viewBox="0 0 220 322"')
    expect(html).toContain('Body map of findings')
  })

  it('numbers findings in head-to-toe order and reuses those numbers on the figure', () => {
    const html = renderReport(populated())
    // Head is region 1, R forearm is region 2 in anatomical order
    expect(html).toContain('<span class="fndN">1</span><span class="fndR">Head</span>')
    expect(html).toContain('<span class="fndN">2</span><span class="fndR">R forearm</span>')
    // and both numbers appear as badges inside the svg
    expect(html).toContain('font-weight="700" fill="#000">1</text>')
    expect(html).toContain('font-weight="700" fill="#000">2</text>')
  })

  it('labels patient left and right on the figure', () => {
    const html = renderReport(populated())
    expect(html).toContain('PT RIGHT')
    expect(html).toContain('PT LEFT')
  })

  it('marks only the regions that have findings', () => {
    const a = newAssessment()
    a.findings = [{ id: 'x', region: 'L knee', description: 'Abrasion', treated: false }]
    const html = renderReport(a)
    // one filled region, one badge
    expect(html.match(/fill="#4a4a4a"/g)?.length).toBe(1)
    expect(html.match(/font-weight="700" fill="#000">1<\/text>/g)?.length).toBe(1)
  })

  it('shows Back / Spine as a separate marker, since it is not on the front view', () => {
    const a = newAssessment()
    a.findings = [{ id: 'x', region: 'Back / Spine', description: 'Midline tenderness T4', treated: false }]
    const html = renderReport(a)
    expect(html).toContain('Back / Spine</text>')
  })

  it('still draws the figure for a clear survey', () => {
    const a = newAssessment()
    a.headToToeClear = true
    const html = renderReport(a)
    expect(html).toContain('Body map of findings')
    expect(html).toContain('no abnormal findings')
  })

  it('omits the figure entirely when the survey was never done', () => {
    const html = renderReport(newAssessment())
    expect(html).not.toContain('Body map of findings')
  })
})

describe('streamed monitor data', () => {
  function withTelemetry(): Assessment {
    const a = populated()
    a.telemetry = [
      { at: a.startedAt, heartRate: 88, spo2: 97, perfusionIndex: 4.2, respiratoryRate: null, adapterId: 'ble_plx', deviceName: 'Pulse Oximeter (standard)' },
      { at: a.startedAt + 300_000, heartRate: 84, spo2: 98, perfusionIndex: 4.6, respiratoryRate: null, adapterId: 'ble_plx', deviceName: 'Pulse Oximeter (standard)' },
    ]
    return a
  }

  it('is left out unless asked for', () => {
    const html = renderReport(withTelemetry())
    expect(html).not.toContain('streamed monitor data')
  })

  it('appends the table when requested', () => {
    const html = renderReport(withTelemetry(), { includeTelemetry: true })
    expect(html).toContain('Appendix — streamed monitor data')
    expect(html).toContain('2 samples recorded automatically')
  })

  it('places the appendix after the signature so it does not read as vitals', () => {
    const html = renderReport(withTelemetry(), { includeTelemetry: true })
    expect(html.indexOf('Attending provider')).toBeLessThan(
      html.indexOf('Appendix — streamed monitor data'),
    )
  })

  it('says plainly that these are device readings', () => {
    const html = renderReport(withTelemetry(), { includeTelemetry: true })
    expect(html).toContain('device readings, not observed vitals')
  })

  it('omits columns no sample populated', () => {
    const html = renderReport(withTelemetry(), { includeTelemetry: true })
    expect(html).toContain('<th>SpO₂</th>')
    expect(html).toContain('<th>PI</th>')
    // nothing recorded a respiratory rate, so that column should not appear
    expect(html).not.toContain('<th>Resp</th>')
  })

  it('adds nothing at all when no samples were captured', () => {
    const html = renderReport(populated(), { includeTelemetry: true })
    expect(html).not.toContain('Appendix')
  })

  it('keeps monitor samples out of the observed vitals table', () => {
    const a = withTelemetry()
    const html = renderReport(a, { includeTelemetry: true })
    const vitalsAt = html.indexOf('<h2>Vitals</h2>')
    const appendixAt = html.indexOf('Appendix')
    // the 4.2 PI only exists in telemetry, so it must not appear before the appendix
    expect(html.slice(vitalsAt, appendixAt)).not.toContain('4.2')
  })
})

describe('OPQRST', () => {
  it('records what relieves a complaint alongside what provokes it', () => {
    const a = populated()
    a.complaints = [
      {
        id: 'c1',
        what: 'Right wrist pain',
        onset: 'Immediate on landing',
        provocation: 'Any movement or weight bearing',
        palliation: 'Splinting and holding it still',
        quality: 'Sharp',
        radiation: 'None',
        severity: 7,
        time: 'Constant since the fall',
      },
    ]
    const html = renderReport(a)
    expect(html).toContain('Provokes')
    expect(html).toContain('Any movement or weight bearing')
    expect(html).toContain('Palliates')
    expect(html).toContain('Splinting and holding it still')
  })

  it('prints provokes before palliates', () => {
    const a = populated()
    a.complaints = [
      {
        id: 'c1', what: 'Pain', onset: '', provocation: 'worse-marker',
        palliation: 'better-marker', quality: '', radiation: '', severity: null, time: '',
      },
    ]
    const html = renderReport(a)
    expect(html.indexOf('worse-marker')).toBeLessThan(html.indexOf('better-marker'))
  })
})

describe('medications', () => {
  it('prints the dose with its unit and the route', () => {
    const html = renderReport(populated())
    expect(html).toContain('400 mg')
    expect(html).toContain('Oral')
  })

  it('shows a dash rather than a bare unit when no dose was recorded', () => {
    const a = populated()
    a.medications = [
      { id: 'm1', at: a.startedAt, name: 'Aspirin', dose: '', doseUnit: 'mg', route: null },
    ]
    const html = renderReport(a)
    expect(html).toContain('Aspirin')
    expect(html).not.toContain('>mg<')
  })
})

describe('mechanism labelling', () => {
  it('labels the printed mechanism row to match the nature of the complaint', () => {
    const injured = renderReport(populated())
    expect(injured).toContain('Mechanism of injury')

    const ill = populated()
    ill.chiefComplaint.nature = 'illness'
    const illHtml = renderReport(ill)
    expect(illHtml).toContain('History of present illness')
    expect(illHtml).not.toContain('Mechanism of injury')

    const unset = populated()
    unset.chiefComplaint.nature = null
    expect(renderReport(unset)).toContain('Mechanism or onset')
  })
})

describe('verbal report', () => {
  it('leads with location', () => {
    const a = populated()
    a.location = {
      description: 'Trail junction 4',
      latitude: 44.2705,
      longitude: -121.1743,
      accuracyM: 5,
      fixedAt: a.startedAt,
    }
    const sections = buildVerbalReport(a)
    expect(sections[0].heading).toBe('Location first')
    expect(sections[0].lines[0].text).toContain('Trail junction 4')
    expect(sections[0].lines[0].text).toContain('N 44°')
  })

  it('only promises an evacuation request when there is one', () => {
    const opening = (a: Assessment) =>
      buildVerbalReport(a).find((s) => s.heading === 'Subjective')!.lines[0].text

    // an untouched plan asks for nothing
    expect(opening(newAssessment())).toBe('This is ____ with a patient report.')

    // a patient released on scene is not an evacuation request either — the
    // Plan section goes on to say no evacuation is required
    const released = populated()
    released.evacuation = {
      mode: 'none — patient released',
      priority: null,
      destination: '',
      method: '',
      supportRequested: '',
      anticipatedProblems: '',
    }
    expect(opening(released)).not.toContain('evacuation request')

    // contingency notes alone are not a request
    const watching = newAssessment()
    watching.evacuation = { ...watching.evacuation, anticipatedProblems: 'Watch for shock' }
    expect(opening(watching)).not.toContain('evacuation request')

    // any real part of the plan restores it
    const planned = newAssessment()
    planned.attendingProvider = 'Casey'
    planned.evacuation = { ...planned.evacuation, mode: 'ground' }
    expect(opening(planned)).toBe('This is Casey with a patient report and evacuation request.')

    const supportOnly = newAssessment()
    supportOnly.evacuation = { ...supportOnly.evacuation, supportRequested: 'Litter team' }
    expect(opening(supportOnly)).toContain('evacuation request')
  })

  it('follows the NOLS section order', () => {
    expect(buildVerbalReport(populated()).map((s) => s.heading)).toEqual([
      'Location first',
      'Subjective',
      'Objective',
      'Assessment',
      'Plan',
    ])
  })

  it('speaks the most recent vitals, not the first', () => {
    const a = populated()
    const spoken = buildVerbalReport(a)
      .find((s) => s.heading === 'Objective')!
      .lines.map((l) => l.text)
      .join(' ')
    // the later set reads 84, the earlier one 88
    expect(spoken).toContain('heart rate 84')
    expect(spoken).not.toContain('heart rate 88')
  })

  it('phrases the mechanism line to match the nature of the complaint', () => {
    const subjective = (a: Assessment) =>
      buildVerbalReport(a)
        .find((s) => s.heading === 'Subjective')!
        .lines.map((l) => l.text)
        .join(' ')

    const injured = populated()
    expect(subjective(injured)).toContain('The mechanism of injury is Ground-level fall')

    const ill = populated()
    ill.chiefComplaint.nature = 'illness'
    ill.chiefComplaint.mechanism = 'Two days of worsening abdominal pain'
    const illText = subjective(ill)
    expect(illText).toContain('The history of present illness is Two days of worsening')
    expect(illText).not.toContain('mechanism of injury')

    const unset = populated()
    unset.chiefComplaint.nature = null
    expect(subjective(unset)).toContain('The mechanism or onset is Ground-level fall')
  })

  it('marks blanks rather than hiding them', () => {
    const a = newAssessment()
    const lines = buildVerbalReport(a).flatMap((s) => s.lines)
    expect(lines.some((l) => l.incomplete)).toBe(true)
    expect(lines.some((l) => l.text.includes('____'))).toBe(true)
  })

  it('states the spine conclusion from the assessment', () => {
    const a = populated()
    a.spinal.mechanism = 'no'
    const text = buildVerbalReport(a)
      .find((s) => s.heading === 'Assessment')!
      .lines[0]
    expect(text.text).toContain('is not a possible spine injury')
    expect(text.incomplete).toBe(false)
  })

  it('speaks findings without punctuation or a doubled site', () => {
    const a = newAssessment()
    a.findings = [
      { id: 'f1', region: 'Chest', description: 'Point source tenderness along R chest', treated: false },
      { id: 'f2', region: 'R forearm', description: 'Abrasions', treated: false },
    ]
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[0].text

    // the description already said "chest", so the region is not repeated
    expect(text).toBe(
      'Head to toe: Point source tenderness along R chest. Abrasions on the right forearm.',
    )
    // the old form, and the laterality it destroyed
    expect(text).not.toContain('chest:')
    expect(text).not.toContain('r forearm')
  })

  it('keeps findings apart when the descriptions contain commas', () => {
    const a = newAssessment()
    a.findings = [
      { id: 'f1', region: 'Chest', description: 'Right side of chest, point source tenderness, abrasions', treated: false },
      { id: 'f2', region: 'R forearm', description: 'Bruising', treated: false },
    ]
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[0].text

    // a comma inside a description must not read as the break between findings
    expect(text).toBe(
      'Head to toe: Right side of chest, point source tenderness, abrasions. ' +
        'Bruising on the right forearm.',
    )
  })

  it('does not name a site the description already gave', () => {
    const a = newAssessment()
    a.findings = [
      { id: 'f1', region: 'Back / Spine', description: 'Swelling and abrasions on upper right back', treated: false },
    ]
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[0].text

    expect(text).toBe('Head to toe: Swelling and abrasions on upper right back.')
    expect(text).not.toContain('on the back / spine')
  })

  it('does not treat a shared qualifier as having placed the finding', () => {
    const a = newAssessment()
    a.findings = [
      { id: 'f1', region: 'R forearm', description: 'Abrasions to the right side', treated: false },
      // "forearm" must not count as having mentioned the "arm"
      { id: 'f2', region: 'R upper arm', description: 'Tenderness near the forearm', treated: false },
    ]
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[0].text

    expect(text).toContain('Abrasions to the right side on the right forearm')
    expect(text).toContain('Tenderness near the forearm on the right upper arm')
  })

  it('expands laterality and abdominal quadrants for the radio', () => {
    const a = newAssessment()
    a.findings = [
      { id: 'f1', region: 'L knee', description: 'Swelling', treated: false },
      { id: 'f2', region: 'Abdomen RUQ', description: 'Guarding', treated: false },
    ]
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[0].text
    expect(text).toContain('Swelling on the left knee')
    expect(text).toContain('Guarding on the right upper quadrant')
  })

  it('keeps acronyms in a finding intact', () => {
    const a = newAssessment()
    a.findings = [{ id: 'f1', region: 'R hand', description: 'CSM intact', treated: false }]
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[0].text
    expect(text).toContain('CSM intact on the right hand')
    expect(text).not.toContain('cSM')
  })

  it('does not repeat a SAMPLE label the answer already contains', () => {
    const a = newAssessment()
    a.sample = {
      symptoms: '',
      allergies: 'No known allergies',
      medications: 'No medications',
      pastHistory: 'No pertinent past medical history',
      lastIntakeOutput: 'Normal ins/outs',
      events: 'No medical issues preceded crash',
    }
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[2].text

    // each element is its own sentence, so the eye has somewhere to land
    expect(text).toBe(
      'SAMPLE history: No known allergies. No medications. No pertinent past medical history. ' +
        'Normal ins/outs. No medical issues preceded crash.',
    )
    expect(text).not.toContain('allergies No known')
    expect(text).not.toContain(';')
  })

  it('does not double a full stop the responder already typed', () => {
    const a = newAssessment()
    a.sample = { ...a.sample, allergies: 'No known allergies.', medications: 'None.' }
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[2].text
    // a bare "None" takes the element's name — "Taking None" helps nobody
    expect(text).toBe('SAMPLE history: No known allergies. Medications: none.')
    expect(text).not.toContain('..')
    expect(text).not.toContain('Taking None')
  })

  it('gives a bare SAMPLE answer something to hang on', () => {
    const a = newAssessment()
    a.sample = {
      symptoms: '',
      allergies: 'Penicillin',
      medications: 'Lisinopril',
      pastHistory: 'Hypertension',
      lastIntakeOutput: 'Breakfast at 0800',
      events: 'Fell while scrambling',
    }
    const text = buildVerbalReport(a).find((s) => s.heading === 'Objective')!.lines[2].text

    // the responder's own capitalisation survives — lowercasing a value would
    // mangle brand names like Tylenol, and the stem already opens the clause
    expect(text).toContain('Allergic to Penicillin')
    expect(text).toContain('Taking Lisinopril')
    expect(text).toContain('History of Hypertension')
    expect(text).toContain('Last intake and output was Breakfast at 0800')
    // events carry their own narrative and take no stem
    expect(text).toContain('Fell while scrambling')
  })

  it('reports a confirmed-clear survey as a positive finding', () => {
    const a = newAssessment()
    a.headToToeClear = true
    const objective = buildVerbalReport(a).find((s) => s.heading === 'Objective')!
    expect(objective.lines[0].text).toContain('No abnormal findings')
    expect(objective.lines[0].incomplete).toBe(false)
  })
})

describe('report branding', () => {
  it('puts the mark in the banner', () => {
    const html = renderReport(populated())
    expect(html).toContain('class="mark"')
    // the pulse trace is knocked out of the pin, so it must stay white
    expect(html).toContain('stroke="#fff"')
  })

  it('keeps the banner readable when photocopied', () => {
    // solid black mark, no colour to lose in greyscale
    expect(renderReport(populated())).toContain('fill="#000"')
  })
})

describe('evacuation and problem list', () => {
  it('reads the evacuation as a sentence, not a list of fields', () => {
    const plan = buildVerbalReport(populated())
      .find((s) => s.heading === 'Plan')!
      .lines.map((l) => l.text)
    expect(plan).toContain(
      'Our evacuation plan is a non-urgent ground evacuation to Schultz TH by litter carry.',
    )
  })

  it('states a release as its own conclusion rather than an evacuation', () => {
    const a = populated()
    a.evacuation.mode = 'none — patient released'
    const plan = buildVerbalReport(a).find((s) => s.heading === 'Plan')!
    const text = plan.lines.map((l) => l.text).join(' ')
    expect(text).toContain('The patient is being released on scene.')
    expect(text).not.toContain('evacuation plan is a')
  })

  it('handles a bivouac without pretending it is an evacuation', () => {
    const a = populated()
    a.evacuation.mode = 'bivouac in place'
    a.evacuation.method = 'shelter below the ridge overnight'
    const text = buildVerbalReport(a).find((s) => s.heading === 'Plan')!.lines.map((l) => l.text).join(' ')
    expect(text).toContain('We plan to bivouac in place: shelter below the ridge overnight.')
  })

  it('fills the support and monitoring lines that used to be permanent blanks', () => {
    const text = buildVerbalReport(populated())
      .find((s) => s.heading === 'Plan')!
      .lines.map((l) => l.text)
      .join(' ')
    expect(text).toContain('Litter team of six, extra light')
    expect(text).toContain('We will monitor for Pain control on the carry')
  })

  it('speaks the problem list, not the running notes', () => {
    const a = populated()
    a.notes = 'notes-marker'
    const text = buildVerbalReport(a).find((s) => s.heading === 'Assessment')!.lines.map((l) => l.text).join(' ')
    expect(text).toContain('Probable distal radius fracture; Mild dehydration')
    expect(text).not.toContain('notes-marker')
  })

  it('joins multi-line entry with semicolons so it reads aloud', () => {
    const a = populated()
    a.evacuation.anticipatedProblems = '- Hypothermia on the carry\n- Pain control'
    const text = buildVerbalReport(a).find((s) => s.heading === 'Plan')!.lines.map((l) => l.text).join(' ')
    expect(text).toContain('Hypothermia on the carry; Pain control')
  })

  it('gives the printed report its own Assessment section', () => {
    const html = renderReport(populated())
    expect(html).toContain('<h2>Assessment — problem list</h2>')
    expect(html).toContain('Probable distal radius fracture')
  })

  it('prints evacuation mode and priority as one readable phrase', () => {
    const html = renderReport(populated())
    expect(html).toContain('non-urgent ground')
    expect(html).toContain('Schultz TH')
    expect(html).toContain('Litter team of six')
  })
})

describe('units and clock', () => {
  it('prints temperature in Fahrenheit', () => {
    const html = renderReport(populated())
    expect(html).toContain('98°F')
    expect(html).not.toContain('°C')
  })

  it('speaks temperature without naming a scale', () => {
    const a = populated()
    // the verbal report reads the most recent set, so put it there
    a.vitals[a.vitals.length - 1].temperatureF = 98
    const text = buildVerbalReport(a)
      .find((s) => s.heading === 'Objective')!
      .lines.map((l) => l.text)
      .join(' ')
    expect(text).toContain('temperature 98 degrees')
    expect(text).not.toContain('Celsius')
  })

  it('uses 24-hour times throughout the report', () => {
    const a = populated()
    a.startedAt = new Date(2026, 7, 30, 16, 45).getTime()
    a.vitals[0].takenAt = a.startedAt
    const html = renderReport(a)
    expect(html).toContain('16:45')
    expect(html).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i)
  })
})
