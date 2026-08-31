import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'org.simplesoap.app',
  appName: 'SimpleSOAP',
  webDir: 'dist',
  android: {
    // sideload builds only; no Play Store integrity checks
    allowMixedContent: false,
  },
}

export default config
