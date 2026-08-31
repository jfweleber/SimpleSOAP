import { registerPlugin } from '@capacitor/core'
import type { Assessment } from '../model/types'
import { renderReport } from './template'
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
 * On the web build there is no native plugin, so the report opens in a new
 * window and the browser's own print dialog takes over — same document,
 * same stylesheet.
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
    printInBrowser(html)
  }
}

function isPluginMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not implemented|unimplemented|not available/i.test(message)
}

/**
 * Print from a hidden iframe rather than a new window.
 *
 * Mobile browsers block popups opened outside a direct click, and the export
 * happens after an await. An iframe is same-document, so nothing can block it,
 * and the browser's own print dialog offers Save as PDF.
 */
function printInBrowser(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    throw new Error('Could not prepare the report for printing.')
  }

  doc.open()
  doc.write(html)
  doc.close()

  const go = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } finally {
      // leave it long enough for the dialog to take its snapshot
      setTimeout(() => frame.remove(), 60_000)
    }
  }

  if (doc.readyState === 'complete') go()
  else frame.addEventListener('load', go, { once: true })
}

/** The report markup, for previewing inside the app. */
export { renderReport }
