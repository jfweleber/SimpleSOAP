# SimpleSOAP

Wilderness patient assessment and SOAP note documentation for search and rescue.

A responder opens a note when they take over patient care, works through the
assessment on a phone in the field, and comes away with a printable SOAP report
and a script to read over the radio. It runs offline, stores everything on the
device, and is built to be legible at arm's length in bad light with cold hands.

**[soap.weleber.net](https://soap.weleber.net)** — open it, or install it to the
home screen.

---

> [!IMPORTANT]
> **This is not a medical device and not medical advice.** It is a documentation
> tool: it records what a responder observed and prints it back. It does not
> diagnose, does not triage, and does not tell anyone what to do. Nothing in it
> replaces training, protocol, or medical direction. Bluetooth readings from a
> consumer monitor are unvalidated and are recorded as machine samples, never as
> observed vitals — see [Device readings](#device-readings-are-not-observed-vitals).
>
> Built by one active SAR responder for their own use, and shared in case it is
> useful. No warranty, no support commitment, no clinical validation.

---

## What it does

- **SOAP note** — subjective, objective, assessment, plan, with the patient
  header, SAMPLE history and a running problem list
- **Head-to-toe survey** on a tappable body map, with findings pinned to zones
- **Vital sets** over time, including a palpable-pulse check for when nobody has
  a cuff
- **Spinal assessment** against explicit criteria, three-state so an unasked
  question never reads as a negative answer
- **Printed report** — greyscale, print-first, because these get photocopied and
  faxed
- **Verbal report** — the same note as a radio script, sized to read aloud
- **Bluetooth monitors** — pulse oximeters and heart-rate straps, streaming into
  the note as a timestamped appendix
- **Backup and restore** — export every note as a file you hold

## Your data stays on your device

There is no account, no server, and no analytics. The app makes **zero network
requests** of its own — notes live in IndexedDB in the browser, and the only way
data leaves is a PDF you print or a backup file you export deliberately.

That also means nobody else is holding a copy for you. The app asks the browser
for persistent storage, but a browser can refuse, and browsers evict storage for
sites they decide are idle. **Installing to the home screen makes that far less
likely, and the backup export exists because it can still happen.** Export after
a callout.

## Design rules

A few conventions are load-bearing rather than stylistic, because these are
patient records.

### Confirmed negatives, not blanks

A blank field means nobody looked. "No known allergies" means somebody asked.
Those are different facts and the app never collapses one into the other —
spinal criteria are three-state, the head-to-toe survey has an explicit *clear*
flag, and SAMPLE has one-tap negative buttons.

### Device readings are not observed vitals

A number a machine produced on a timer with nobody watching must never acquire
the authority of something a responder examined and stands behind. Telemetry is
stored separately, prints *after* the signature, and pulling a live reading into
a vital set fills the fields for confirmation rather than saving them.

### Print-first, greyscale

Reports get photocopied and faxed, where colour-coding turns into uniform grey.
The body map and the mark are black-and-white by design, with tests pinning it.

### 24-hour time

`hourCycle: 'h23'` everywhere, in one module. US SAR context, so Fahrenheit and
pounds.

## Bluetooth monitors

Seven adapters ship, each a service UUID, a notify characteristic and a parser
in [`src/ble/adapters.ts`](src/ble/adapters.ts):

| Adapter | Notes |
|---|---|
| Heart Rate Monitor | standard BLE Heart Rate Service |
| Pulse Oximeter (standard) | standard PLX service |
| BerryMed / BCI | vendor protocol |
| ChoiceMMed | vendor protocol |
| Generic Oximeter (FFE0) | common OEM module |
| Jumper | vendor protocol |
| Viatom / Wellue | vendor protocol |

> **Every adapter is currently `verified: false`** — the wire formats came from
> protocol analysis and none has yet been confirmed against the real device. If
> you test one, the flag and a note about what you saw are the most useful
> contribution this repo can receive.

When a device connects but sends nothing, the Monitors screen has a diagnostics
panel that reads the GATT tree, plus a **Listen to all** mode that subscribes to
every notifying characteristic to find where the device actually publishes.

## Platform support

| | Assessment, report, export | Bluetooth |
|---|---|---|
| Android (Chrome) | yes | yes, full |
| Desktop Chrome / Edge | yes | yes, via the browser's device chooser |
| **iPhone / iPad** | **yes** | **no — permanently** |
| Firefox, Brave | yes | no |

**iOS gets everything except Bluetooth.** Apple has never implemented Web
Bluetooth, and every iOS browser is required to use WebKit, so no browser on an
iPhone can reach a monitor. This is a standing platform decision, not a version
gap, and there is no native iOS build. The app says so plainly rather than
showing a scan that can never find anything.

**Brave ships Web Bluetooth disabled globally**, by flag. `navigator.bluetooth`
exists but availability is false forever, and no OS permission changes it.

Bluetooth and offline support both require HTTPS.

## Development

Needs Node 20+.

```sh
npm install
npm run dev            # vite dev server
npm test               # vitest
npm run build          # tsc -b && vite build
npm run lint           # oxlint
```

```
src/model/     types, factory, IndexedDB store, incident location
src/ble/       adapters, session, live monitor, diagnostics
src/report/    printed template, verbal radio script, PDF export
src/screens/   Home, Assessment, Monitors, VerbalReport, Backup
src/ui/        field components, body map geometry, logo
src/format/    time — 24-hour everywhere, one place
src/theme.ts   light and dark palettes
```

[`CLAUDE.md`](CLAUDE.md) carries the working notes — the gotchas that cost real
debugging, and why several decisions went the way they did. Read it before
changing storage or Bluetooth.

The `android/` directory holds a retired Capacitor shell. The APK is no longer
built or shipped; the PWA covers the same ground. Don't `cap sync` it.

### Deploying your own

`deploy/` has an nginx config and a build-and-upload script for a plain Linux
host. `deploy/README.md` covers DNS, TLS and the caching headers that let an
installed copy pick up a new version.

## Provenance

The project began as a slimmed-down replacement for an app the author used on
callouts. Bluetooth wire formats — service UUIDs, characteristics and packet
layouts — came from interoperability analysis of that app's Android package.
**No code or assets were copied from it.** The formats themselves are largely
vendor protocols for third-party hardware rather than anything original to it.

## Contributing

Issues and pull requests are welcome, particularly:

- **Confirming a Bluetooth adapter against real hardware** — the single most
  useful thing, given all seven are unverified
- Adding an adapter for a monitor you own — one entry in `adapters.ts` and
  nothing else changes
- Field-legibility problems: contrast, target size, anything hard to read in sun
  or in the dark

Please don't send changes that make a record assert something a responder did
not actually observe, however convenient. That is the one line this project
holds.
