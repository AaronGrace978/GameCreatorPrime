import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectGlb } from '../src/main/assets/glb.ts'
import { generateAsset, backendUrl } from '../src/main/assets/client.ts'
import { AssetLibrary } from '../src/main/assets/library.ts'

const health = () => new Response(JSON.stringify({ protocol: 1, backend: 'hunyuan3d-2.1', status: 'ready', memory_mode: 'offload' }))

function triangle(modify: (document: any) => void = () => {}) {
  const document: any = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3, min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] }
  modify(document)
  const text = Buffer.from(JSON.stringify(document))
  const json = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(json)
  const buffer = Buffer.alloc(12 + 8 + json.length + 8 + 36)
  buffer.write('glTF'); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8)
  buffer.writeUInt32LE(json.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); json.copy(buffer, 20)
  const start = 20 + json.length
  buffer.writeUInt32LE(36, start); buffer.writeUInt32LE(0x004e4942, start + 4)
  new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).forEach((v, i) => buffer.writeFloatLE(v, start + 8 + i * 4))
  return buffer
}

function texturedTriangle() {
  // A deliberately tiny fixture. This verifies routing/UV inspection, not visual quality.
  return triangle(d => {
    d.accessors.push({ bufferView: 0, componentType: 5126, type: 'VEC2', count: 3 })
    d.meshes[0].primitives[0].attributes.TEXCOORD_0 = 1
    d.meshes[0].primitives[0].material = 0
    d.images = [{ uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=' }]
    d.textures = [{ source: 0 }]
    d.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } }, normalTexture: { index: 0 } }]
  })
}

test('GLB inspection exposes untextured geometry without inventing a quality score', () => {
  const report = inspectGlb(triangle())
  assert.equal(report.triangles, 1)
  assert.equal(report.vertices, 3)
  assert.equal(report.hasUVs, false)
  assert.equal(report.texturedPrimitives, 0)
  assert.ok(report.warnings.some(w => w.includes('failed texture pass')))
})

test('GLB inspection recognizes embedded data-URI textures and material bindings', () => {
  const report = inspectGlb(texturedTriangle())
  assert.equal(report.hasUVs, true)
  assert.equal(report.texturedPrimitives, 1)
  assert.equal(report.hasPbrMaps, true)
})

test('GLB inspection rejects truncated models, external resources, invalid accessors and non-finite geometry', () => {
  assert.throws(() => inspectGlb(triangle().subarray(0, -1)), /incomplete/)
  assert.throws(() => inspectGlb(Buffer.from('<html>proxy error</html>')), /GLB 2.0/)
  assert.throws(() => inspectGlb(triangle(d => { d.buffers[0].uri = 'https://example.com/model.bin' })), /self-contained/)
  assert.throws(() => inspectGlb(triangle(d => { d.accessors[0].count = 999 })), /beyond/)
  assert.throws(() => inspectGlb(triangle(d => { d.images = [{ uri: 'file:///private.png' }] })), /embedded/)
  const bad = triangle(); bad.writeFloatLE(NaN, bad.length - 36)
  assert.throws(() => inspectGlb(bad), /non-finite/)
})

test('generation sends the selected settings and requests textured GLB output', async () => {
  let payload: any
  const output = await generateAsset({ baseUrl: 'http://127.0.0.1:8081', image: Buffer.from('reference'), preset: 'hero', seed: 42, signal: new AbortController().signal }, async (url, options) => {
    if (String(url).endsWith('/health')) return health()
    assert.equal(String(url), 'http://127.0.0.1:8081/generate')
    payload = JSON.parse(options!.body as string)
    return new Response(triangle(), { headers: { 'Content-Type': 'model/gltf-binary' } })
  })
  assert.equal(payload.seed, 42)
  assert.equal(payload.num_inference_steps, 50)
  assert.equal(payload.max_num_view, 9)
  assert.equal(payload.texture, true)
  assert.equal(payload.type, 'glb')
  assert.equal(inspectGlb(output).triangles, 1)
})

test('generation errors are actionable and do not expose arbitrary server response bodies', async () => {
  const request = { baseUrl: 'http://localhost:8081', image: new Uint8Array(), preset: 'balanced' as const, seed: 1, signal: new AbortController().signal }
  await assert.rejects(generateAsset(request, async url => String(url).endsWith('/health') ? health() : new Response('SECRET', { status: 503, headers: { 'X-GCP-Error': 'texture_failed' } })), error => {
    assert.match(String(error), /Texturing failed/); assert.doesNotMatch(String(error), /SECRET/); return true
  })
  await assert.rejects(generateAsset(request, async url => String(url).endsWith('/health') ? health() : new Response('tiny', { headers: { 'Content-Length': String(300 * 1024 * 1024) } })), /too large/)
  await assert.rejects(generateAsset(request, async () => new Response('{"status":"healthy"}')), /quality-settings contract/)
  assert.throws(() => backendUrl('http://remote.example.com'), /HTTPS/)
  assert.throws(() => backendUrl('https://user:password@example.com'), /credentials/)
})

test('asset attempts retain originals and receipts, survive restart, and reject path traversal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gcp-assets-'))
  try {
    const lib = new AssetLibrary(root)
    const source = lib.addReference(Buffer.from('reference'), 512, 512, 'Prop')
    const fetcher: typeof fetch = async url => String(url).endsWith('/health') ? health() : new Response(texturedTriangle())
    const first = await lib.generate({ id: source.id, title: 'Prop', preset: 'balanced', seed: 8 }, 'http://localhost:8081', fetcher)
    const second = await lib.generate({ id: first.id, title: 'Version 2', preset: 'hero', seed: 9 }, 'http://localhost:8081', fetcher)
    assert.notEqual(first.modelPath, second.modelPath)
    assert.equal(first.status, 'ready')
    assert.equal(first.modelSha256?.length, 64)
    assert.equal(readFileSync(first.modelPath!).compare(texturedTriangle()), 0)
    assert.throws(() => lib.get('../secret'), /Invalid asset ID/)
    lib.save({ ...second, status: 'generating' })
    const restarted = new AssetLibrary(root)
    assert.equal(restarted.get(second.id).status, 'interrupted')
    assert.equal(restarted.list().length, 3)
    // Malformed result cannot become a completed model.
    const failed = await restarted.generate({ id: source.id, title: 'Bad output', preset: 'hero', seed: 1 }, 'http://localhost:8081', async url => String(url).endsWith('/health') ? health() : new Response('invalid'))
    assert.equal(failed.status, 'failed')
    assert.equal(failed.modelPath, undefined)
    const untextured = await restarted.generate({ id: source.id, title: 'Missing texture', preset: 'balanced', seed: 1 }, 'http://localhost:8081', async url => String(url).endsWith('/health') ? health() : new Response(triangle()))
    assert.equal(untextured.status, 'failed')
    assert.match(untextured.error!, /No untextured fallback/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cancellation marks the attempt cancelled, without accepting a late model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gcp-cancel-'))
  try {
    let lib: AssetLibrary
    lib = new AssetLibrary(root, asset => { if (asset.status === 'generating') queueMicrotask(() => lib.cancel(asset.id)) })
    const reference = lib.addReference(Buffer.from('reference'), 512, 512, 'Cancel me')
    const result = await lib.generate({ id: reference.id, title: 'Cancelled', preset: 'balanced', seed: 1 }, 'http://localhost:8081', async (url, init) => {
      if (String(url).endsWith('/health')) return health()
      init!.signal!.throwIfAborted()
      await new Promise<void>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      return new Response(triangle())
    })
    assert.equal(result.status, 'cancelled')
    assert.equal(result.modelPath, undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
