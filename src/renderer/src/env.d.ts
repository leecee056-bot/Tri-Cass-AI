/// <reference types="vite/client" />

import type { TriCassAPI } from '../../preload/index'

declare global {
  interface Window {
    triCass: TriCassAPI
  }
}

export {}
