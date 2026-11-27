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
    file: 'digital.jpg',
    description: 'Circuit board photograph'
  },
  {
    id: 'wild-jungle',
    label: 'Wild / Jungle',
    file: 'wild-jungle.jpg',
    description: 'Sunlit forest path photograph'
  },
  {
    id: 'clean-modern',
    label: 'Clean modern',
    file: 'clean-modern.jpg',
    description: 'Bright modern interior'
  },
  {
    id: 'geometric',
    label: 'Geometric',
    file: 'geometric.jpg',
    description: 'Architectural facade geometry'
  },
  {
    id: 'cosmic',
    label: 'Cosmic',
    file: 'cosmic.jpg',
    description: 'Deep starfield photograph'
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
