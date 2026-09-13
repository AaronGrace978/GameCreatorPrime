import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings'
import { getWorld, updateWorld, worldFolder } from './projects'

export interface BlenderRunResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  durationMs: number
  previewPath?: string
  blendPath?: string
  glbPath?: string
  scene?: unknown
}

export function runtimeDir() {
  return app.isPackaged
    ? join(process.resourcesPath, 'blender', 'runtime')
    : join(app.getAppPath(), 'blender', 'runtime')
}

export function templatesDir() {
  return app.isPackaged
    ? join(process.resourcesPath, 'blender', 'templates')
    : join(app.getAppPath(), 'blender', 'templates')
}

export async function detectBlender(): Promise<string[]> {
  const hits: string[] = []
  const roots = [
    'C:\\Program Files\\Blender Foundation',
    'C:\\Program Files (x86)\\Blender Foundation',
    join(homedir(), 'AppData', 'Local', 'Programs')
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of safeList(root)) {
      const exe = join(root, entry, 'blender.exe')
      if (existsSync(exe)) hits.push(exe)
    }
  }
  const pathHit = await which('blender')
  if (pathHit) hits.push(pathHit)
  return [...new Set(hits)]
}

function safeList(dir: string) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd])
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('close', () => {
      const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      resolve(first || null)
    })
    child.on('error', () => resolve(null))
  })
}

export async function resolveBlender(): Promise<string> {
  const settings = loadSettings()
  if (settings.blenderPath && existsSync(settings.blenderPath)) return settings.blenderPath
  const found = await detectBlender()
  if (found[0]) {
    settings.blenderPath = found[0]
    saveSettings(settings)
    return found[0]
  }
  throw new Error(
    'Blender was not found. Install Blender 4.2+ and set the executable path in Settings.'
  )
}

function wrapScript(userCode: string, live: boolean) {
  return `# GameCreator Prime generated script
import os, sys
sys.path.insert(0, os.environ["GCP_RUNTIME"])
from gcp import *

configure(
    project_dir=os.environ["GCP_PROJECT"],
    blend_path=os.environ["GCP_BLEND"],
    render_dir=os.environ["GCP_RENDERS"],
    export_dir=os.environ["GCP_EXPORTS"],
    mode=os.environ.get("GCP_MODE", "generative"),
)
open_or_reset(live=${live ? 'True' : 'False'})

# --- agent world code ---
${userCode}
# --- end agent world code ---

if bpy.context.scene.camera is None:
    camera("AutoCam", (14, -16, 8), look_at=(0, 0, 1.2), kind="beauty")
save_blend()
write_inspect_json()
try:
    print("GCP_GLB:" + export_glb("world.glb"))
except Exception as exc:
    print("GCP_GLB_FAILED:" + str(exc))
`
}

export async function runWorldScript(options: {
  worldId: string
  code: string
  live?: boolean
  render?: boolean
  filename?: string
}): Promise<BlenderRunResult> {
  const world = getWorld(options.worldId)
  if (!world) throw new Error('World not found')
  const blender = await resolveBlender()
  const folder = worldFolder(options.worldId)
  const scripts = join(folder, 'scripts')
  const filename = options.filename ?? `world_${Date.now()}.py`
  const sourcePath = join(scripts, filename)
  const scriptPath = join(scripts, '_run.py')
  const blendPath = join(folder, 'world.blend')
  const wrapped = wrapScript(options.code, Boolean(options.live && existsSync(blendPath)))
  writeFileSync(sourcePath, options.code, 'utf8')
  writeFileSync(scriptPath, wrapped, 'utf8')

  const args = ['--background', '--factory-startup', '--python', scriptPath]
  if (options.live && existsSync(blendPath)) {
    // open_or_reset inside the script handles the .blend
  }

  const result = await execBlender(blender, args, {
    GCP_RUNTIME: runtimeDir(),
    GCP_PROJECT: folder,
    GCP_BLEND: blendPath,
    GCP_RENDERS: join(folder, 'renders'),
    GCP_EXPORTS: join(folder, 'exports'),
    GCP_MODE: world.mode
  })

  let previewPath: string | undefined
  if (options.render !== false && result.ok) {
    const rendered = await renderWorld(options.worldId).catch(() => null)
    previewPath = rendered?.previewPath
  }

  writeRunLog(folder, filename, result)
  const inspect = parseScene(result.stdout)
  const glbPath = join(folder, 'exports', 'world.glb')
  const glb = existsSync(glbPath) ? glbPath : undefined
  updateWorld(options.worldId, {
    status: result.ok ? 'ready' : 'error',
    blendPath: existsSync(blendPath) ? blendPath : undefined,
    glbPath: glb,
    previewPath,
    lastError: result.ok ? undefined : result.stderr.slice(-1200)
  })

  return {
    ...result,
    previewPath,
    glbPath: glb,
    blendPath: existsSync(blendPath) ? blendPath : undefined,
    scene: inspect
  }
}

export async function inspectWorld(worldId: string): Promise<BlenderRunResult> {
  const world = getWorld(worldId)
  if (!world) throw new Error('World not found')
  const blender = await resolveBlender()
  const folder = worldFolder(worldId)
  const inspectPy = join(runtimeDir(), 'inspect.py')
  const blendPath = join(folder, 'world.blend')
  const args = existsSync(blendPath)
    ? ['--background', blendPath, '--python', inspectPy]
    : ['--background', '--factory-startup', '--python', inspectPy]
  const result = await execBlender(blender, args, {
    GCP_RUNTIME: runtimeDir(),
    GCP_PROJECT: folder,
    GCP_BLEND: blendPath,
    GCP_RENDERS: join(folder, 'renders'),
    GCP_EXPORTS: join(folder, 'exports'),
    GCP_MODE: world.mode
  })
  return { ...result, scene: parseScene(result.stdout), blendPath: existsSync(blendPath) ? blendPath : undefined }
}

