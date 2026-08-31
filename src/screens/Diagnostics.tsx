import { useCallback, useEffect, useRef, useState } from 'react'
import type { Frame, Listener, ServiceInfo } from '../ble/diagnostics'
import { describe, labelFor, listenToEverything, readOnce, shortUuid } from '../ble/diagnostics'
import * as ble from '../ble/session'

/**
 * Shown when a device is connected. Answers the only question that matters
 * when nothing arrives: what does this device actually expose, and is
 * anything on it talking at all?
 */
export function Diagnostics({
  deviceId,
  framesSeen,
  onResubscribe,
}: {
  deviceId: string
  framesSeen: number
  onResubscribe: () => void
}) {
  const [bonded, setBonded] = useState<boolean | null>(null)
  const [services, setServices] = useState<ServiceInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [listening, setListening] = useState(false)
  const [subscribedCount, setSubscribedCount] = useState<number | null>(null)
  const listenerRef = useRef<Listener | null>(null)

  useEffect(() => {
    ble.isBonded(deviceId).then(setBonded).catch(() => setBonded(null))
    return () => {
      listenerRef.current?.stop()
    }
  }, [deviceId])

  const doBond = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await ble.createBond(deviceId)
      setBonded(await ble.isBonded(deviceId))
    } catch (e) {
      setError(`Pairing failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [deviceId])

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setServices(await describe(deviceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [deviceId])

  const listenAll = useCallback(async () => {
    if (!services) return
    setBusy(true)
    setError(null)
    setFrames([])
    try {
      const listener = await listenToEverything(deviceId, services, (frame) => {
        // newest first, bounded so a chatty device cannot grow this forever
        setFrames((prev) => [frame, ...prev].slice(0, 40))
      })
      listenerRef.current = listener
      setSubscribedCount(listener.subscribed)
      setListening(true)
      if (listener.subscribed === 0) {
        setError('Nothing on this device accepts a subscription.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [deviceId, services])

  const stopListening = useCallback(async () => {
    await listenerRef.current?.stop()
    listenerRef.current = null
    setListening(false)
  }, [])

  const doRead = useCallback(
    async (service: string, characteristic: string) => {
      setError(null)
      try {
        const frame = await readOnce(deviceId, service, characteristic)
        setFrames((prev) => [frame, ...prev].slice(0, 40))
      } catch (e) {
        setError(`Read failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [deviceId],
  )

  const notifiable = services?.flatMap((s) => s.characteristics.filter((c) => c.canNotify)) ?? []

  return (
    <details className="support diag">
      <summary>Diagnostics</summary>

      {error && <div className="alert">{error}</div>}

      <div className="diagRow">
        <button className="btn small ghost" onClick={load} disabled={busy}>
          {services ? 'Re-read services' : 'Read services'}
        </button>
        <button className="btn small ghost" onClick={onResubscribe} disabled={busy}>
          Subscribe again
        </button>
        {bonded === false && (
          <button className="btn small" onClick={doBond} disabled={busy}>
            Pair with device
          </button>
        )}
        {services && !listening && (
          <button className="btn small" onClick={listenAll} disabled={busy || notifiable.length === 0}>
            Listen to all {notifiable.length}
          </button>
        )}
        {listening && (
          <button className="btn small stop" onClick={stopListening}>
            Stop listening
          </button>
        )}
      </div>

      <p className="diagStat">
        {framesSeen} frame{framesSeen === 1 ? '' : 's'} on the expected characteristic
        {subscribedCount !== null && ` · listening on ${subscribedCount}`}
        {bonded !== null && ` · ${bonded ? 'paired' : 'not paired'}`}
      </p>

      {bonded === false && (
        <p className="fieldHint warn">
          Not paired. Some devices refuse to send on an unencrypted link, and fail silently when
          they do.
        </p>
      )}

      {frames.length > 0 && (
        <div className="frames">
          <div className="framesHead">Raw frames, newest first</div>
          <ul>
            {frames.map((f, i) => (
              <li key={`${f.at}-${i}`}>
                <span className="fChar mono">{shortUuid(f.characteristic) ?? f.characteristic.slice(0, 8)}</span>
                <span className="fLen mono">{f.length}B</span>
                <span className="fHex mono">{f.hex}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {services && (
        <div className="tree">
          {services.map((service) => (
            <div key={service.uuid} className="svc">
              <div className="svcHead">
                <b>{service.label ?? 'Unknown service'}</b>
                <span className="mono dim"> {shortUuid(service.uuid) ?? service.uuid}</span>
              </div>
              <ul>
                {service.characteristics.map((c) => (
                  <li key={c.uuid}>
                    <span className="mono">{shortUuid(c.uuid) ?? c.uuid}</span>
                    <span className="props">{c.properties.join(' · ') || 'no properties'}</span>
                    {c.canRead && (
                      <button className="link small" onClick={() => doRead(service.uuid, c.uuid)}>
                        read
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {services && !services.some((s) => labelFor(s.uuid) === 'Heart Rate') && (
        <p className="fieldHint warn">
          This device does not expose the Heart Rate service at all right now. On a watch, that
          usually means broadcast mode is not running.
        </p>
      )}
    </details>
  )
}
