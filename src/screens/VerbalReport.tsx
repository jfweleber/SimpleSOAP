import { useState } from 'react'
import type { Assessment } from '../model/types'
import { buildVerbalReport, verbalReportText } from '../report/verbal'

/**
 * The radio script, sized to be read aloud.
 *
 * Deliberately large type and generous line spacing — this is read off a
 * screen held in one hand, often in bad light, while talking. Anything still
 * blank is marked rather than hidden, so you can fill it from memory instead
 * of transmitting a sentence with a hole in it.
 */
export function VerbalReportScreen({
  assessment,
  onBack,
}: {
  assessment: Assessment
  onBack: () => void
}) {
  const sections = buildVerbalReport(assessment)
  const [copied, setCopied] = useState(false)
  const gaps = sections.reduce((n, s) => n + s.lines.filter((l) => l.incomplete).length, 0)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verbalReportText(assessment))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="screen verbal">
      <header className="apphead">
        <button className="link" onClick={onBack}>
          ‹ Back
        </button>
        <b>Verbal report</b>
        <button className="link" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>

      {gaps > 0 && (
        <div className="alert soft">
          {gaps} blank{gaps === 1 ? '' : 's'} marked <b>____</b> — fill them as you transmit, or go
          back and complete the note.
        </div>
      )}

      {sections.map((section) => (
        <section key={section.heading} className="vsec">
          <h2>
            {section.heading}
            {section.hint && <span className="vhint">{section.hint}</span>}
          </h2>
          {section.lines.map((l, i) => (
            <p key={i} className={l.incomplete ? 'vline gap' : 'vline'}>
              {l.text}
            </p>
          ))}
        </section>
      ))}

      <p className="empty">
        Vitals are the most recent set you recorded. Take a fresh set before transmitting if these
        have gone stale.
      </p>
    </main>
  )
}
