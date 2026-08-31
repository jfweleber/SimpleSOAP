/**
 * The live monitor connection, held outside the React tree.
 *
 * A connected monitor has to survive navigation. The whole point of timed
 * sampling is that the responder connects a device and then goes on to
 * document the patient — if the link dropped every time they left the monitor
 * screen, sampling would only ever work while they sat and watched it.
 *
 * So the connection, the latest reading and the sampling timer live here, and
 * screens subscribe to the state rather than owning it.
 */

import type { Adapter, Measurement, ScannedDevice } from './types'
import type { Connection } from './session'
import * as ble from './session'
import * as store from '../model/store'
import type { TelemetrySample } from '../model/types'

/** How often a connected monitor is sampled into the record. */
export const SAMPLE_INTERVAL_MS = 5 * 60_000
/** How often we retry the first sample until a reading exists. */
const FIRST_SAMPLE_POLL_MS = 2_000

export interface MonitorState {
  connection: Connection | null
  deviceName: string | null
  latest: Measurement | null
  /** decoded readings since connecting */
  readings: number
  /** raw frames, decoded or not — distinguishes silent from undecodable */
  frames: number
  /** assessment receiving samples, if any */
  assessmentId: string | null
  assessmentLabel: string | null
  recorded: number
  lastRecordedAt: number | null
  error: string | null
}

const IDLE: MonitorState = {
  connection: null,
  deviceName: null,
  latest: null,
  readings: 0,
  frames: 0,
  assessmentId: null,
  assessmentLabel: null,
  recorded: 0,
  lastRecordedAt: null,
  error: null,
}

let state: MonitorState = IDLE
const listeners = new Set<() => void>()

let intervalTimer: ReturnType<typeof setInterval> | null = null
let firstSampleTimer: ReturnType<typeof setInterval> | null = null

function emit(changes: Partial<MonitorState>) {
  state = { ...state, ...changes }
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): MonitorState {
  return state
}

export function isActive(): boolean {
  return state.connection !== null
}

/** Turn the current reading into a stored sample. Returns false if there is nothing worth storing. */
export function captureSample(): boolean {
  const { latest, connection, assessmentId } = state
  if (!latest || !connection || !assessmentId) return false

  const hasValue =
    latest.heartRate !== null ||
    latest.spo2 !== null ||
    latest.perfusionIndex !== null ||
    latest.respiratoryRate !== null
  if (!hasValue) return false

  const sample: TelemetrySample = {
    at: Date.now(),
    heartRate: latest.heartRate,
    spo2: latest.spo2,
    perfusionIndex: latest.perfusionIndex,
    respiratoryRate: latest.respiratoryRate,
    adapterId: connection.adapter.id,
    deviceName: connection.adapter.name,
  }

  store.appendTelemetry(assessmentId, [sample]).catch(() => {})
  emit({ recorded: state.recorded + 1, lastRecordedAt: sample.at })
  return true
}

function startSampling() {
  stopSampling()
  // the first sample waits for a reading to exist rather than firing on
  // connect, so the record does not open with a blank row
  firstSampleTimer = setInterval(() => {
    if (captureSample()) stopFirstSamplePoll()
  }, FIRST_SAMPLE_POLL_MS)
  intervalTimer = setInterval(() => captureSample(), SAMPLE_INTERVAL_MS)
}

function stopFirstSamplePoll() {
  if (firstSampleTimer) clearInterval(firstSampleTimer)
  firstSampleTimer = null
}

function stopSampling() {
  stopFirstSamplePoll()
  if (intervalTimer) clearInterval(intervalTimer)
  intervalTimer = null
}

export interface StartOptions {
  assessmentId?: string
  assessmentLabel?: string
}

export async function start(
  device: ScannedDevice,
  adapter: Adapter,
  options: StartOptions = {},
): Promise<void> {
  await stop()

  const connection = await ble.connect(device, adapter, {
    onMeasurement: (m) => emit({ latest: m, readings: state.readings + 1 }),
    onFrame: () => emit({ frames: state.frames + 1 }),
    onDisconnect: () => {
      stopSampling()
      emit({ ...IDLE, error: 'Monitor disconnected.' })
    },
  })

  emit({
    connection,
    deviceName: device.name ?? adapter.name,
    latest: null,
    readings: 0,
    frames: 0,
    assessmentId: options.assessmentId ?? null,
    assessmentLabel: options.assessmentLabel ?? null,
    recorded: 0,
    lastRecordedAt: null,
    error: null,
  })

  if (options.assessmentId) startSampling()
}

/**
 * Point an existing connection at an assessment.
 *
 * A monitor is often connected before the responder opens the note it should
 * record into — or connected from the home screen entirely. Without this the
 * link would stay live but orphaned, streaming to nothing.
 */
export function attachTo(assessmentId: string, assessmentLabel: string): void {
  if (!state.connection) return
  if (state.assessmentId === assessmentId) return
  emit({ assessmentId, assessmentLabel, recorded: 0, lastRecordedAt: null })
  startSampling()
}

/**
 * Adopt a note with a connection that is not recording anywhere yet.
 *
 * The monitor usually goes on the patient before there is a note to put the
 * readings in — clip the probe, get a trace, then start documenting. Until now
 * that connection stayed orphaned: live on screen, streaming to nothing, with
 * no reason for the responder to suspect the samples were not being kept.
 *
 * Only an unattached connection is adopted. A monitor already recording to
 * another patient is never moved silently — on a multi-patient scene that
 * would file one patient's vitals under another, which is worse than
 * recording nothing at all. That switch stays a deliberate act.
 */
export function adoptIfUnattached(assessmentId: string, assessmentLabel: string): boolean {
  if (!state.connection) return false
  if (state.assessmentId !== null) return false
  attachTo(assessmentId, assessmentLabel)
  return true
}

/** Stop recording into a note without dropping the connection. */
export function detach(): void {
  stopSampling()
  emit({ assessmentId: null, assessmentLabel: null })
}

/**
 * Connect to a device whose capabilities are not known yet.
 *
 * The browser's device chooser reports no advertisement data, so the adapter
 * can only be worked out after connecting — and that has to happen on the same
 * connection that goes on to stream.
 */
export async function startResolving(
  device: ScannedDevice,
  options: StartOptions = {},
): Promise<{ ok: true } | { ok: false; services: string[] }> {
  await stop()

  const resolved = await ble.connectAndResolve(device, {
    onMeasurement: (m) => emit({ latest: m, readings: state.readings + 1 }),
    onFrame: () => emit({ frames: state.frames + 1 }),
    onDisconnect: () => {
      stopSampling()
      emit({ ...IDLE, error: 'Monitor disconnected.' })
    },
  })

  if (!resolved.connection) return { ok: false, services: resolved.services }

  emit({
    connection: resolved.connection,
    deviceName: device.name ?? resolved.adapter?.name ?? null,
    latest: null,
    readings: 0,
    frames: 0,
    assessmentId: options.assessmentId ?? null,
    assessmentLabel: options.assessmentLabel ?? null,
    recorded: 0,
    lastRecordedAt: null,
    error: null,
  })

  if (options.assessmentId) startSampling()
  return { ok: true }
}

export async function stop(): Promise<void> {
  stopSampling()
  const current = state.connection
  if (current) await current.disconnect().catch(() => {})
  emit(IDLE)
}

/** Re-arm the subscription without dropping the link. */
export async function resubscribe(): Promise<void> {
  await state.connection?.resubscribe()
}

export function clearError(): void {
  if (state.error) emit({ error: null })
}
