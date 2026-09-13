import { BrowserWindow } from 'electron'
import { getWorld, updateWorld } from '../projects'
import { getApiKey, loadSettings } from '../settings'
import { getProvider } from '../providers/catalog'
import { streamChat, type ChatMessage } from '../providers/client'
import { systemPrompt, userBrief } from './prompt'
import { AGENT_TOOLS, executeTool, type ToolContext } from './tools'

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; arguments: string }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'preview'; path: string }
  | { type: 'model'; path: string }
  | { type: 'scene'; scene: unknown }
  | { type: 'error'; text: string }
  | { type: 'done'; summary?: string }

const running = new Map<string, AbortController>()
const histories = new Map<string, ChatMessage[]>()

function emit(win: BrowserWindow | null, worldId: string, event: AgentEvent) {
  win?.webContents.send('agent:event', { worldId, ...event })
}

export function stopAgent(worldId: string) {
  running.get(worldId)?.abort()
  running.delete(worldId)
}

export function getHistory(worldId: string) {
  return histories.get(worldId) ?? []
}

export async function runAgent(options: {
  worldId: string
  message: string
  live?: boolean
  window: BrowserWindow | null
}) {
  const world = getWorld(options.worldId)
  if (!world) throw new Error('World not found')
  stopAgent(options.worldId)
  const controller = new AbortController()
  running.set(options.worldId, controller)

  const settings = loadSettings()
  const provider = getProvider(settings.providerId)
  const modelId = settings.providerId === 'custom' ? settings.customModelId : settings.modelId
  const baseUrl = settings.providerId === 'custom' ? settings.customBaseUrl : provider.baseUrl
  const apiKey = getApiKey(settings.providerId)

  if (!provider.keyOptional && !apiKey && provider.id !== 'ollama-local') {
    throw new Error(`Add an API key for ${provider.name} in Settings.`)
  }

  const history = histories.get(options.worldId) ?? [
    { role: 'system', content: systemPrompt(world.mode) }
  ]
  if (history[0]?.role === 'system') history[0].content = systemPrompt(world.mode)

  history.push({
    role: 'user',
    content: history.length <= 1
      ? userBrief({
          title: world.title,
          brief: options.message || world.brief,
          mode: world.mode,
          live: options.live
        })
      : options.live
        ? `LIVE PLAYER PROMPT (do not reset the world):\n${options.message}`
        : options.message
  })

  const ctx: ToolContext = { worldId: options.worldId }
  updateWorld(options.worldId, { status: 'building' })
  emit(options.window, options.worldId, { type: 'status', text: 'Agent is working' })

  let summary: string | undefined
  try {
    for (let step = 0; step < settings.maxAgentSteps; step++) {
      if (controller.signal.aborted) break
      emit(options.window, options.worldId, {
        type: 'status',
        text: `Step ${step + 1} · ${provider.name} · ${modelId}`
      })

      const { text, toolCalls } = await streamChat(
        {
          baseUrl,
          apiKey,
          kind: provider.kind === 'anthropic' ? 'anthropic' : 'openai',
          model: modelId,
          messages: history,
          tools: AGENT_TOOLS,
          temperature: settings.temperature,
          signal: controller.signal
        },
        (chunk) => {
          if (chunk.type === 'text' && chunk.text) {
            emit(options.window, options.worldId, { type: 'text', text: chunk.text })
          }
        }
      )

      history.push({
        role: 'assistant',
        content: text,
        toolCalls: toolCalls.length ? toolCalls : undefined
      })

      if (!toolCalls.length) break

      for (const call of toolCalls) {
        if (controller.signal.aborted) break
        emit(options.window, options.worldId, {
          type: 'tool_start',
          name: call.name,
          arguments: call.arguments
        })
        const executed = await executeTool(call.name, call.arguments, ctx)
        emit(options.window, options.worldId, {
          type: 'tool_end',
          name: call.name,
          result: executed.result.slice(0, 4000)
        })
        if (executed.previewPath) {
          emit(options.window, options.worldId, { type: 'preview', path: executed.previewPath })
        }
        if (executed.glbPath) {
          emit(options.window, options.worldId, { type: 'model', path: executed.glbPath })
        }
        if (executed.scene) {
          emit(options.window, options.worldId, { type: 'scene', scene: executed.scene })
        }
        if (executed.finished) {
          summary = executed.finished.summary
        }
        history.push({
          role: 'tool',
          content: executed.result.slice(0, 14000),
          toolCallId: call.id,
          name: call.name
        })
        if (call.name === 'finish_world') {
          histories.set(options.worldId, history)
          emit(options.window, options.worldId, { type: 'done', summary })
          running.delete(options.worldId)
          return
        }
      }
    }
    updateWorld(options.worldId, { status: 'ready' })
    emit(options.window, options.worldId, { type: 'done', summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    updateWorld(options.worldId, { status: 'error', lastError: message })
    emit(options.window, options.worldId, { type: 'error', text: message })
    emit(options.window, options.worldId, { type: 'done' })
  } finally {
    histories.set(options.worldId, history)
    running.delete(options.worldId)
  }
}
