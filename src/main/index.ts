import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runAgent, stopAgent } from './agent/harness'
import { detectBlender, exportWorldGlb, inspectWorld, renderWorld } from './blender'
import { createWorld, getWorld, libraryRoot, listWorlds, updateWorld } from './projects'
import { PROVIDERS } from './providers/catalog'
import { listOpenAIModels } from './providers/client'
import { getApiKey, loadSettings, publicSettings, saveSettings, setApiKey, type AppSettings } from './settings'

protocol.registerSchemesAsPrivileged([{ scheme: 'gcp', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 740,
    backgroundColor: '#07070a',
    show: false,
    autoHideMenuBar: true,
    title: 'GameCreator Prime',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#07070a',
      symbolColor: '#efe7d6',
      height: 44
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  protocol.handle('gcp', (request) => {
    const filePath = new URL(request.url).searchParams.get('p') || ''
    if (!filePath || !existsSync(filePath)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  ipcMain.handle('settings:get', () => publicSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings> & { apiKeys?: Record<string, string> }) => {
    const current = loadSettings()
    const { apiKeys, ...rest } = patch
    saveSettings({ ...current, ...rest })
    if (apiKeys) {
      for (const [id, key] of Object.entries(apiKeys)) {
        if (typeof key === 'string' && key.trim()) setApiKey(id, key.trim())
      }
    }
    return publicSettings()
  })
  ipcMain.handle('settings:hasKey', (_e, providerId: string) => Boolean(getApiKey(providerId)))

  ipcMain.handle('providers:list', () => PROVIDERS)
  ipcMain.handle('providers:discover', async () => {
    const settings = loadSettings()
    try {
      const ids = await listOpenAIModels('http://127.0.0.1:11434/v1', 'ollama')
      return ids
    } catch {
      return settings.modelId ? [] : []
    }
  })

  ipcMain.handle('worlds:list', () => listWorlds())
  ipcMain.handle('worlds:get', (_e, id: string) => getWorld(id))
  ipcMain.handle('worlds:create', (_e, input) => createWorld(input))
  ipcMain.handle('worlds:update', (_e, id: string, patch) => updateWorld(id, patch))
  ipcMain.handle('worlds:openFolder', async (_e, id: string) => {
    const world = getWorld(id)
    if (world) await shell.openPath(world.folder)
  })
  ipcMain.handle('library:path', () => libraryRoot())

  ipcMain.handle('blender:detect', () => detectBlender())
  ipcMain.handle('blender:pick', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Locate blender.exe',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Blender', extensions: ['exe'] }] : []
    })
    return picked.canceled ? null : picked.filePaths[0]
  })
  ipcMain.handle('blender:inspect', (_e, id: string) => inspectWorld(id))
  ipcMain.handle('blender:render', (_e, id: string) => renderWorld(id))
  ipcMain.handle('blender:exportGlb', (_e, id: string, force?: boolean) => exportWorldGlb(id, Boolean(force)))

  ipcMain.handle('agent:run', async (_e, payload: { worldId: string; message: string; live?: boolean }) => {
    await runAgent({ ...payload, window: mainWindow })
  })
  ipcMain.handle('agent:stop', (_e, worldId: string) => stopAgent(worldId))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
