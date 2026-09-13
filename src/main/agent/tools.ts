import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspectWorld, renderWorld, runWorldScript } from '../blender'
import { getWorld, listWorldFiles, updateWorld, worldFolder } from '../projects'
import type { ToolSpec } from '../providers/client'

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'write_world_script',
    description:
      'Write the Blender SDK script that builds or mutates the world. Pass only the world code (gcp helpers). The harness wraps configure/save.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        filename: { type: 'string', description: 'File name inside scripts/, e.g. build.py or mutate_east_wing.py' },
        code: { type: 'string', description: 'Python using gcp helpers' }
      },
      required: ['filename', 'code']
    }
  },
  {
    name: 'run_blender',
    description: 'Execute the last written (or named) world script in Blender headless. Set live=true to mutate the existing .blend.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        filename: { type: 'string' },
        live: { type: 'boolean' },
        render: { type: 'boolean', description: 'Render a preview still after a successful run' }
      }
    }
  },
  {
    name: 'inspect_scene',
    description: 'Dump objects, collections, physics, cameras, and gcp tags from the current .blend.',
    parameters: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'render_preview',
    description: 'Render a 1920x1080 beauty still from the active camera.',
    parameters: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'read_project_file',
    description: 'Read a file in the world folder (scripts, scene.json, logs).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'list_project_files',
    description: 'List files in this world project.',
    parameters: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'finish_world',
    description: 'Mark the job complete. Summarize what a game, robotics trainer, or director should do next.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        notes: { type: 'string' }
      },
      required: ['summary']
    }
  }
]

export interface ToolContext {
  worldId: string
  lastScript?: { filename: string; code: string }
}

export async function executeTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext
): Promise<{ result: string; previewPath?: string; scene?: unknown; finished?: { summary: string } }> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(rawArgs || '{}') as Record<string, unknown>
  } catch {
    args = {}
  }

  switch (name) {
    case 'write_world_script': {
      const world = getWorld(ctx.worldId)
      if (!world) throw new Error('World not found')
      const filename = String(args.filename || 'build.py').replace(/[^\w.\-]+/g, '_')
      const code = String(args.code || '')
      if (!code.trim()) throw new Error('Script was empty')
      const path = join(worldFolder(ctx.worldId), 'scripts', filename)
      writeFileSync(path, code, 'utf8')
      ctx.lastScript = { filename, code }
      return { result: `Wrote scripts/${filename} (${code.length} chars). Call run_blender next.` }
    }
    case 'run_blender': {
      const filename = String(args.filename || ctx.lastScript?.filename || '')
      const world = getWorld(ctx.worldId)
      if (!world) throw new Error('World not found')
      const path = filename ? join(worldFolder(ctx.worldId), 'scripts', filename) : ''
      const code = filename && existsSync(path) ? readFileSync(path, 'utf8') : ctx.lastScript?.code
      if (!code) throw new Error('No script to run. write_world_script first.')
      updateWorld(ctx.worldId, { status: 'building' })
      try {
        const ran = await runWorldScript({
          worldId: ctx.worldId,
          code,
          filename: filename || undefined,
          live: Boolean(args.live),
          render: args.render !== false
        })
        const summary = {
          ok: ran.ok,
          durationMs: ran.durationMs,
          blendPath: ran.blendPath,
          previewPath: ran.previewPath,
          stderrTail: ran.stderr.slice(-1800),
          scene: ran.scene
        }
        if (!ran.ok) {
          return { result: `Blender failed:\n${JSON.stringify(summary, null, 2)}` }
        }
        return {
          result: `Blender ok in ${ran.durationMs}ms\n${JSON.stringify(summary, null, 2)}`,
          previewPath: ran.previewPath,
          scene: ran.scene
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { result: `Blender could not run: ${message}. Scripts are still saved.` }
      }
    }
    case 'inspect_scene': {
      try {
        const inspected = await inspectWorld(ctx.worldId)
        return {
          result: JSON.stringify(inspected.scene ?? { raw: inspected.stdout.slice(-2000) }, null, 2),
          scene: inspected.scene
        }
      } catch (err) {
        return { result: err instanceof Error ? err.message : String(err) }
      }
    }
    case 'render_preview': {
      try {
        const rendered = await renderWorld(ctx.worldId)
        return {
          result: rendered.previewPath ? `Rendered ${rendered.previewPath}` : `Render finished but no PNG. ${rendered.stderr.slice(-800)}`,
          previewPath: rendered.previewPath
        }
      } catch (err) {
        return { result: err instanceof Error ? err.message : String(err) }
      }
    }
    case 'read_project_file': {
      const world = getWorld(ctx.worldId)
      if (!world) throw new Error('World not found')
      const rel = String(args.path || '')
      const abs = join(world.folder, rel)
      if (!abs.startsWith(world.folder)) throw new Error('Invalid path')
      if (!existsSync(abs)) throw new Error('File not found')
      const text = readFileSync(abs, 'utf8')
      return { result: text.slice(0, 12000) }
    }
    case 'list_project_files': {
      return { result: listWorldFiles(ctx.worldId).join('\n') || '(empty)' }
    }
    case 'finish_world': {
      const summary = String(args.summary || '')
      const title = args.title ? String(args.title) : undefined
      const blendPath = join(worldFolder(ctx.worldId), 'world.blend')
      if (!existsSync(blendPath)) {
        return {
          result:
            'Refusing to finish: no world.blend exists yet, so nothing was built. Run run_blender and fix any traceback before calling finish_world.'
        }
      }
      updateWorld(ctx.worldId, {
        status: 'ready',
        title: title || getWorld(ctx.worldId)?.title
      })
      return { result: 'World marked ready.', finished: { summary } }
    }
    default:
      return { result: `Unknown tool: ${name}` }
  }
}