export async function renderWorld(worldId: string): Promise<BlenderRunResult> {
  const world = getWorld(worldId)
  if (!world) throw new Error('World not found')
  const blender = await resolveBlender()
  const folder = worldFolder(worldId)
  const blendPath = join(folder, 'world.blend')
  if (!existsSync(blendPath)) throw new Error('No .blend yet — build the world first.')
  const previewPath = join(folder, 'renders', 'preview.png')
  const py = join(folder, 'scripts', '_render.py')
  writeFileSync(
    py,
    `import os, sys
sys.path.insert(0, os.environ["GCP_RUNTIME"])
from gcp import configure, render_still
configure(
    project_dir=os.environ["GCP_PROJECT"],
    blend_path=os.environ["GCP_BLEND"],
    render_dir=os.environ["GCP_RENDERS"],
    export_dir=os.environ["GCP_EXPORTS"],
    mode=os.environ.get("GCP_MODE", "generative"),
)
render_still("preview.png")
`,
    'utf8'
  )
  const result = await execBlender(blender, ['--background', blendPath, '--python', py], {
    GCP_RUNTIME: runtimeDir(),
    GCP_PROJECT: folder,
    GCP_BLEND: blendPath,
    GCP_RENDERS: join(folder, 'renders'),
    GCP_EXPORTS: join(folder, 'exports'),
    GCP_MODE: world.mode
  })
  const exists = existsSync(previewPath)
  if (exists) updateWorld(worldId, { previewPath })
  return { ...result, previewPath: exists ? previewPath : undefined, blendPath }
}

/** Export GLB from an existing .blend. Worlds built before GLB export still have one. */
export async function exportWorldGlb(worldId: string, force = false): Promise<BlenderRunResult> {
  const world = getWorld(worldId)
  if (!world) throw new Error('World not found')
  const folder = worldFolder(worldId)
  const blendPath = join(folder, 'world.blend')
  const glbPath = join(folder, 'exports', 'world.glb')
  // An unbuilt world is an ordinary state, not a failure worth an IPC exception.
  if (!existsSync(blendPath)) {
    return {
      ok: false,
      code: 0,
      stdout: '',
      stderr: 'No .blend yet — build the world first.',
      durationMs: 0,
      blendPath
    }
  }
  if (!force && existsSync(glbPath)) {
    return { ok: true, code: 0, stdout: '', stderr: '', durationMs: 0, glbPath, blendPath }
  }

  const blender = await resolveBlender()
  const py = join(folder, 'scripts', '_export.py')
  writeFileSync(
    py,
    `import os, sys
sys.path.insert(0, os.environ["GCP_RUNTIME"])
from gcp import configure, export_glb
configure(
    project_dir=os.environ["GCP_PROJECT"],
    blend_path=os.environ["GCP_BLEND"],
    render_dir=os.environ["GCP_RENDERS"],
    export_dir=os.environ["GCP_EXPORTS"],
    mode=os.environ.get("GCP_MODE", "generative"),
)
export_glb("world.glb")
`,
    'utf8'
  )
  const result = await execBlender(blender, ['--background', blendPath, '--python', py], {
    GCP_RUNTIME: runtimeDir(),
    GCP_PROJECT: folder,
    GCP_BLEND: blendPath,
    GCP_RENDERS: join(folder, 'renders'),
    GCP_EXPORTS: join(folder, 'exports'),
    GCP_MODE: world.mode
  })
  const made = existsSync(glbPath) ? glbPath : undefined
  if (made) updateWorld(worldId, { glbPath: made })
  return { ...result, glbPath: made, blendPath }
}

/** read_project_file advertises logs, so a run has to actually leave one behind. */
function writeRunLog(folder: string, script: string, result: BlenderRunResult) {
  const stamp = new Date().toISOString()
  const body = [
    `# ${stamp}  ${script}`,
    `exit=${result.code} ok=${result.ok} durationMs=${result.durationMs}`,
    '',
    '## stderr',
    result.stderr.trim() || '(none)',
    '',
    '## stdout',
    result.stdout.trim() || '(none)',
    ''
  ].join('\n')
  try {
    mkdirSync(join(folder, 'logs'), { recursive: true })
    writeFileSync(join(folder, 'logs', 'run.log'), body, 'utf8')
  } catch {
    // A missing log must never fail the build.
  }
}

function parseScene(stdout: string) {
  const marker = 'GCP_SCENE_JSON:'
  const line = stdout.split(/\r?\n/).reverse().find((l) => l.includes(marker))
  if (!line) return undefined
  try {
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length))
  } catch {
    return undefined
  }
}

function execBlender(
  blender: string,
  args: string[],
  env: Record<string, string>
): Promise<BlenderRunResult> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(blender, args, {
      env: { ...process.env, ...env },
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      const crashed = /Traceback \(most recent call last\)/.test(stderr) || /Traceback \(most recent call last\)/.test(stdout)
      resolve({
        ok: code === 0 && !crashed,
        code: crashed && !code ? 1 : (code ?? 1),
        stdout,
        stderr,
        durationMs: Date.now() - started
      })
    })
  })
}
