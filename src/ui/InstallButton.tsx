import { useState } from 'react'
import { useInstallPrompt } from '../install'

/**
 * Offer to install to the home screen, on whichever path this browser gives.
 *
 * Chromium hands over a prompt we can fire. WebKit has no install API at all
 * and never will, so on an iPhone the button opens the steps instead — which
 * matters more there than anywhere, because the web app is the only way this
 * tool reaches an iPhone.
 *
 * Renders nothing when there is nothing to offer: already installed, or a
 * browser that cannot.
 */
export function InstallButton() {
  const { state, install } = useInstallPrompt()
  const [showSteps, setShowSteps] = useState(false)

  if (state === 'unavailable') return null

  return (
    <>
      <button
        className="headBtn primary"
        onClick={() => (state === 'ios' ? setShowSteps(true) : install())}
      >
        <DownloadIcon />
        Install app
      </button>
      {showSteps && <IosSteps onClose={() => setShowSteps(false)} />}
    </>
  )
}

function IosSteps({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet" role="dialog" aria-label="Install on iPhone">
      <div className="sheetInner">
        <header className="sheetHead">
          <span />
          <b>Install SimpleSOAP</b>
          <button className="link strong" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="sheetBody">
          <ol className="steps">
            <li>
              Tap <b>Share</b> in the Safari toolbar — the square with an arrow out of it.
            </li>
            <li>
              Scroll down and tap <b>Add to Home Screen</b>.
            </li>
            <li>
              Tap <b>Add</b>.
            </li>
          </ol>
          <p className="empty">
            Safari has no button we can offer you here, so these are the steps.
            Installing matters more than it looks: a browser clears storage for
            sites it decides are idle, and an installed app is far more likely
            to keep your notes between callouts.
          </p>
        </div>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4 17.5v1.8A1.7 1.7 0 0 0 5.7 21h12.6a1.7 1.7 0 0 0 1.7-1.7v-1.8" />
    </svg>
  )
}
