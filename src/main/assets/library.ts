import { randomUUID, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssetRecord, AssetGenerateInput } from '../../shared/assets'
import { inspectGlb } from './glb.ts'
import { generateAsset, MAX_MODEL_BYTES, backendUrl } from './client.ts'

/** One metadata file per asset; originals are never overwritten by export steps. */
export class AssetLibrary {
  private running = new Map<string, AbortController>()
  readonly root: string
  private notify: (asset: AssetRecord) => void
  constructor(root: string, notify: (asset: AssetRecord) => void = () => {}) {
    this.root = root
    this.notify = notify
    mkdirSync(root, { recursive: true })
    for (const asset of this.list()) {
      if (asset.status === 'generating') this.save({ ...asset, status: 'interrupted', error: 'The app closed during generation. Start a new attempt.' })
    }
  }
  folder(id: string) {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new Error('Invalid asset ID.')
    return join(this.root, id)
  }
  get(id: string): AssetRecord {
    const path = join(this.folder(id), 'asset.json')
    if (!existsSync(path)) throw new Error('Asset not found.')
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  list(): AssetRecord[] {
    return readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[a-f\d-]{36}$/i.test(entry.name)).flatMap((entry) => {
      try { return [this.get(entry.name)] } catch { return [] }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  save(asset: AssetRecord) {
    asset = { ...asset, updatedAt: new Date().toISOString() }
    const folder = this.folder(asset.id)
    mkdirSync(folder, { recursive: true })
    const temp = join(folder, 'asset.json.tmp')
    writeFileSync(temp, JSON.stringify(asset, null, 2))
    renameSync(temp, join(folder, 'asset.json'))
    this.notify(asset)
    return asset
  }
  addReference(png: Uint8Array, width: number, height: number, title: string) {
    const id = randomUUID(), createdAt = new Date().toISOString()
    mkdirSync(this.folder(id), { recursive: true })
    const referencePath = join(this.folder(id), 'reference.png')
    writeFileSync(referencePath, png)
    return this.save({ id, title, createdAt, updatedAt: createdAt, status: 'draft', source: 'hunyuan', referencePath, referenceWidth: width, referenceHeight: height })
  }
  importGlb(data: Uint8Array, title: string) {
    if (data.byteLength > MAX_MODEL_BYTES) throw new Error('GLB files must be 256 MB or smaller.')
    const report = inspectGlb(data)
    const id = randomUUID(), createdAt = new Date().toISOString()
    mkdirSync(this.folder(id), { recursive: true })
    const modelPath = join(this.folder(id), 'original.glb')
    writeFileSync(modelPath, data)
    return this.save({ id, title, createdAt, updatedAt: createdAt, status: 'ready', source: 'import', modelPath, report, modelSha256: createHash('sha256').update(data).digest('hex') })
  }
  async generate(input: AssetGenerateInput, baseUrl: string, fetcher?: typeof fetch) {
    const original = this.get(input.id)
    if (!original.referencePath) throw new Error('Choose a reference image first.')
    if (this.running.size) throw new Error('One asset is already generating. Wait for it or cancel it first.')
    if (!['balanced', 'hero'].includes(input.preset) || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) throw new Error('Invalid generation settings.')
    const url = backendUrl(baseUrl)
    // Every attempt has its own folder, seed, receipt and original model.
    const id = randomUUID(), createdAt = new Date().toISOString()
    mkdirSync(this.folder(id), { recursive: true })
    const referencePath = join(this.folder(id), 'reference.png')
    const image = readFileSync(original.referencePath)
    writeFileSync(referencePath, image)
    let asset = this.save({ ...original, id, title: String(input.title || original.title).slice(0, 100), createdAt, updatedAt: createdAt,
      status: 'generating', modelPath: undefined, blendPath: undefined, report: undefined, error: undefined, modelSha256: undefined,
      referencePath, preset: input.preset, seed: input.seed, backend: url.toString() })
    const controller = new AbortController()
    this.running.set(id, controller)
    try {
      const data = await generateAsset({ baseUrl, image, preset: input.preset, seed: input.seed, signal: controller.signal }, fetcher)
      controller.signal.throwIfAborted()
      const report = inspectGlb(data)
      if (!report.hasUVs || report.texturedPrimitives !== report.primitives) {
        throw new Error('The texture pass is incomplete: every mesh primitive must have UVs and a base-color texture. No untextured fallback was accepted.')
      }
      const modelPath = join(this.folder(id), 'original.glb')
      writeFileSync(modelPath, data)
      asset = this.save({ ...asset, modelPath, report, modelSha256: createHash('sha256').update(data).digest('hex'), status: 'ready' })
    } catch (err) {
      const cancelled = controller.signal.aborted
      asset = this.save({ ...asset, status: cancelled ? 'cancelled' : 'failed', error: cancelled ? 'Cancelled locally. The server may still be computing.' : err instanceof Error ? err.message : 'Generation failed.' })
    } finally { this.running.delete(id) }
    return asset
  }
  cancel(id: string) { this.running.get(id)?.abort() }
}
