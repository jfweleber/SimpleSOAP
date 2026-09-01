import { useCallback, useEffect, useRef, useState } from 'react'
import type { Adapter, Measurement, ScannedDevice } from '../ble/types'
import type { Discovered, ScanMode } from '../ble/session'
import * as ble from '../ble/session'
import * as session from '../ble/monitorSession'
import { adapters } from '../ble/adapters'
import { useMonitorSession } from '../ble/useMonitorSession'
import { bluetoothBlocker, checkBluetooth, isNative } from '../platform'
import type { BluetoothBlocker } from '../platform'
import { Diagnostics } from './Diagnostics'
import { hhmm } from '../format/time'

type Status = 'idle' | 'starting' | 'scanning' | 'busy' | 'error'

/** How often the list is allowed to repaint. Advertisements arrive far faster. */
const REPAINT_MS = 700
/** A device that stops advertising is dimmed after this, never removed. */
const STALE_AFTER_MS = 12_000

interface Note {
  kind: 'error' | 'info'
  text: string
}

export function MonitorsScreen({
  onBack,
  assessmentId,
  assessmentLabel,
}: {
  onBack: () => void
  /** when set, samples from this connection are recorded to that note */
  assessmentId?: string
  assessmentLabel?: string
}) {
  const live = useMonitorSession()
  const [status, setStatus] = useState<Status>('idle')
  const [mode, setMode] = useState<ScanMode>('compatible')
  const [note, setNote] = useState<Note | null>(null)
  const [devices, setDevices] = useState<Discovered[]>([])
  const [known, setKnown] = useState<ScannedDevice[]>([])
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [services, setServices] = useState<{ id: string; list: string[] } | null>(null)

  /**
   * Scan results land in a ref, not in state. A busy room produces hundreds of
   * advertisements a second and rendering each one made the list unusable.
   */
  const seen = useRef<Map<string, Discovered>>(new Map())
  const native = isNative()
  // starts from the synchronous answer, then refines once the radio is probed
  const [blocker, setBlocker] = useState<BluetoothBlocker>(() =>
    isNative() ? 'none' : bluetoothBlocker() === 'none' ? 'checking' : bluetoothBlocker(),
  )

  const recheckBluetooth = useCallback(() => {
    setBlocker('checking')
    checkBluetooth().then(setBlocker)
  }, [])

  useEffect(() => {
    if (!native) recheckBluetooth()
  }, [native, recheckBluetooth])

  /**
   * On the web the browser owns device selection: one gesture opens its own
   * chooser, and nothing is visible to us until the user picks something.
   * The adapter is resolved afterwards from the real service table, since the
   * chooser reports no advertisement data.
   */
  const chooseOnWeb = useCallback(async () => {
    setNote(null)
    setStatus('busy')
    try {
      await ble.initialize()
      const device = await ble.chooseDevice()
      if (!device) {
        setStatus('idle')
        return
      }
      // one connection start to finish — reconnecting is what the browser
      // rejects with an opaque GATT error
      const result = await session.startResolving(device, { assessmentId, assessmentLabel })
      if (!result.ok) {
        setServices({ id: device.deviceId, list: result.services })
        setNote({
          kind: 'info',
          text: `${device.name || 'That device'} has no profile this app supports.`,
        })
      }
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }, [assessmentId, assessmentLabel])

  // the scan is screen-scoped; the connection deliberately is not
  useEffect(() => {
    return () => {
      ble.stopScan()
    }
  }, [])

  /*
   * A monitor is often already connected before the responder opens the note
   * it should feed. Arriving here from a note re-points the live connection at
   * it rather than leaving the link orphaned.
   */
  useEffect(() => {
    if (assessmentId) session.attachTo(assessmentId, assessmentLabel ?? 'this note')
  }, [assessmentId, assessmentLabel])

  useEffect(() => {
    if (status !== 'scanning') return
    const id = setInterval(() => {
      // Devices are never removed mid-scan. Dropping them shifted the list
      // under your finger; they are dimmed instead.
      const live = [...seen.current.values()]
      live.sort((a, b) => {
        if (!!a.adapter !== !!b.adapter) return a.adapter ? -1 : 1
        return a.firstSeen - b.firstSeen
      })
      setDevices(live)
    }, REPAINT_MS)
    return () => clearInterval(id)
  }, [status])

  const beginScan = useCallback(async (scanMode: ScanMode) => {
    setNote(null)
    setServices(null)
    setStatus('starting')
    try {
      await ble.initialize()
      if (!(await ble.isEnabled())) {
        setNote({ kind: 'error', text: 'Bluetooth is off. Turn it on, then scan again.' })
        setStatus('error')
        return
      }
      await ble.stopScan()
      seen.current = new Map()
      setDevices([])
      setMode(scanMode)
      // Bonded devices are every speaker, car and headset the phone has ever
      // met. They belong in the debug view, never in the monitor list.
      if (scanMode === 'all') {
        ble.listKnownDevices().then(setKnown).catch(() => {})
      } else {
        setKnown([])
      }
      await ble.startScan(scanMode, (result, adapter) => {
        const device = ble.toScannedDevice(result)
        const existing = seen.current.get(device.deviceId)
        seen.current.set(device.deviceId, {
          device,
          // never downgrade an adapter we already confirmed by inspection
          adapter: existing?.adapter ?? adapter,
          rssi: result.rssi ?? -127,
          firstSeen: existing?.firstSeen ?? Date.now(),
          lastSeen: Date.now(),
        })
      })
      setStatus('scanning')
    } catch (e) {
      setNote({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
      setStatus('error')
    }
  }, [])

  const endScan = useCallback(async () => {
    await ble.stopScan()
    setStatus('idle')
  }, [])

  /**
   * One tap does the whole job: if we already know the adapter, connect. If we
   * do not, connect and read the real service table first — the only way to
   * identify a device that never advertised what it supports.
   */
  const selectDevice = useCallback(
    async (device: ScannedDevice, adapter: Adapter | null) => {
      setNote(null)
      setServices(null)
      setBusyId(device.deviceId)
      setStatus('busy')
      await ble.stopScan()
      try {
        if (adapter) {
          await session.start(device, adapter, { assessmentId, assessmentLabel })
        } else {
          // identify and subscribe on one connection rather than reconnecting
          const result = await session.startResolving(device, { assessmentId, assessmentLabel })
          if (!result.ok) {
            setServices({ id: device.deviceId, list: result.services })
            setNote({
              kind: 'info',
              text: `${device.name || 'That device'} has no profile this app supports. Its services are listed below — send them to me and I can add support.`,
            })
          }
        }
        setStatus('idle')
      } catch (e) {
        setStatus('error')
        setNote({
          kind: 'error',
          text: `${e instanceof Error ? e.message : String(e)} — if the device is paired to another app, that app may be holding it.`,
        })
      } finally {
        setBusyId(null)
      }
    },
    [assessmentId, assessmentLabel],
  )

  if (live.connection) {
    return <MonitorView onBack={onBack} onError={(text) => setNote({ kind: 'error', text })} />
  }

  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? devices.filter(
        (d) =>
          d.device.name?.toLowerCase().includes(needle) ||
          d.device.deviceId.toLowerCase().includes(needle),
      )
    : devices
  const now = Date.now()
  const busy = status === 'busy' || status === 'starting'

  return (
    <main className="screen">
      <header className="apphead">
        <button className="headBtn" onClick={onBack}>
          ‹ Back
        </button>
        <b>Monitors</b>
        <span />
      </header>

      <div className="head">
        <p className="sub">
          {mode === 'compatible'
            ? 'Only devices broadcasting heart rate or SpO₂'
            : 'Every device in range, including bonded ones'}
        </p>
        {assessmentLabel && (
          <p className="recTo">
            Samples will be recorded to <b>{assessmentLabel}</b> every 5 minutes.
          </p>
        )}
      </div>

      {(note || live.error) && (
        <div className={note?.kind === 'info' ? 'alert soft' : 'alert'}>
          {note?.text ?? live.error}
        </div>
      )}

      {blocker === 'checking' && <p className="empty">Checking for a Bluetooth radio…</p>}

      {blocker !== 'none' && blocker !== 'checking' && (
        <div className="alert">
          <b>Bluetooth monitors are not available here.</b>
          {blocker === 'brave-disabled' && (
            <>
              <ul className="why">
                <li>
                  <b>Brave ships with Web Bluetooth switched off</b> as a privacy decision. No
                  Android permission can override it — it is disabled inside the browser itself.
                </li>
                <li>
                  To turn it on: open <b>brave://flags</b>, search <b>Web Bluetooth</b>, set it to
                  <b> Enabled</b>, then relaunch Brave.
                </li>
                <li>Or open this app in Chrome, where it works with no setup.</li>
              </ul>
              <button className="btn small" onClick={recheckBluetooth}>
                Check again
              </button>
            </>
          )}
          {blocker === 'radio-unavailable' && (
            <>
              <ul className="why">
                <li>
                  <b>Turn Bluetooth on</b> in your device settings, then check again.
                </li>
                <li>
                  On Android 12 and later, <b>the browser itself needs the Nearby devices
                  permission</b>. Settings → Apps → Chrome → Permissions → Nearby devices → Allow.
                  This is the usual cause when Bluetooth is already on.
                </li>
                <li>On a desktop, this also appears when the machine has no Bluetooth adapter.</li>
              </ul>
              <button className="btn small" onClick={recheckBluetooth}>
                Check again
              </button>
            </>
          )}
          {blocker === 'ios' && (
            <ul className="why">
              <li>
                Apple has never supported Web Bluetooth, and every browser on iOS must use their
                engine — so no browser on an iPhone or iPad can reach a monitor.
              </li>
              <li>
                Everything else works normally. Use an Android phone or a computer when you need
                heart rate or SpO₂.
              </li>
            </ul>
          )}
          {blocker === 'insecure-context' && (
            <ul className="why">
              <li>Bluetooth needs a secure connection. Open this app over https, not http.</li>
            </ul>
          )}
          {blocker === 'unsupported-browser' && (
            <ul className="why">
              <li>
                This browser does not support Web Bluetooth. Chrome or Edge on Android, Windows,
                macOS or Linux will work.
              </li>
            </ul>
          )}
        </div>
      )}

      {blocker === 'none' && !native && (
        <>
          <button className="btn wide" onClick={chooseOnWeb} disabled={busy}>
            {busy ? 'Waiting for the browser…' : 'Choose a monitor'}
          </button>
          <p className="empty">
            Your browser handles the device list. Only devices currently broadcasting heart rate or
            SpO₂ appear in it.
          </p>
        </>
      )}

      {services && (
        <div className="inspect">
          <div className="inspectHead">GATT services on that device</div>
          <ul className="uuids">
            {services.list.map((s) => (
              <li key={s} className="mono">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {native && (
        <>
      <div className="modes" role="group" aria-label="Scan mode">
        <button
          className={mode === 'compatible' ? 'seg on' : 'seg'}
          onClick={() => beginScan('compatible')}
          disabled={busy}
        >
          Monitors
        </button>
        <button
          className={mode === 'all' ? 'seg on' : 'seg'}
          onClick={() => beginScan('all')}
          disabled={busy}
        >
          Everything (debug)
        </button>
      </div>

      <div className="actions">
        {status === 'scanning' ? (
          <button className="btn stop" onClick={endScan}>
            Stop scanning
          </button>
        ) : (
          <button className="btn" onClick={() => beginScan(mode)} disabled={busy}>
            {status === 'starting' ? 'Starting…' : 'Scan'}
          </button>
        )}
        {status === 'scanning' && <span className="count">{devices.length} found</span>}
      </div>

      {mode === 'all' && devices.length > 6 && (
        <input
          className="search"
          type="search"
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      {mode === 'all' && known.length > 0 && (
        <section className="group">
          <h2 className="groupHead">
            Paired to this phone
            <span className="dim"> · every bonded device, not just monitors</span>
          </h2>
          <ul className="list">
            {known.map((d) => (
              <li key={d.deviceId} className="dev">
                <div className="devMain">
                  <div className="devName">{d.name || 'Unnamed device'}</div>
                  <div className="devMeta">
                    <span className="mono">{d.deviceId}</span>
                  </div>
                </div>
                <button className="btn small ghost" onClick={() => selectDevice(d, null)} disabled={busy}>
                  {busyId === d.deviceId ? '…' : 'Check'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status === 'scanning' && visible.length === 0 && (
        <p className="empty">
          {mode === 'compatible'
            ? 'Nothing broadcasting yet. Most watches only broadcast heart rate while that mode is running, and stop when you leave the broadcast screen.'
            : 'Nothing in range yet.'}
        </p>
      )}

      <ul className="list">
        {visible.map((d) => {
          const stale = now - d.lastSeen > STALE_AFTER_MS
          return (
            <li
              key={d.device.deviceId}
              className={`dev${d.adapter ? ' known' : ''}${stale ? ' stale' : ''}`}
            >
              <div className="devMain">
                <div className="devName">{d.device.name || 'Unnamed device'}</div>
                <div className="devMeta">
                  <span className="mono">{d.device.deviceId}</span>
                  <span className="rssi">{stale ? 'gone' : `${d.rssi} dBm`}</span>
                </div>
                {d.adapter ? (
                  <div className="badge">
                    {d.adapter.name}
                    {!d.adapter.verified && <em> · unverified</em>}
                  </div>
                ) : (
                  <div className="badge unknown">
                    {d.device.serviceUUIDs?.length
                      ? `${d.device.serviceUUIDs.length} service(s), none supported`
                      : 'no services advertised'}
                  </div>
                )}
              </div>
              <button
                className={d.adapter ? 'btn small' : 'btn small ghost'}
                onClick={() => selectDevice(d.device, d.adapter)}
                disabled={busy}
              >
                {busyId === d.device.deviceId ? '…' : d.adapter ? 'Connect' : 'Check'}
              </button>
            </li>
          )
        })}
      </ul>

        </>
      )}

      <details className="support">
        <summary>Supported protocols</summary>
        <ul>
          {adapters.map((a) => (
            <li key={a.id}>
              <b>{a.name}</b>
              <span className="mono"> {a.id}</span>
              <br />
              <span className="dim">{a.provides.join(' · ')}</span>
            </li>
          ))}
        </ul>
      </details>
    </main>
  )
}

// ---------------------------------------------------------------------------

function MonitorView({
  onBack,
  onError,
}: {
  onBack: () => void
  onError: (text: string) => void
}) {
  const live = useMonitorSession()
  const [waitedLongEnough, setWaitedLongEnough] = useState(false)

  // a standard monitor emits about once a second; several seconds of nothing
  // means something is wrong rather than slow
  useEffect(() => {
    if (live.frames > 0) return
    const id = setTimeout(() => setWaitedLongEnough(true), 6000)
    return () => clearTimeout(id)
  }, [live.frames])

  const latest = live.latest
  const contact = latest?.sensorContact

  return (
    <main className="screen">
      <header className="apphead">
        <button className="headBtn" onClick={onBack}>
          ‹ Back
        </button>
        <b>{live.connection?.adapter.name}</b>
        <button className="headBtn" onClick={() => session.stop().then(onBack)}>
          Disconnect
        </button>
      </header>

      <div className="head">
        <p className="sub">
          <span className="mono">{live.connection?.deviceId}</span> &middot; {live.readings} readings
        </p>
      </div>

      <div className="clearBanner">
        This monitor stays connected while you work. Go back to the note — it keeps recording.
      </div>

      {live.readings === 0 && live.frames === 0 && !waitedLongEnough && (
        <div className="alert soft">Connected. Waiting for the first reading…</div>
      )}

      {live.frames === 0 && waitedLongEnough && (
        <div className="alert">
          <b>Connected, but the device is not sending anything.</b>
          <ul className="why">
            <li>
              On a watch, heart rate broadcast is usually per-activity and stops when you leave the
              broadcast screen — start it again, then tap <b>Subscribe again</b> below.
            </li>
            <li>Most monitors allow one connection at a time. If the vendor app is open, close it.</li>
            <li>Or use <b>Listen to all</b> in Diagnostics to find where it does publish.</li>
          </ul>
        </div>
      )}

      {live.frames > 0 && live.readings === 0 && (
        <div className="alert">
          Receiving data ({live.frames} frames) but none of it decodes as{' '}
          {live.connection?.adapter.name}. Open Diagnostics and send me the raw frames.
        </div>
      )}

      {contact === false && (
        <div className="alert soft">No sensor contact — the device is on but reading nothing.</div>
      )}

      <div className="vitals">
        <Vital label="Heart rate" value={latest?.heartRate} unit="bpm" />
        <Vital label="SpO₂" value={latest?.spo2} unit="%" />
        <Vital label="Perfusion" value={latest?.perfusionIndex} unit="PI" decimals={1} />
        <Vital label="Respiration" value={latest?.respiratoryRate} unit="br/min" />
      </div>

      {latest && latest.rrIntervals.length > 0 && (
        <div className="rr">
          <span className="dim">RR intervals</span>
          <span className="mono">{latest.rrIntervals.map((v) => Math.round(v)).join(' · ')} ms</span>
        </div>
      )}

      {live.assessmentId ? (
        <div className="recBox">
          <div className="recLine">
            <b>Recording to {live.assessmentLabel ?? 'this note'}</b>
            <span className="dim">
              {live.recorded} sample{live.recorded === 1 ? '' : 's'}
              {live.lastRecordedAt &&
                ` · last ${hhmm(live.lastRecordedAt)}`}
            </span>
          </div>
          <button className="btn small ghost" onClick={() => session.captureSample()} disabled={!latest}>
            Record a sample now
          </button>
        </div>
      ) : (
        <p className="empty">
          Not attached to a note. Open a SOAP note and choose <b>Connect a monitor</b> to record
          samples into it.
        </p>
      )}

      <button className="btn stop wide" onClick={() => session.stop().then(onBack)}>
        Disconnect
      </button>

      <Diagnostics
        deviceId={live.connection?.deviceId ?? ''}
        framesSeen={live.frames}
        onResubscribe={() => {
          session.resubscribe().catch((e) => onError(e instanceof Error ? e.message : String(e)))
        }}
      />
    </main>
  )
}

function Vital({
  label,
  value,
  unit,
  decimals = 0,
}: {
  label: string
  value: number | null | undefined
  unit: string
  decimals?: number
}) {
  const has = value !== null && value !== undefined
  return (
    <div className={has ? 'vital' : 'vital off'}>
      <div className="vLabel">{label}</div>
      <div className="vValue">
        {has ? value.toFixed(decimals) : '—'}
        <span className="vUnit">{unit}</span>
      </div>
    </div>
  )
}

export type { Measurement }
