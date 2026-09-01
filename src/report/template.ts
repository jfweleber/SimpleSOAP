/**
 * SOAP note report.
 *
 * Rendered as HTML and handed to Android's print engine, so page breaks,
 * repeated table headers and margins are the platform's problem rather than
 * ours. Everything here is print-first: no colour that fails in greyscale, no
 * layout that depends on a viewport width.
 */

import type { Assessment, VitalSet } from '../model/types'
import { BODY_REGIONS, mechanismLabel, spinalVerdict } from '../model/types'
import { BODY_VIEWBOX, BODY_ZONES, OFF_DIAGRAM_REGION, zoneToSvg } from '../ui/bodyZones'
import { describeLocation } from '../model/location'
import { dateTimeText, hhmm } from '../format/time'

const escapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => escapeMap[c])
}

/** Free text to HTML, preserving the responder's line breaks. */
function text(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '<span class="sr-none">—</span>'
  return esc(trimmed).replace(/\n/g, '<br>')
}

const clockTime = hhmm
const dateTime = dateTimeText

/** Skin colour / temperature / moisture, the way it is spoken and charted. */
function sctm(v: VitalSet): string {
  const parts = [v.skinColor, v.skinTemp, v.skinMoisture].filter(Boolean)
  return parts.length ? esc(parts.join(', ')) : '—'
}

/**
 * A hand-felt pulse is not a blood pressure, so it never renders as a number
 * over a number. With no cuff it stands alone in the column; alongside a
 * reading it is a parenthetical.
 */
function bloodPressure(v: VitalSet): string {
  const felt = v.palpablePulse
  if (v.systolic === null) {
    if (!felt) return '—'
    if (felt === 'none palpable') return '<span class="sr-flag">no pulse palpable</span>'
    return `${esc(felt)} pulse<br><span class="sr-qual">no cuff</span>`
  }
  const cuff = v.bpPalpated
    ? `${v.systolic}/P`
    : `${v.systolic}/${v.diastolic === null ? '—' : v.diastolic}`
  return felt ? `${cuff} <span class="sr-qual">(${esc(felt)})</span>` : cuff
}

function pulse(v: VitalSet): string {
  if (v.heartRate === null) return '—'
  const detail = [v.pulseRhythm, v.pulseQuality].filter(Boolean).join(', ')
  return detail ? `${v.heartRate} <span class="sr-qual">(${esc(detail)})</span>` : String(v.heartRate)
}

function breath(v: VitalSet): string {
  if (v.respiratoryRate === null) return '—'
  const detail = [v.breathRhythm, v.breathQuality].filter(Boolean).join(', ')
  return detail
    ? `${v.respiratoryRate} <span class="sr-qual">(${esc(detail)})</span>`
    : String(v.respiratoryRate)
}

/** A device-sourced reading is marked so a reader knows it was not observed. */
function sourceMark(v: VitalSet): string {
  return v.source.kind === 'device' ? '<span class="sr-dev" title="from a connected device">▪</span>' : ''
}

function section(heading: string, body: string): string {
  return `<section class="sr-sec"><h2>${esc(heading)}</h2>${body}</section>`
}

