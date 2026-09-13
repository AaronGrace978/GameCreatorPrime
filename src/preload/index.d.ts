import type { GcpApi } from './index'

declare global {
  interface Window {
    gcp: GcpApi
  }
}

export {}
