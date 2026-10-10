/// <reference types="vite/client" />

import type { DesktopBridge } from '../shared/types'

declare global {
  interface Window {
    panaderia: DesktopBridge
  }
}

export {}
