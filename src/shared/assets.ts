export type AssetStatus = 'draft' | 'generating' | 'ready' | 'failed' | 'cancelled' | 'interrupted'
export type AssetPreset = 'balanced' | 'hero'

export const ASSET_PRESETS = {
  balanced: { label: 'Balanced', steps: 30, octree: 256, views: 6, textureResolution: 512 },
  hero: { label: 'Hero asset', steps: 50, octree: 384, views: 9, textureResolution: 768 }
} as const

export interface AssetReport {
  triangles: number
  vertices: number
  meshes: number
  materials: number
  images: number
  texturedPrimitives: number
  primitives: number
  hasUVs: boolean
  hasPbrMaps: boolean
  warnings: string[]
}

export interface AssetRecord {
  id: string
  title: string
  status: AssetStatus
  createdAt: string
  updatedAt: string
  source: 'hunyuan' | 'import'
  referencePath?: string
  referenceWidth?: number
  referenceHeight?: number
  modelPath?: string
  blendPath?: string
  error?: string
  preset?: AssetPreset
  seed?: number
  backend?: string
  modelSha256?: string
  report?: AssetReport
}

export interface AssetGenerateInput {
  id: string
  title: string
  preset: AssetPreset
  seed: number
}