function fieldRows(rows: Array<[string, string]>): string {
  const cells = rows
    .map(([label, value]) => `<div class="sr-f"><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join('')
  return `<dl class="sr-fields">${cells}</dl>`
}

function vitalsTable(a: Assessment): string {
  if (a.vitals.length === 0) return '<p class="sr-none">No vitals recorded.</p>'

  const rows = [...a.vitals]
    .sort((x, y) => x.takenAt - y.takenAt)
    .map(
      (v) => `<tr>
        <td class="sr-t">${clockTime(v.takenAt)}${sourceMark(v)}</td>
        <td>${v.responsiveness ? esc(v.responsiveness) : '—'}</td>
        <td>${pulse(v)}</td>
        <td>${breath(v)}</td>
        <td>${bloodPressure(v)}</td>
        <td>${v.spo2 === null ? '—' : `${v.spo2}%`}</td>
        <td>${sctm(v)}</td>
        <td>${v.pupils ? esc(v.pupils) : '—'}</td>
        <td>${v.temperatureF === null ? '—' : `${v.temperatureF}°F`}</td>
      </tr>`,
    )
    .join('')

  const notes = a.vitals
    .filter((v) => v.notes.trim())
    .map((v) => `<li><b>${clockTime(v.takenAt)}</b> ${esc(v.notes.trim())}</li>`)
    .join('')

  return `
    <table class="sr-vitals">
      <thead>
        <tr>
          <th>Time</th><th>LOR</th><th>Pulse</th><th>Breath</th><th>BP</th>
          <th>SpO₂</th><th>SCTM</th><th>Pupils</th><th>Temp</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${notes ? `<ul class="sr-vnotes">${notes}</ul>` : ''}`
}

/**
 * Findings grouped by region, numbered in head-to-toe order.
 *
 * The numbers are shared with the body map so a reader can go from a mark on
 * the figure to the text and back, which is how injury diagrams are read on
 * paper.
 */
function numberedFindings(a: Assessment): Array<{ n: number; region: string; items: string[] }> {
  const byRegion = new Map<string, string[]>()
  for (const f of a.findings) {
    if (!f.description.trim()) continue
    const list = byRegion.get(f.region) ?? []
    list.push(f.description.trim() + (f.treated ? ' [treated]' : ''))
    byRegion.set(f.region, list)
  }
  return BODY_REGIONS.filter((region) => byRegion.has(region)).map((region, index) => ({
    n: index + 1,
    region,
    items: byRegion.get(region) as string[],
  }))
}

/**
 * Front-view body map for print.
 *
 * Greyscale only — these get photocopied and faxed, and a colour-coded figure
 * that turns into uniform grey is worse than no figure. Regions with findings
 * are filled dark and carry their number; everything else stays a light
 * outline so the untouched areas still read as "surveyed, nothing found".
 */
function bodyMap(a: Assessment): string {
  const numbered = numberedFindings(a)
  const numberFor = new Map(numbered.map((entry) => [entry.region, entry.n]))

  const shapes = BODY_ZONES.map((zone) => {
    const n = numberFor.get(zone.region)
    const style = n
      ? 'fill="#4a4a4a" stroke="#000" stroke-width="0.8"'
      : 'fill="#f2f2f2" stroke="#9a9a9a" stroke-width="0.7"'
    return zoneToSvg(zone, style)
  }).join('')

  const badges = BODY_ZONES.map((zone) => {
    const n = numberFor.get(zone.region)
    if (!n) return ''
    return `<g><circle cx="${zone.bx}" cy="${zone.by}" r="8" fill="#fff" stroke="#000" stroke-width="1"/>` +
      `<text x="${zone.bx}" y="${zone.by + 3.4}" text-anchor="middle" font-size="10" font-weight="700" fill="#000">${n}</text></g>`
  }).join('')

  const backNumber = numberFor.get(OFF_DIAGRAM_REGION)
  const backMark = backNumber
    ? `<g><rect x="8" y="288" width="74" height="26" rx="4" fill="#4a4a4a" stroke="#000" stroke-width="0.8"/>` +
      `<circle cx="21" cy="301" r="8" fill="#fff" stroke="#000" stroke-width="1"/>` +
      `<text x="21" y="304.4" text-anchor="middle" font-size="10" font-weight="700" fill="#000">${backNumber}</text>` +
      `<text x="33" y="304.5" font-size="9" fill="#fff">Back / Spine</text></g>`
    : ''

  return `<svg viewBox="0 0 ${BODY_VIEWBOX.width} ${BODY_VIEWBOX.height}" class="sr-bodymap" role="img" aria-label="Body map of findings">
    <text x="34" y="11" text-anchor="middle" font-size="8" fill="#555" letter-spacing="0.6">PT RIGHT</text>
    <text x="186" y="11" text-anchor="middle" font-size="8" fill="#555" letter-spacing="0.6">PT LEFT</text>
    ${shapes}${badges}${backMark}
  </svg>`
}

function findingsList(a: Assessment): string {
  const numbered = numberedFindings(a)

  if (numbered.length === 0) {
    // a completed survey with nothing abnormal is a finding in its own right
    return a.headToToeClear
      ? `<div class="sr-h2t"><div class="sr-h2tFig">${bodyMap(a)}</div>` +
        `<p class="sr-confirmed">Full head-to-toe survey completed — no abnormal findings.</p></div>`
      : '<p class="sr-none">No findings recorded.</p>'
  }

  const rows = numbered
    .map(
      (entry) =>
        `<div class="sr-fnd"><span class="sr-fndN">${entry.n}</span>` +
        `<span class="sr-fndR">${esc(entry.region)}</span>` +
        `<span class="sr-fndD">${entry.items.map(esc).join('; ')}</span></div>`,
    )
    .join('')

  return `<div class="sr-h2t">
    <div class="sr-h2tFig">${bodyMap(a)}</div>
    <div class="sr-h2tList">${rows}</div>
  </div>`
}

function complaintsBlock(a: Assessment): string {
  if (a.complaints.length === 0) return ''
  const blocks = a.complaints
    .filter((c) => c.what.trim())
    .map(
      (c) => `
      <div class="sr-opqrst">
        <h3>${esc(c.what)}</h3>
        ${fieldRows([
          ['Onset', text(c.onset)],
          ['Provokes', text(c.provocation)],
          ['Palliates', text(c.palliation)],
          ['Quality', text(c.quality)],
          ['Radiation', text(c.radiation)],
          ['Severity', c.severity === null ? '—' : `${c.severity}/10`],
          ['Time', text(c.time)],
        ])}
      </div>`,
    )
    .join('')
  return blocks ? section('Complaint detail (OPQRST)', blocks) : ''
}

function treatmentsTable(a: Assessment): string {
  const rows = a.treatments.filter((t) => t.what.trim())
  if (rows.length === 0) return '<p class="sr-none">No treatments recorded.</p>'
  return `<table class="sr-grid">
    <thead><tr><th>Time</th><th>For</th><th>Treatment</th></tr></thead>
    <tbody>${rows
      .sort((x, y) => x.at - y.at)
      .map(
        (t) =>
          `<tr><td class="sr-t">${clockTime(t.at)}</td><td>${text(t.forWhat)}</td><td>${text(t.what)}</td></tr>`,
      )
      .join('')}</tbody>
  </table>`
}

function medicationsTable(a: Assessment): string {
  const rows = a.medications.filter((m) => m.name.trim())
  if (rows.length === 0) return '<p class="sr-none">No medications given.</p>'
  return `<table class="sr-grid">
    <thead><tr><th>Time</th><th>Medication</th><th>Dose</th><th>Route</th></tr></thead>
    <tbody>${rows
      .sort((x, y) => x.at - y.at)
      .map(
        (m) =>
          `<tr><td class="sr-t">${clockTime(m.at)}</td><td>${text(m.name)}</td>` +
          `<td>${m.dose.trim() ? esc(`${m.dose.trim()} ${m.doseUnit ?? ''}`.trim()) : '—'}</td>` +
          `<td>${m.route ? esc(m.route) : '—'}</td></tr>`,
      )
      .join('')}</tbody>
  </table>`
}

function spinalBlock(a: Assessment): string {
  const s = a.spinal
  const verdict = spinalVerdict(s)

  // spell out each criterion, including the ones answered negative — a
  // confirmed negative is what lets a later reader trust the conclusion
  const criterion = (label: string, value: 'yes' | 'no' | null, concerning: 'yes' | 'no') => {
    if (value === null) return `${label}: <span class="sr-none">not assessed</span>`
    const answer = value === 'yes' ? 'yes' : 'no'
    return value === concerning ? `${label}: <b>${answer}</b>` : `${label}: ${answer}`
  }

  const criteria =
    s.mechanism === 'no'
      ? [criterion('MOI for spinal injury', s.mechanism, 'yes')]
      : [
          criterion('MOI for spinal injury', s.mechanism, 'yes'),
          criterion('Patient reliable', s.reliablePatient, 'no'),
          criterion('Spine tenderness', s.spineTenderness, 'yes'),
          criterion('Motor/sensory deficit', s.neuroDeficit, 'yes'),
        ]

  const conclusion =
    verdict.code === 'protect' ? `<b class="sr-flag">${esc(verdict.label)}</b>` : esc(verdict.label)

  return fieldRows([
    ['Conclusion', conclusion],
    ['Criteria', criteria.join('<br>')],
    ['Notes', text(s.notes)],
  ])
}

/** Age / sex / weight, skipping anything not recorded. */
function patientLine(a: Assessment): string {
  const parts: string[] = []
  if (a.patient.age.trim()) parts.push(`${a.patient.age.trim()} yo`)
  if (a.patient.sex) parts.push(a.patient.sex)
  if (a.patient.weight.trim()) parts.push(`${a.patient.weight.trim()} ${a.patient.weightUnit}`)
  return parts.join(' · ')
}

/**
 * Monitor samples, as an appendix.
 *
 * Placed after the signature deliberately. These are machine readings on a
 * timer, not clinical observations, and the note should not read as though a
 * responder took a set of vitals every five minutes.
 */
function telemetryTable(a: Assessment): string {
  if (a.telemetry.length === 0) return ''

  const samples = [...a.telemetry].sort((x, y) => x.at - y.at)
  const has = {
    spo2: samples.some((t) => t.spo2 !== null),
    pi: samples.some((t) => t.perfusionIndex !== null),
    resp: samples.some((t) => t.respiratoryRate !== null),
  }

  const head =
    '<tr><th>Time</th><th>Pulse</th>' +
    (has.spo2 ? '<th>SpO₂</th>' : '') +
    (has.pi ? '<th>PI</th>' : '') +
    (has.resp ? '<th>Resp</th>' : '') +
    '<th>Source</th></tr>'

  const rows = samples
    .map(
      (t) =>
        `<tr><td class="sr-t">${clockTime(t.at)}</td>` +
        `<td>${t.heartRate === null ? '—' : t.heartRate}</td>` +
        (has.spo2 ? `<td>${t.spo2 === null ? '—' : `${t.spo2}%`}</td>` : '') +
        (has.pi ? `<td>${t.perfusionIndex === null ? '—' : t.perfusionIndex.toFixed(1)}</td>` : '') +
        (has.resp ? `<td>${t.respiratoryRate === null ? '—' : t.respiratoryRate}</td>` : '') +
        `<td>${esc(t.deviceName ?? t.adapterId)}</td></tr>`,
    )
    .join('')

  const first = samples[0].at
  const last = samples[samples.length - 1].at

  return section(
    'Appendix — streamed monitor data',
    `<p class="sr-applead">${samples.length} sample${samples.length === 1 ? '' : 's'} recorded automatically from a connected monitor between ${clockTime(first)} and ${clockTime(last)}. These are device readings, not observed vitals.</p>
     <table class="sr-grid"><thead>${head}</thead><tbody>${rows}</tbody></table>`,
  )
}

export interface ReportOptions {
  /** append the raw monitor stream after the signature */
  includeTelemetry?: boolean
}

/**
 * The report stylesheet, scoped to one selector.
 *
 * The standalone document scopes to `body`; printing inside the running app
 * scopes to a container div, because WebKit will not print an iframe (see
 * pdf.ts) and the report has to live in the page being printed.
 */
export function reportStyles(s: string): string {
  return `
  @page { size: letter; margin: 0.55in 0.5in; }
  ${s}, ${s} * { box-sizing: border-box; }
  ${s} {
    font-family: -apple-system, "Roboto", "Helvetica Neue", Arial, sans-serif;
    font-size: 9.5pt; line-height: 1.4; color: #000; margin: 0;
    -webkit-print-color-adjust: exact;
  }
  ${s} .sr-banner {
    border-bottom: 2px solid #000; padding-bottom: 6pt; margin-bottom: 10pt;
    display: flex; justify-content: space-between; align-items: flex-end;
  }
  ${s} .sr-banner h1 { font-size: 16pt; margin: 0; letter-spacing: -0.01em; }
  ${s} .sr-banner .sr-who { display: flex; gap: 8pt; align-items: center; }
  ${s} .sr-banner .sr-mark { width: 26pt; height: 26pt; flex: none; }
  ${s} .sr-banner .sr-meta { text-align: right; font-size: 8pt; line-height: 1.5; }
  ${s} .sr-practice {
    border: 1.5pt solid #000; padding: 3pt 6pt; font-weight: 700;
    font-size: 9pt; text-align: center; margin-bottom: 8pt; letter-spacing: 0.06em;
  }
  ${s} .sr-sec { margin-bottom: 11pt; page-break-inside: avoid; }
  ${s} .sr-sec h2 {
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.09em;
    border-bottom: 0.75pt solid #000; padding-bottom: 2pt; margin: 0 0 5pt;
  }
  ${s} .sr-sec h3 { font-size: 10pt; margin: 7pt 0 3pt; }
  ${s} .sr-fields { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2pt 14pt; margin: 0; }
  ${s} .sr-fields.sr-wide { grid-template-columns: 1fr; }
  ${s} .sr-f { display: flex; gap: 6pt; break-inside: avoid; }
  ${s} .sr-f dt { font-weight: 700; min-width: 74pt; flex: none; }
  ${s} .sr-f dd { margin: 0; flex: 1; }
  ${s} .sr-none { color: #666; }
  ${s} .sr-confirmed { margin: 0; font-weight: 600; }
  ${s} .sr-applead { font-size: 8pt; color: #333; margin: 0 0 4pt; max-width: none; }
  ${s} .sr-h2t { display: flex; gap: 12pt; align-items: flex-start; page-break-inside: avoid; }
  ${s} .sr-h2tFig { flex: none; width: 118pt; }
  ${s} .sr-bodymap { width: 100%; height: auto; }
  ${s} .sr-h2tList { flex: 1; display: flex; flex-direction: column; gap: 3pt; padding-top: 2pt; }
  ${s} .sr-fnd { display: flex; gap: 5pt; align-items: baseline; break-inside: avoid; }
  ${s} .sr-fndN {
    flex: none; width: 13pt; height: 13pt; border: 0.75pt solid #000; border-radius: 50%;
    text-align: center; font-weight: 700; font-size: 7.5pt; line-height: 12pt;
  }
  ${s} .sr-fndR { flex: none; font-weight: 700; min-width: 62pt; }
  ${s} .sr-fndD { flex: 1; }
  ${s} .sr-flag { text-decoration: underline; }
  ${s} table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  ${s} thead { display: table-header-group; }
  ${s} tr { page-break-inside: avoid; }
  ${s} th, ${s} td { border: 0.5pt solid #999; padding: 2.5pt 4pt; text-align: left; vertical-align: top; }
  ${s} th { background: #e8e8e8; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; }
  ${s} td.sr-t { white-space: nowrap; font-variant-numeric: tabular-nums; }
  ${s} .sr-qual { color: #444; font-size: 7.5pt; }
  ${s} .sr-dev { margin-left: 3pt; }
  ${s} .sr-vnotes { margin: 5pt 0 0; padding-left: 12pt; font-size: 8.5pt; }
  ${s} .sr-opqrst { margin-bottom: 6pt; page-break-inside: avoid; }
  ${s} .sr-sig { margin-top: 16pt; border-top: 0.75pt solid #000; padding-top: 6pt;
         display: flex; justify-content: space-between; font-size: 8pt; }
  ${s} .sr-foot { margin-top: 10pt; font-size: 7.5pt; color: #444; text-align: center;
          border-top: 0.5pt solid #ccc; padding-top: 4pt; }`
}

/** The report markup itself, with no document scaffolding around it. */
export function reportBody(a: Assessment, options: ReportOptions = {}): string {
  const status = a.finalizedAt
    ? `Finalized ${dateTime(a.finalizedAt)}`
    : 'DRAFT — not finalized'

  return `

<div class="sr-banner">
  <div class="sr-who">
    <svg class="sr-mark" viewBox="8 10 92 88" aria-hidden="true">
      <path d="M54 16 c-16 0 -28 12 -28 27 c0 19 22 38 28 49 c6 -11 28 -30 28 -49 c0 -15 -12 -27 -28 -27 Z" fill="#000"/>
      <path d="M39 43 H47 L50 35 L55 53 L59 43 H69" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div>
    <h1>${esc(a.patient.name.trim() || 'Name unknown')}</h1>
    <div>${esc(patientLine(a)) || '&nbsp;'}</div>
    </div>
  </div>
  <div class="sr-meta">
    <b>SOAP Note</b><br>
    Care started ${dateTime(a.startedAt)}<br>
    ${a.handoffAt ? `Handoff ${dateTime(a.handoffAt)}<br>` : ''}
    ${esc(status)}
  </div>
</div>

${a.practice ? '<div class="sr-practice">PRACTICE — NOT A REAL PATIENT OR INCIDENT</div>' : ''}
${a.careRefusedAt ? `<div class="sr-practice">CARE REFUSED AT ${clockTime(a.careRefusedAt)}</div>` : ''}

${
  a.patient.emergencyContact.trim()
    ? section('Emergency contact', `<div>${text(a.patient.emergencyContact)}</div>`)
    : ''
}

${
  describeLocation(a.location)
    ? section('Incident location', `<div>${text(describeLocation(a.location))}</div>`)
    : ''
}

${section(
  'Chief complaint',
  fieldRows([
    ['Complaint', text(a.chiefComplaint.summary)],
    ['Nature', a.chiefComplaint.nature ? esc(a.chiefComplaint.nature) : '—'],
    ['Incident time', dateTime(a.chiefComplaint.incidentAt)],
    [mechanismLabel(a.chiefComplaint.nature), text(a.chiefComplaint.mechanism)],
  ]),
)}

${complaintsBlock(a)}

${section(
  'History (SAMPLE)',
  fieldRows([
    ['Symptoms', text(a.sample.symptoms)],
    ['Allergies', text(a.sample.allergies)],
    ['Medications', text(a.sample.medications)],
    ['Past history', text(a.sample.pastHistory)],
    ['Last in/out', text(a.sample.lastIntakeOutput)],
    ['Events', text(a.sample.events)],
  ]),
)}

${section('Vitals', vitalsTable(a))}

${section('Head to toe', findingsList(a))}

${section('Spinal assessment', spinalBlock(a))}

${section(
  'Assessment — problem list',
  a.problems.trim() ? `<div>${text(a.problems)}</div>` : '<p class="sr-none">No problem list recorded.</p>',
)}

${section('Treatments', treatmentsTable(a))}

${section('Medications given', medicationsTable(a))}

${section(
  'Evacuation plan',
  fieldRows([
    [
      'Evacuation',
      [a.evacuation.priority, a.evacuation.mode].filter(Boolean).join(' ') || '—',
    ],
    ['Destination', text(a.evacuation.destination)],
    ['Method', text(a.evacuation.method)],
    ['Support requested', text(a.evacuation.supportRequested)],
    ['Anticipated problems', text(a.evacuation.anticipatedProblems)],
  ]),
)}

${section('Notes', `<div>${text(a.notes)}</div>`)}

<div class="sr-sig">
  <div>Attending provider: <b>${esc(a.attendingProvider.trim() || '________________________')}</b></div>
  <div>Signature: ________________________</div>
</div>

${options.includeTelemetry ? telemetryTable(a) : ''}

<div class="sr-foot">
  Recorded with SimpleSOAP · ▪ marks a reading captured from a connected device ·
  Generated ${dateTime(Date.now())}
</div>
`
}

export function renderReport(a: Assessment, options: ReportOptions = {}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>SOAP Note — ${esc(a.patient.name.trim() || 'Name unknown')}</title>
<style>${reportStyles('body')}</style></head>
<body>${reportBody(a, options)}</body></html>`
}
