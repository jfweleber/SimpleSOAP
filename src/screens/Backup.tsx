import { useCallback, useEffect, useRef, useState } from 'react'
import type { Assessment } from '../model/types'
import * as store from '../model/store'
import { isNative, requestPersistentStorage, storageIsPersistent } from '../platform'

/**
 * Backup and restore.
 *
 * On the web this is not a nicety. Browsers evict script-writable storage for
 * sites that have not been opened in a while, and these are patient records
 * that can sit untouched between callouts. Persistent storage is requested,
 * but browsers grant it at their discretion — so a file you hold yourself is
 * the only guarantee.
 */
export function BackupScreen({ onBack }: { onBack: () => void }) {
  const [count, setCount] = useState<number | null>(null)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    store.list().then((all) => setCount(all.length)).catch(() => setCount(null))
    storageIsPersistent().then(setPersistent).catch(() => setPersistent(null))
  }, [])

  useEffect(refresh, [refresh])

  const doExport = useCallback(async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const records = await store.exportAll()
      const payload = {
        app: 'SimpleSOAP',
        version: 1,
        exportedAt: new Date().toISOString(),
        assessments: records,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `simplesoap-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setMessage(`Exported ${records.length} note${records.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const doImport = useCallback(async (file: File) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as { assessments?: Assessment[] }
      const records = Array.isArray(parsed.assessments) ? parsed.assessments : null
      if (!records) throw new Error('That file does not look like a SimpleSOAP backup.')
      // records keep their ids, so restoring the same file twice is harmless
      const restored = await store.importAll(records)
      setMessage(`Restored ${restored} note${restored === 1 ? '' : 's'}.`)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const askPersistent = useCallback(async () => {
    const granted = await requestPersistentStorage()
    setPersistent(granted)
    setMessage(
      granted
        ? 'This browser will keep your notes even if the app sits unused.'
        : 'The browser declined. Installing the app to your home screen usually changes its mind.',
    )
  }, [])

  return (
    <main className="screen">
      <header className="apphead">
        <button className="link" onClick={onBack}>
          ‹ Back
        </button>
        <b>Backup</b>
        <span />
      </header>

      <div className="head">
        <p className="sub">
          {count === null ? 'Loading…' : `${count} note${count === 1 ? '' : 's'} stored on this device`}
        </p>
      </div>

      {error && <div className="alert">{error}</div>}
      {message && <div className="alert soft">{message}</div>}

      {!isNative() && persistent === false && (
        <div className="alert soft">
          <b>Storage is not marked persistent.</b>
          <ul className="why">
            <li>
              Browsers clear data for sites that have not been opened recently. Install this app to
              your home screen and grant persistent storage to make that far less likely.
            </li>
          </ul>
          <button className="btn small" onClick={askPersistent}>
            Request persistent storage
          </button>
        </div>
      )}

      <button className="btn wide" onClick={doExport} disabled={busy || count === 0}>
        Export all notes to a file
      </button>

      <button
        className="btn wide stop"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
      >
        Restore from a backup file
      </button>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) doImport(file)
          e.target.value = ''
        }}
      />

      <p className="empty">
        A backup holds every note in full, including monitor samples. Restoring merges by note, so
        importing the same file twice is harmless and never duplicates anything.
      </p>
    </main>
  )
}
