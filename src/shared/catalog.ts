import type { CatalogModel } from './types'

/** Curated one-click model catalog. Prefer Q4/Q5 via Ollama defaults. */
export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'qwen25-coder-1.5b',
    displayName: 'Qwen2.5 Coder 1.5B',
    family: 'qwen',
    sizeLabel: '1.5B',
    ollamaTag: 'qwen2.5-coder:1.5b',
    approxRamGb: 2,
    ramBand: 'fits-8gb',
    notes: 'Fastest coding loop on 8 GB PCs',
    contextLength: 32768
  },
  {
    id: 'qwen25-coder-3b',
    displayName: 'Qwen2.5 Coder 3B',
    family: 'qwen',
    sizeLabel: '3B',
    ollamaTag: 'qwen2.5-coder:3b',
    approxRamGb: 3,
    ramBand: 'fits-8gb',
    recommended: true,
    notes: 'Recommended default for Tri Cass AI',
    contextLength: 32768
  },
  {
    id: 'qwen25-3b',
    displayName: 'Qwen2.5 3B',
    family: 'qwen',
    sizeLabel: '3B',
    ollamaTag: 'qwen2.5:3b',
    approxRamGb: 3,
    ramBand: 'fits-8gb',
    notes: 'General chat + light coding',
    contextLength: 32768
  },
  {
    id: 'granite31-2b',
    displayName: 'Granite 3.1 Dense 2B',
    family: 'granite',
    sizeLabel: '2B',
    ollamaTag: 'granite3.1-dense:2b',
    approxRamGb: 2,
    ramBand: 'fits-8gb',
    notes: 'IBM Granite family — small & local',
    contextLength: 8192
  },
  {
    id: 'granite33-8b',
    displayName: 'Granite 3.3 8B',
    family: 'granite',
    sizeLabel: '8B',
    ollamaTag: 'granite3.3:8b',
    approxRamGb: 7,
    ramBand: 'stretch',
    notes: 'Stretch fit on 8 GB — close other apps',
    contextLength: 8192
  },
  {
    id: 'qwen25-coder-7b',
    displayName: 'Qwen2.5 Coder 7B',
    family: 'qwen',
    sizeLabel: '8B-class',
    ollamaTag: 'qwen2.5-coder:7b',
    approxRamGb: 6,
    ramBand: 'stretch',
    notes: 'Stronger code; needs headroom on 8 GB',
    contextLength: 32768
  },
  {
    id: 'qwen25-14b',
    displayName: 'Qwen2.5 14B',
    family: 'qwen',
    sizeLabel: '14B',
    ollamaTag: 'qwen2.5:14b',
    approxRamGb: 10,
    ramBand: 'needs-more-ram',
    notes: 'Not for typical 8 GB household PCs',
    contextLength: 32768
  },
  {
    id: 'qwen25-32b',
    displayName: 'Qwen2.5 32B (30B-class)',
    family: 'qwen',
    sizeLabel: '30B',
    ollamaTag: 'qwen2.5:32b',
    approxRamGb: 20,
    ramBand: 'needs-more-ram',
    notes: 'Catalog entry for high-RAM desktops',
    contextLength: 32768
  }
]

export const DEFAULT_MODEL_TAG = 'qwen2.5-coder:3b'

export function ramBadgeLabel(band: CatalogModel['ramBand']): string {
  switch (band) {
    case 'fits-8gb':
      return 'Fits ~8 GB'
    case 'stretch':
      return 'Stretch on 8 GB'
    case 'needs-more-ram':
      return 'Needs more RAM'
  }
}
