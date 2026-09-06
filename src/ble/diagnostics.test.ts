/**
 * The diagnostic report is read by whoever is decoding a wire format from it,
 * so it has to carry the full UUIDs and the bytes exactly as received.
 */

import { describe, expect, it } from 'vitest'
import { diagnosticReport } from './diagnostics'

const ISSC = '49535343-fe7d-4ae5-8fa9-9fafd205e455'
const NOTIFY = '49535343-1e4d-4bd9-ba61-23c647249616'

describe('diagnostic report', () => {
  it('lists services, characteristics and frames in full', () => {
    const text = diagnosticReport({
      device: 'BM1000C-O',
      framesSeen: 24,
      now: Date.UTC(2026, 8, 6, 16, 41, 0),
      services: [
        {
          uuid: ISSC,
          label: null,
          characteristics: [
            { uuid: NOTIFY, properties: ['notify'], canNotify: true, canRead: false },
          ],
        },
      ],
      frames: [
        { at: Date.UTC(2026, 8, 6, 16, 41, 7, 123), service: ISSC, characteristic: NOTIFY, hex: '83 07 47 61 53', length: 5 },
      ],
    })

    expect(text).toContain('BM1000C-O — 2026-09-06T16:41:00.000Z')
    expect(text).toContain('24 frames on the expected characteristic')
    expect(text).toContain(`Unknown service  ${ISSC}`)
    expect(text).toContain(`    ${NOTIFY}  notify`)
    expect(text).toContain(`2026-09-06T16:41:07.123Z  ${NOTIFY}  5B  83 07 47 61 53`)
  })

  it('says when the services were never read', () => {
    const text = diagnosticReport({ device: 'x', framesSeen: 0, services: null, frames: [] })
    expect(text).toContain('(not read)')
    expect(text).toContain('Raw frames, newest first (0)')
  })
})
