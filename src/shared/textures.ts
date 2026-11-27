import type { BuiltinTextureId, WallpaperRef } from './types'

export const BUILTIN_TEXTURES: Array<{
  id: BuiltinTextureId
  label: string
  file: string
  description: string
}> = [
  {
    id: 'digital',
    label: 'Digital',
    file: 'digital.png',
    description: 'Circuit grid with cyan pulses'
  },
  {
    id: 'wild-jungle',
    label: 'Wild / Jungle',
    file: 'wild-jungle.png',
    description: 'Canopy greens and organic noise'
  },
  {
    id: 'clean-modern',
    label: 'Clean modern',
    file: 'clean-modern.png',
    description: 'Soft neutral gradient'
  },
  {
    id: 'geometric',
    label: 'Geometric',
    file: 'geometric.png',
    description: 'Chevron and triangle blocks'
  },
  {
    id: 'cosmic',
    label: 'Cosmic',
    file: 'cosmic.png',
    description: 'Deep-space nebula'
  }
]

export function builtinWallpaper(id: BuiltinTextureId): WallpaperRef {
  const t = BUILTIN_TEXTURES.find((x) => x.id === id) || BUILTIN_TEXTURES[0]
  return {
    id: t.id,
    label: t.label,
    kind: 'builtin',
    src: `./textures/${t.file}`
  }
}

export const DEFAULT_WALLPAPER_ID: BuiltinTextureId = 'digital'
