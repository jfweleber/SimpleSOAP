import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const ANDROID = String.raw`C:\Users\jwele\simplesoap\android\app\src\main\res`

const BG = '#132C33'
const PIN = '#4FD1B0'
const TRACE = '#0E2226'

/** Pin outline, drawn on a 108-unit canvas spanning y16..y92, x26..x82. */
const PIN_PATH =
  'M54 16 c-16 0 -28 12 -28 27 c0 19 22 38 28 49 c6 -11 28 -30 28 -49 c0 -15 -12 -27 -28 -27 Z'
const TRACE_PATH = 'M39 43 H47 L50 35 L55 53 L59 43 H69'

/**
 * Adaptive-icon foreground artwork must sit inside the middle 66 of 108 so no
 * launcher mask clips it. The pin is 76 tall, so it scales by 0.86 about the
 * centre. The legacy square icon has no mask, so it keeps the full size.
 */
const SAFE_SCALE = 0.86

function svg({ scale = 1, background = BG, withTrace = true }) {
  const inner =
    `<path d="${PIN_PATH}" fill="${PIN}"/>` +
    (withTrace
      ? `<path d="${TRACE_PATH}" fill="none" stroke="${TRACE}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`
      : '')
  const group =
    scale === 1 ? inner : `<g transform="translate(54,54) scale(${scale}) translate(-54,-54)">${inner}</g>`
  const bg = background ? `<rect width="108" height="108" fill="${background}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">${bg}${group}</svg>`
}

/** Square legacy icon, and the same art rounded for ic_launcher_round. */
const legacySquare = svg({ scale: 1 })
const legacyRound = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">
  <defs><clipPath id="c"><circle cx="54" cy="54" r="54"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="108" height="108" fill="${BG}"/>
    <path d="${PIN_PATH}" fill="${PIN}"/>
    <path d="${TRACE_PATH}" fill="none" stroke="${TRACE}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`

const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]

for (const [density, size] of DENSITIES) {
  const dir = join(ANDROID, `mipmap-${density}`)
  mkdirSync(dir, { recursive: true })
  await sharp(Buffer.from(legacySquare)).resize(size, size).png().toFile(join(dir, 'ic_launcher.png'))
  await sharp(Buffer.from(legacyRound)).resize(size, size).png().toFile(join(dir, 'ic_launcher_round.png'))
  console.log(`png  mipmap-${density}  ${size}x${size}`)
}

// Play-store / general purpose master
mkdirSync(join(ANDROID, '..', '..', '..', '..', '..', 'icon'), { recursive: true })
await sharp(Buffer.from(legacySquare))
  .resize(512, 512)
  .png()
  .toFile(String.raw`C:\Users\jwele\simplesoap\icon\ic_launcher-512.png`)
writeFileSync(String.raw`C:\Users\jwele\simplesoap\icon\ic_launcher.svg`, legacySquare)
console.log('png  icon/ic_launcher-512.png')

// --- vector drawables for the adaptive icon -------------------------------

const scaledGroup = (body) =>
  `    <group android:pivotX="54" android:pivotY="54" android:scaleX="${SAFE_SCALE}" android:scaleY="${SAFE_SCALE}">\n${body}\n    </group>`

const foreground = `<?xml version="1.0" encoding="utf-8"?>
<!-- Waypoint mark. Scaled to the adaptive-icon safe zone so no mask clips it. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
${scaledGroup(
  `        <path\n            android:fillColor="${PIN}"\n            android:pathData="${PIN_PATH}" />\n` +
    `        <path\n            android:strokeColor="${TRACE}"\n            android:strokeWidth="5.5"\n            android:strokeLineCap="round"\n            android:strokeLineJoin="round"\n            android:pathData="${TRACE_PATH}" />`,
)}
</vector>
`

const background = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="${BG}"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`

// Themed icons tint a single-colour layer, so the trace is cut out as a hole
// rather than drawn in a second colour.
const monochrome = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
${scaledGroup(
  `        <path\n            android:fillColor="#FFFFFF"\n            android:pathData="${PIN_PATH}" />\n` +
    `        <path\n            android:strokeColor="#000000"\n            android:strokeWidth="5.5"\n            android:strokeLineCap="round"\n            android:strokeLineJoin="round"\n            android:strokeAlpha="1"\n            android:pathData="${TRACE_PATH}" />`,
)}
</vector>
`

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`

/*
 * Capacitor's template ships its own foreground in drawable-v24, and a -v24
 * qualifier outranks plain drawable/ on every device this app supports — so
 * leaving it in place silently wins over ours. Its values/ background colour
 * is likewise superseded by the background drawable. Both go.
 */
rmSync(join(ANDROID, 'drawable-v24', 'ic_launcher_foreground.xml'), { force: true })
rmSync(join(ANDROID, 'values', 'ic_launcher_background.xml'), { force: true })

mkdirSync(join(ANDROID, 'drawable'), { recursive: true })
mkdirSync(join(ANDROID, 'mipmap-anydpi-v26'), { recursive: true })

writeFileSync(join(ANDROID, 'drawable', 'ic_launcher_foreground.xml'), foreground)
writeFileSync(join(ANDROID, 'drawable', 'ic_launcher_background.xml'), background)
writeFileSync(join(ANDROID, 'drawable', 'ic_launcher_monochrome.xml'), monochrome)
writeFileSync(join(ANDROID, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive)
writeFileSync(join(ANDROID, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive)
console.log('xml  adaptive icon + foreground/background/monochrome')
console.log('done')
