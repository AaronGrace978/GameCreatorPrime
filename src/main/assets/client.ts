import { ASSET_PRESETS, type AssetPreset } from '../../shared/assets.ts'

export const MAX_MODEL_BYTES = 256 * 1024 * 1024

export function backendUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Enter a valid generation server URL.') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Use HTTPS for a remote generation server, or HTTP on localhost.')
  if (url.username || url.password || url.search || url.hash) throw new Error('Server URLs cannot contain credentials, query strings, or fragments.')
  url.pathname = url.pathname.replace(/\/$/, '') + '/'
  return url
}

async function readLimited(response: Response, limit: number, signal: AbortSignal) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('The generation response is too large.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The generation server returned an empty response.')
  const parts: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) throw new Error('The generation response is too large.')
      parts.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Buffer.concat(parts, length)
}

export async function checkAssetServer(baseUrl: string, fetcher: typeof fetch = fetch) {
  const signal = AbortSignal.timeout(5000)
  const response = await fetcher(new URL('health', backendUrl(baseUrl)), { signal, redirect: 'error' })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Generation server health check returned HTTP ${response.status}.`) }
  const health = JSON.parse((await readLimited(response, 16_384, signal)).toString('utf8'))
  if (health.protocol !== 1 || health.backend !== 'hunyuan3d-2.1' || !['ready', 'busy'].includes(health.status)) {
    throw new Error('Start the GameCreator backend from services/hunyuan. This server does not confirm the quality-settings contract.')
  }
  return { status: health.status as 'ready' | 'busy', memoryMode: String(health.memory_mode ?? 'unknown') }
}

export async function generateAsset(options: {
  baseUrl: string; image: Uint8Array; preset: AssetPreset; seed: number; signal: AbortSignal
}, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const preset = ASSET_PRESETS[options.preset]
  if (!preset) throw new Error('Unknown asset quality preset.')
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new Error('Seed must be an integer between 0 and 4294967295.')
  const health = await checkAssetServer(options.baseUrl, fetcher)
  if (health.status === 'busy') throw new Error('The GPU server is already generating an asset. Wait for it to finish.')
  options.signal.throwIfAborted()
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30 * 60_000)])
  const response = await fetcher(new URL('generate', backendUrl(options.baseUrl)), {
    method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'model/gltf-binary, application/octet-stream' },
    body: JSON.stringify({ image: Buffer.from(options.image).toString('base64'), texture: true,
      seed: options.seed, num_inference_steps: preset.steps, octree_resolution: preset.octree,
      max_num_view: preset.views, texture_resolution: preset.textureResolution, type: 'glb' })
  })
  if (!response.ok) {
    // Do not surface arbitrary proxy/server response bodies (which can contain credentials).
    await response.body?.cancel()
    const code = response.headers.get('X-GCP-Error')
    const hint = code === 'texture_failed' ? 'Texturing failed. Check GPU memory and the texture weights; no untextured fallback was accepted.'
      : code === 'shape_failed' ? 'Geometry generation failed. Check CUDA support, model weights, and GPU memory.'
      : code === 'busy' ? 'The GPU server is already generating an asset. Wait for that task to finish.'
      : 'Check its logs, model weights, and GPU memory.'
    throw new Error(`Generation server returned HTTP ${response.status}. ${hint}`)
  }
  return readLimited(response, MAX_MODEL_BYTES, signal)
}
