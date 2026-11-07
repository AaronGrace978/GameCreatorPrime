import { app, dialog, nativeImage, shell } from 'electron'
import { readFileSync, statSync, copyFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { libraryRoot } from '../projects'
import { loadSettings } from '../settings'
import { resolveBlender } from '../blender'
import { spawn } from 'node:child_process'
import { AssetLibrary } from './library'
import { MAX_MODEL_BYTES } from './client'
import type { AssetRecord } from '../../shared/assets'

let library: AssetLibrary | undefined
export function assets(notify: (asset: AssetRecord) => void) {
  const root = join(libraryRoot(), 'assets')
  // Keep active jobs associated with their original library if settings change.
  if (!library) library = new AssetLibrary(root, notify)
  return library
}

export async function pickReference(lib: AssetLibrary) {
  const picked = await dialog.showOpenDialog({ title: 'Choose a single-object reference', properties: ['openFile'], filters: [{ name: 'Reference image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
  if (picked.canceled) return null
  const path = picked.filePaths[0]
  if (statSync(path).size > 20 * 1024 * 1024) throw new Error('Reference images must be 20 MB or smaller.')
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) throw new Error('This image could not be decoded. Choose a PNG or JPEG.')
  const { width, height } = image.getSize()
  if (width < 256 || height < 256 || width > 8192 || height > 8192) throw new Error('Use an image between 256 and 8192 pixels per side.')
  const png = image.toPNG()
  if (png.byteLength > 25 * 1024 * 1024) throw new Error('The decoded reference is too large. Resize it to 2048 pixels per side and choose it again.')
  return lib.addReference(png, width, height, basename(path).replace(/\.[^.]+$/, ''))
}

export async function importAsset(lib: AssetLibrary) {
  const picked = await dialog.showOpenDialog({ title: 'Import a textured GLB', properties: ['openFile'], filters: [{ name: 'GLB 2.0', extensions: ['glb'] }] })
  if (picked.canceled) return null
  const path = picked.filePaths[0]
  if (statSync(path).size > MAX_MODEL_BYTES) throw new Error('GLB files must be 256 MB or smaller.')
  return lib.importGlb(readFileSync(path), basename(path).replace(/\.glb$/i, ''))
}

export async function exportAsset(lib: AssetLibrary, id: string) {
  const asset = lib.get(id)
  if (!asset.modelPath || asset.status !== 'ready') throw new Error('This asset has no completed model.')
  const result = await dialog.showSaveDialog({ title: 'Export original GLB', defaultPath: asset.title.replace(/[^a-z\d _-]/gi, '_') + '.glb', filters: [{ name: 'GLB', extensions: ['glb'] }] })
  if (result.canceled || !result.filePath) return false
  if (result.filePath !== asset.modelPath) copyFileSync(asset.modelPath, result.filePath)
  return true
}

export async function prepareBlend(lib: AssetLibrary, id: string) {
  const asset = lib.get(id)
  if (!asset.modelPath || asset.status !== 'ready') throw new Error('Generate or import a model first.')
  const executable = await resolveBlender()
  const script = app.isPackaged ? join(process.resourcesPath, 'blender', 'runtime', 'prepare_asset.py') : join(app.getAppPath(), 'blender', 'runtime', 'prepare_asset.py')
  const blendPath = join(lib.folder(id), 'asset.blend')
  await new Promise<void>((resolve, reject) => {
    const process = spawn(executable, ['--background', '--factory-startup', '--threads', '4', '--python-exit-code', '1', '--python', script, '--', asset.modelPath!, blendPath], { windowsHide: true })
    let output = ''
    const timer = setTimeout(() => { process.kill(); reject(new Error('Blender import timed out after five minutes.')) }, 300_000)
    process.stdout.on('data', d => { output = (output + d).slice(-8000) })
    process.stderr.on('data', d => { output = (output + d).slice(-8000) })
    process.once('error', err => { clearTimeout(timer); reject(err) })
    process.once('close', code => { clearTimeout(timer); code === 0 && output.includes('GCP_ASSET_READY') ? resolve() : reject(new Error('Blender could not prepare this asset. ' + output.slice(-1000))) })
  })
  return lib.save({ ...asset, blendPath })
}

export async function openAssetFolder(lib: AssetLibrary, id: string) {
  lib.get(id)
  const error = await shell.openPath(lib.folder(id))
  if (error) throw new Error(error)
}

export function assetServer() { return loadSettings().assetServerUrl }
