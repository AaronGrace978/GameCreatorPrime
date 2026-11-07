import type { AssetReport } from '../../shared/assets'

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

/** Validate a self-contained GLB before it is persisted or passed to Blender. */
export function inspectGlb(data: Uint8Array): AssetReport {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) {
    throw new Error('The backend did not return a GLB 2.0 model.')
  }
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('The GLB download is incomplete or has an invalid length.')
  let offset = 12
  let document: any
  let binary = 0
  let binaryStart = -1
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk header.')
    const length = bytes.readUInt32LE(offset)
    const type = bytes.readUInt32LE(offset + 4)
    if (length % 4 || offset + 8 + length > bytes.length) throw new Error('Invalid GLB chunk length.')
    if (offset === 12 && type !== JSON_CHUNK) throw new Error('The first GLB chunk must contain JSON.')
    if (type === JSON_CHUNK) {
      if (document) throw new Error('Duplicate GLB JSON chunk.')
      try { document = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length).trim()) }
      catch { throw new Error('Invalid GLB JSON.') }
    }
    if (type === BIN_CHUNK) {
      if (binaryStart !== -1) throw new Error('Duplicate GLB binary chunk.')
      binary = length
      binaryStart = offset + 8
    }
    offset += 8 + length
  }
  if (document?.asset?.version !== '2.0' || !Array.isArray(document.meshes)) throw new Error('The GLB contains no meshes.')
  const buffers = document.buffers ?? []
  if (buffers.length !== 1 || buffers[0].uri || !Number.isSafeInteger(buffers[0].byteLength) || buffers[0].byteLength < 1 || buffers[0].byteLength > binary) {
    throw new Error('Use a self-contained GLB with embedded geometry.')
  }
  const views = document.bufferViews ?? []
  for (const v of views) {
    if (v.buffer !== 0 || !Number.isSafeInteger(v.byteLength) || v.byteLength < 0 || !Number.isSafeInteger(v.byteOffset ?? 0) || (v.byteOffset ?? 0) < 0 || (v.byteOffset ?? 0) + v.byteLength > buffers[0].byteLength) {
      throw new Error('The GLB contains an invalid buffer view.')
    }
  }
  for (const image of document.images ?? []) {
    const embeddedUri = typeof image.uri === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z\d+/]+={0,2}$/.test(image.uri)
    if (!embeddedUri && (image.uri || !views[image.bufferView])) throw new Error('GLB textures must be embedded, with valid buffer views or image data URIs.')
  }
  const accessors = document.accessors ?? []
  function accessor(index: unknown) {
    const a = typeof index === 'number' ? accessors[index] : undefined
    const size = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a?.componentType]
    const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a?.type]
    const view = views[a?.bufferView]
    if (!a || !Number.isSafeInteger(a.count) || a.count < 1 || !size || !components || !view || a.sparse) throw new Error('Unsupported or invalid GLB mesh accessor.')
    const stride = view.byteStride ?? size * components
    const start = a.byteOffset ?? 0
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(stride) || stride < size * components || start + (a.count - 1) * stride + size * components > view.byteLength) throw new Error('The GLB geometry extends beyond its buffer.')
    return a
  }
  let triangles = 0, vertices = 0, primitives = 0, texturedPrimitives = 0, uvPrimitives = 0, pbrPrimitives = 0
  for (const mesh of document.meshes) {
    if (!Array.isArray(mesh.primitives)) throw new Error('Invalid mesh primitives.')
    for (const p of mesh.primitives) {
      if ((p.mode ?? 4) !== 4) throw new Error('Export the asset as a triangle mesh GLB.')
      const position = accessor(p.attributes?.POSITION)
      if (position.type !== 'VEC3' || position.componentType !== 5126) throw new Error('Invalid vertex positions.')
      const vertexView = views[position.bufferView]
      for (let i = 0; i < position.count; i++) {
        const start = (vertexView.byteOffset ?? 0) + (position.byteOffset ?? 0) + i * (vertexView.byteStride ?? 12)
        for (let axis = 0; axis < 3; axis++) {
          if (!Number.isFinite(bytes.readFloatLE(binaryStart + start + axis * 4))) throw new Error('The GLB has non-finite vertex coordinates.')
        }
      }
      const indices = p.indices === undefined ? undefined : accessor(p.indices)
      if (indices && (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType))) throw new Error('Invalid triangle indices.')
      if (indices) {
        const indexView = views[indices.bufferView]
        const size = indices.componentType === 5121 ? 1 : indices.componentType === 5123 ? 2 : 4
        const start = binaryStart + (indexView.byteOffset ?? 0) + (indices.byteOffset ?? 0)
        for (let i = 0; i < indices.count; i++) {
          const value = bytes.readUIntLE(start + i * (indexView.byteStride ?? size), size)
          if (value >= position.count) throw new Error('A triangle references a missing vertex.')
        }
      }
      const count = indices?.count ?? position.count
      if (count % 3) throw new Error('The GLB has incomplete triangles.')
      if (p.attributes?.TEXCOORD_0 !== undefined) {
        const uv = accessor(p.attributes.TEXCOORD_0)
        if (uv.type !== 'VEC2' || uv.count !== position.count) throw new Error('Invalid texture coordinates.')
        uvPrimitives++
      }
      const mat = document.materials?.[p.material]
      const texture = (index: unknown) => typeof index === 'number' && document.images?.[document.textures?.[index]?.source] !== undefined
      if (texture(mat?.pbrMetallicRoughness?.baseColorTexture?.index)) texturedPrimitives++
      if (texture(mat?.pbrMetallicRoughness?.metallicRoughnessTexture?.index) && texture(mat?.normalTexture?.index)) pbrPrimitives++
      vertices += position.count
      triangles += count / 3
      primitives++
    }
  }
  if (!triangles) throw new Error('The GLB has no triangle geometry.')
  const warnings: string[] = []
  if (texturedPrimitives < primitives) warnings.push('Some geometry has no base-color texture. Check for a failed texture pass.')
  if (uvPrimitives < primitives) warnings.push('Some geometry has no UV coordinates.')
  if (pbrPrimitives < primitives) warnings.push('Normal and metallic/roughness maps are incomplete. Inspect the material under different lighting.')
  if (triangles > 100_000) warnings.push('More than 100,000 triangles. Make a game-resolution copy before shipping.')
  warnings.push('Check silhouette, hidden surfaces, scale, and topology before production use.')
  return { triangles, vertices, meshes: document.meshes.length, materials: document.materials?.length ?? 0, images: document.images?.length ?? 0, texturedPrimitives, primitives, hasUVs: uvPrimitives === primitives, hasPbrMaps: pbrPrimitives === primitives, warnings }
}
