import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings'
import type { StudioMode } from '../shared/modes'

export type WorldStatus = 'draft' | 'building' | 'ready' | 'error'

export interface WorldRecord {
  id: string
  title: string
  brief: string
  mode: StudioMode
  genre: string
  mood: string
  scale: string
  engine: string
  artDirection: string
  createdAt: string
  updatedAt: string
  status: WorldStatus
  folder: string
  previewPath?: string
  blendPath?: string
  glbPath?: string
  lastError?: string
}

function defaultLibrary() {
  return join(app.getPath('documents'), 'GameCreatorPrime')
}

export function libraryRoot() {
  const settings = loadSettings()
  const root = settings.libraryPath || defaultLibrary()
  if (!settings.libraryPath) {
    settings.libraryPath = root
    saveSettings(settings)
  }
  mkdirSync(join(root, 'worlds'), { recursive: true })
  return root
}

function worldsDir() {
  return join(libraryRoot(), 'worlds')
}

function indexPath() {
  return join(libraryRoot(), 'worlds.json')
}

function readIndex(): WorldRecord[] {
  try {
    return JSON.parse(readFileSync(indexPath(), 'utf8')) as WorldRecord[]
  } catch {
    return []
  }
}

function writeIndex(worlds: WorldRecord[]) {
  writeFileSync(indexPath(), JSON.stringify(worlds, null, 2), 'utf8')
}

export function listWorlds(): WorldRecord[] {
  libraryRoot()
  const indexed = readIndex()
  if (indexed.length) return indexed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  // Recover folders if the index was lost.
  const recovered: WorldRecord[] = []
  if (existsSync(worldsDir())) {
    for (const name of readdirSync(worldsDir(), { withFileTypes: true })) {
      if (!name.isDirectory()) continue
      const metaFile = join(worldsDir(), name.name, 'world.json')
      if (!existsSync(metaFile)) continue
      try {
        recovered.push(JSON.parse(readFileSync(metaFile, 'utf8')) as WorldRecord)
      } catch {
        // skip
      }
    }
  }
  writeIndex(recovered)
  return recovered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getWorld(id: string): WorldRecord | undefined {
  return listWorlds().find((w) => w.id === id)
}

export function worldFolder(id: string) {
  return join(worldsDir(), id)
}

export function createWorld(input: {
  title: string
  brief: string
  mode?: StudioMode
  genre?: string
  mood?: string
  scale?: string
  engine?: string
  artDirection?: string
}): WorldRecord {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const folder = worldFolder(id)
  mkdirSync(join(folder, 'scripts'), { recursive: true })
  mkdirSync(join(folder, 'renders'), { recursive: true })
  mkdirSync(join(folder, 'exports'), { recursive: true })
  mkdirSync(join(folder, 'logs'), { recursive: true })

  const world: WorldRecord = {
    id,
    title: input.title.trim() || 'Untitled world',
    brief: input.brief.trim(),
    mode: input.mode || 'generative',
    genre: input.genre || 'open',
    mood: input.mood || 'cinematic',
    scale: input.scale || 'medium',
    engine: input.engine || 'blender',
    artDirection: input.artDirection || 'stylized',
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    folder
  }
  writeFileSync(join(folder, 'world.json'), JSON.stringify(world, null, 2), 'utf8')
  writeFileSync(join(folder, 'brief.md'), input.brief, 'utf8')
  const worlds = listWorlds()
  worlds.unshift(world)
  writeIndex(worlds)
  return world
}

export function updateWorld(id: string, patch: Partial<WorldRecord>): WorldRecord {
  const worlds = listWorlds()
  const index = worlds.findIndex((w) => w.id === id)
  if (index < 0) throw new Error('World not found')
  const next = { ...worlds[index], ...patch, updatedAt: new Date().toISOString() }
  worlds[index] = next
  writeIndex(worlds)
  writeFileSync(join(next.folder, 'world.json'), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function listWorldFiles(id: string) {
  const world = getWorld(id)
  if (!world) throw new Error('World not found')
  const walk = (dir: string, prefix = ''): string[] => {
    const entries = readdirSync(dir, { withFileTypes: true })
    const out: string[] = []
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
      else out.push(rel)
    }
    return out
  }
  return walk(world.folder)
}
