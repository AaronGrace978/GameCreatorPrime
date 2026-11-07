import { contextBridge, ipcRenderer } from 'electron'
import type { AssetRecord, AssetGenerateInput } from '../shared/assets'

export type AgentPayload = {
  worldId: string
  type: 'status' | 'text' | 'tool_start' | 'tool_end' | 'preview' | 'model' | 'scene' | 'error' | 'done'
  text?: string
  name?: string
  arguments?: string
  result?: string
  path?: string
  scene?: unknown
  summary?: string
}

const api = {
  assets: {
    setupFolder: () => ipcRenderer.invoke('assets:setupFolder') as Promise<void>,
    setupGuide: () => ipcRenderer.invoke('assets:setupGuide') as Promise<void>,
    checkServer: (url: string) => ipcRenderer.invoke('assets:checkServer', url) as Promise<{ status: 'ready' | 'busy'; memoryMode: string }>,
    list: () => ipcRenderer.invoke('assets:list') as Promise<AssetRecord[]>,
    reference: () => ipcRenderer.invoke('assets:reference') as Promise<AssetRecord | null>,
    import: () => ipcRenderer.invoke('assets:import') as Promise<AssetRecord | null>,
    generate: (input: AssetGenerateInput) => ipcRenderer.invoke('assets:generate', input) as Promise<AssetRecord>,
    cancel: (id: string) => ipcRenderer.invoke('assets:cancel', id) as Promise<void>,
    export: (id: string) => ipcRenderer.invoke('assets:export', id) as Promise<boolean>,
    blend: (id: string) => ipcRenderer.invoke('assets:blend', id) as Promise<AssetRecord>,
    folder: (id: string) => ipcRenderer.invoke('assets:folder', id) as Promise<void>,
    onChange: (fn: (asset: AssetRecord) => void) => {
      const listener = (_: unknown, asset: AssetRecord) => fn(asset)
      ipcRenderer.on('assets:changed', listener)
      return () => { ipcRenderer.removeListener('assets:changed', listener) }
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
    hasKey: (providerId: string) => ipcRenderer.invoke('settings:hasKey', providerId) as Promise<boolean>
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    discover: (input?: { providerId: string; apiKey?: string; baseUrl?: string }) =>
      ipcRenderer.invoke('providers:discover', input) as Promise<string[]>
  },
  worlds: {
    list: () => ipcRenderer.invoke('worlds:list'),
    get: (id: string) => ipcRenderer.invoke('worlds:get', id),
    create: (input: Record<string, unknown>) => ipcRenderer.invoke('worlds:create', input),
    update: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('worlds:update', id, patch),
    openFolder: (id: string) => ipcRenderer.invoke('worlds:openFolder', id)
  },
  blender: {
    detect: () => ipcRenderer.invoke('blender:detect') as Promise<string[]>,
    pick: () => ipcRenderer.invoke('blender:pick') as Promise<string | null>,
    inspect: (id: string) => ipcRenderer.invoke('blender:inspect', id),
    render: (id: string) => ipcRenderer.invoke('blender:render', id),
    exportGlb: (id: string, force?: boolean) =>
      ipcRenderer.invoke('blender:exportGlb', id, force) as Promise<{ glbPath?: string; stderr?: string }>
  },
  agent: {
    run: (payload: { worldId: string; message: string; live?: boolean }) => ipcRenderer.invoke('agent:run', payload),
    stop: (worldId: string) => ipcRenderer.invoke('agent:stop', worldId),
    onEvent: (fn: (event: AgentPayload) => void): (() => void) => {
      const listener = (_: unknown, data: AgentPayload) => fn(data)
      ipcRenderer.on('agent:event', listener)
      return () => {
        ipcRenderer.removeListener('agent:event', listener)
      }
    }
  },
  toPreviewUrl: (filePath?: string) =>
    filePath ? `gcp://asset/?p=${encodeURIComponent(filePath)}` : ''
}

contextBridge.exposeInMainWorld('gcp', api)

export type GcpApi = typeof api
