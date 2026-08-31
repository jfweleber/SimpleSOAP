# SimpleSOAP

Wilderness patient assessment and SOAP note documentation for search and rescue.
Jamie is an active SAR responder and uses this on real callouts.

**These are patient records.** Two consequences that outrank almost everything
else: never risk silent data loss, and never let the app assert something a
responder did not actually observe.

## The three targets

One codebase, three ways out — anything you build lands in all three.

| Target | Built by | Bluetooth |
|---|---|---|
| Android APK | Capacitor, `android/` | Full native scan list |
| PWA at soap.weleber.net | `dist/`, deployed | Browser device chooser only |
| Desktop browser | same build | Browser device chooser only |

**iOS gets everything except Bluetooth.** Apple has never implemented Web
Bluetooth and every iOS browser is required to use WebKit, so no browser on an
iPhone can reach a monitor. This is permanent, not a version gap. There is no
native iOS build and there never will be — see the `no-apple-ecosystem` memory.

## Commands

```sh
npm run dev            # vite dev server
npm test               # vitest, ~96 tests
npm run build          # tsc -b && vite build  — MUST pass before packaging
./deploy/deploy.sh     # build + tar-over-ssh to soap.weleber.net
npm run icons          # regenerate launcher and PWA icons from the Waypoint mark
```

Android build needs `JAVA_HOME` set to **JDK 21** (Capacitor 8 will not compile
on 17) and `ANDROID_HOME=~/android-sdk`:

```sh
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
```

### Two build traps that have bitten before

**Use `set -eo pipefail`.** Piping build output through `tail` throws away the
exit code, so `set -e` never fires — a failed `tsc` then lets Gradle package the
*previous* web bundle and the APK ships stale. This has happened twice.

**`sudo` on the server needs a password**, so nginx and certbot steps are
Jamie's to run. Deploys need no root: `/var/www/soap.weleber.net` is owned by
`jamie`. See `deploy/README.md`.

## Layout

```
src/model/     types, factory, IndexedDB store, incident location
src/ble/       adapters (7 devices), session, live monitor, diagnostics
src/report/    printed template, verbal radio script, PDF export
src/screens/   Home, Assessment, Monitors, VerbalReport, Backup, NewNoteLocation
src/ui/        field components, body map geometry, logo
src/format/    time — 24-hour everywhere, one place
```

## Conventions that matter

**Confirmed negatives, not blanks.** A blank field means nobody looked; "no
known allergies" means someone asked. Spinal criteria are three-state
(`yes`/`no`/null) for exactly this reason, the head-to-toe survey has an
explicit *clear* flag, and SAMPLE has one-tap negative buttons. Do not collapse
any of these back to booleans.

**Device readings are not observed vitals.** `TelemetrySample` is kept apart
from `VitalSet`, and the monitor appendix prints *after* the signature. A
machine sample taken on a timer with nobody watching must never acquire the
authority of something a responder examined and stands behind. Pulling a live
reading into a vital set fills the fields for confirmation — it never saves
directly.

**The report is print-first.** Greyscale only: these get photocopied and faxed,
and colour-coded anything turns into uniform grey. The body map and the logo are
black-and-white by design, with tests pinning that.

**24-hour time, Fahrenheit, pounds.** US SAR context. `hourCycle: 'h23'`, never
`hour12: false` — the latter renders midnight as 24:00 in some engines.

## Gotchas, all learned the hard way

**Storage writes are serialized.** Two writers touch a record: the note's
600 ms autosave and the monitor appending samples on a timer. Both do
read-modify-write, so an unserialized write silently ate samples. `store.ts`
chains every write, and the note uses `saveNoteFields()` which takes telemetry
from storage rather than from its own stale copy. **Never call `save()` from
the assessment screen.**

**Web BLE: connect once.** Identify and subscribe on a single connection. The
browser's device chooser reports no advertisement data, so the adapter can only
be resolved after connecting — and connect → discover → disconnect → reconnect
fails in Chromium with an opaque "GATT operation failed for unknown reason".
Use `connectAndResolve` / `startResolving`.

**Android runs one GATT operation at a time** and silently drops concurrent
ones. Subscriptions in `listenToEverything` are paced 250 ms apart.

**Brave ships Web Bluetooth disabled**, globally, by flag. `navigator.bluetooth`
exists but `getAvailability()` returns false forever. No OS permission fixes it.
Detected via `navigator.brave.isBrave()`.

**Body map geometry lives in `src/ui/bodyZones.ts`**, shared by the screen and
the printed report so they cannot drift.

**Capacitor's template fights the icons.** It ships its own
`ic_launcher_foreground.xml` in `drawable-v24/`, and a `-v24` qualifier beats
plain `drawable/` on every device this app targets. `scripts/make-icons.mjs`
deletes it; do not let a platform regeneration bring it back.

**The service worker is web-only**, registered by hand in `main.tsx`. Inside the
Android WebView it just shadows assets the shell already serves.

## Adding a Bluetooth device

One entry in `src/ble/adapters.ts` — service UUID, notify characteristic, a
parser, and `verified: false` until it has been tested against real hardware.
Nothing else changes. Wire formats came from interoperability analysis of the
Rescue Ally APK; no code or assets were copied from it.

When a device connects but sends nothing, the Monitors screen has a diagnostics
panel: read the GATT tree, or **Listen to all** to subscribe to every notifying
characteristic and find where the device actually publishes.

## Working style

Jamie tests on real hardware and reports back precisely — screenshots, error
strings, device names. Take those literally and diagnose from evidence rather
than guessing; several of the gotchas above came from a screenshot showing one
characteristic streaming while another sat silent.

Push back when a request would make the record less trustworthy, explain why,
and build it their way if they still want it. That is how the treated-findings
filter and the SAMPLE auto-copy ended up as one-tap actions instead of
automatic behaviour.
