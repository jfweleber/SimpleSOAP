import { useSyncExternalStore } from 'react'
import * as session from './monitorSession'

/** Live monitor state, usable from any screen. */
export function useMonitorSession() {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
}
