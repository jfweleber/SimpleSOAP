import { registerPlugin } from '@capacitor/core'
import type { Assessment } from '../model/types'
import { renderReport, reportBody, reportStyles } from './template'
import type { ReportOptions } from './template'

interface PdfPluginApi {
  print(options: { html: string; jobName?: string }): Promise<void>
}

const Pdf = registerPlugin<PdfPluginApi>('Pdf')

function jobNameFor(a: Assessment): string {
  const who = a.patient.name.trim() || 'Unknown'
  const when = new Date(a.startedAt).toISOString().slice(0, 10)
  // print job name becomes the default PDF filename
  return `SOAP ${who} ${when}`.replace(/[\\/:*?"<>|]/g, '-')
}

/**
 * Hand the report to Android's print dialog, where it can be saved as a PDF
 * or sent to a printer.
 *
 * On the web build there is no native plugin, so the report is printed from
 * the page itself and the browser's own print dialog takes over — same
 * markup, same stylesheet.
 */
export async function exportReport(
  assessment: Assessment,
  options: ReportOptions = {},
): Promise<void> {
  const html = renderReport(assessment, options)
  const jobName = jobNameFor(assessment)

  try {
    await Pdf.print({ html, jobName })
  } catch (error) {
    if (!isPluginMissing(error)) throw error
    printInBrowser(assessment, options, jobName)
  }
}

function isPluginMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not implemented|unimplemented|not available/i.test(message)
}

const PRINT_ID = 'soap-print'

/**
 * Print the report by putting it into the page that is already open.
 *
 * The obvious approach — render into a hidden iframe and call print() on it —
 * works in Chromium and Gecko and silently does the wrong thing in WebKit:
 * iOS Safari ignores the frame and prints the top-level document, so what came
 * out of an iPhone was a paginated screenshot of the assessment screen. Every
 * browser on iOS is WebKit, so that is all of them.
 *
 * So the report goes into the top-level document instead, styles scoped to its
 * own container, with everything else hidden for print only. One code path for
 * all three targets, and nothing on screen changes.
 */
function printInBrowser(a: Assessment, options: ReportOptions, jobName: string): void {
  document.getElementById(PRINT_ID)?.remove()

  const host = document.createElement('div')
  host.id = PRINT_ID
  host.setAttribute('aria-hidden', 'true')
  host.innerHTML = `<style>
    @media screen { #${PRINT_ID} { display: none; } }
    @media print {
      html, body {
        height: auto !important; background: #fff !important;
        margin: 0 !important; padding: 0 !important; overflow: visible !important;
      }
      body > *:not(#${PRINT_ID}) { display: none !important; }
    }
    ${reportStyles(`#${PRINT_ID}`)}
  </style>${reportBody(a, options)}`

  document.body.appendChild(host)

  // the document title is what the browser offers as the PDF filename
  const title = document.title
  document.title = jobName

  const clean = () => {
    host.remove()
    document.title = title
  }
  window.addEventListener('afterprint', clean, { once: true })
  // afterprint is unreliable in WebKit, so the node cannot be left to it alone
  setTimeout(clean, 60_000)

  window.print()
}

/** The report markup, for previewing inside the app. */
export { renderReport }
