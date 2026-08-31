/**
 * Attachment rules for a live monitor.
 *
 * These encode a patient-safety decision, not a UI convenience: an orphaned
 * connection must start recording as soon as there is somewhere to put the
 * readings, and a connection already recording to one patient must never be
 * moved to another without someone saying so.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectHandlers } from './session'

const appendTelemetry = vi.fn(async () => {})

vi.mock('../model/store', () => ({
  appendTelemetry: (...args: unknown[]) => appendTelemetry(...(args as [])),
}))

/** Handlers the session hands to the transport, so a test can push a reading. */
let handlers: ConnectHandlers | null = null

vi.mock('./session', () => ({
  connect: vi.fn(async (_device: unknown, adapter: unknown, h: ConnectHandlers) => {
    handlers = h
    return {
      deviceId: 'dev-1',
      adapter,
      resubscribe: async () => {},
      disconnect: async () => {},
    }
  }),
  connectAndResolve: vi.fn(),
}))

import * as session from './monitorSession'

const adapter = { id: 'hr', name: 'Heart rate monitor' } as never
const device = { id: 'dev-1', name: 'HR-500' } as never

beforeEach(async () => {
  vi.useFakeTimers()
  await session.start(device, adapter)
})

afterEach(async () => {
  await session.stop()
  vi.useRealTimers()
  appendTelemetry.mockClear()
  handlers = null
})

describe('adoptIfUnattached', () => {
  it('adopts a note when the monitor was connected before it existed', () => {
    expect(session.getSnapshot().assessmentId).toBeNull()

    expect(session.adoptIfUnattached('note-1', 'Casey R')).toBe(true)
    expect(session.getSnapshot().assessmentId).toBe('note-1')
    expect(session.getSnapshot().assessmentLabel).toBe('Casey R')
  })

  it('never moves a monitor already recording to another patient', () => {
    session.adoptIfUnattached('note-1', 'Casey R')

    expect(session.adoptIfUnattached('note-2', 'Other patient')).toBe(false)
    expect(session.getSnapshot().assessmentId).toBe('note-1')
    expect(session.getSnapshot().assessmentLabel).toBe('Casey R')
  })

  it('leaves a deliberate switch to the responder', () => {
    session.adoptIfUnattached('note-1', 'Casey R')
    session.attachTo('note-2', 'Other patient')
    expect(session.getSnapshot().assessmentId).toBe('note-2')
  })

  it('does nothing without a connection', async () => {
    await session.stop()
    expect(session.adoptIfUnattached('note-1', 'Casey R')).toBe(false)
    expect(session.getSnapshot().assessmentId).toBeNull()
  })

  it('an orphaned connection records nothing until it is adopted', () => {
    handlers?.onMeasurement({ heartRate: 72, spo2: 98 } as never)
    vi.advanceTimersByTime(10 * 60_000)
    expect(appendTelemetry).not.toHaveBeenCalled()
  })

  it('starts sampling into the note on adoption', () => {
    handlers?.onMeasurement({ heartRate: 72, spo2: 98 } as never)
    session.adoptIfUnattached('note-1', 'Casey R')

    // the first sample polls until a reading exists rather than waiting out
    // the full interval — a responder should not stare at an empty list
    vi.advanceTimersByTime(2_000)

    expect(appendTelemetry).toHaveBeenCalledTimes(1)
    const [id, samples] = appendTelemetry.mock.calls[0] as unknown as [string, Array<{ heartRate: number }>]
    expect(id).toBe('note-1')
    expect(samples[0].heartRate).toBe(72)
    expect(session.getSnapshot().recorded).toBe(1)
  })
})
