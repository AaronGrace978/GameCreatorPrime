export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  arguments: string
  /** Opaque provider metadata, such as Gemini tool-call thought signatures. */
  extraContent?: Record<string, unknown>
}

export interface ChatMessage {
  role: ChatRole
  content: string
  name?: string
  toolCallId?: string
  toolCalls?: ToolCall[]
  /** Provider state required when continuing a thinking model after tool execution. */
  reasoningContent?: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatChunk {
  type: 'text' | 'tool_call' | 'done' | 'error'
  text?: string
  toolCall?: ToolCall
  error?: string
}

export interface ChatRequest {
  baseUrl: string
  apiKey?: string
  kind: 'openai' | 'anthropic' | 'ollama-native'
  model: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  temperature?: number
  signal?: AbortSignal
}

function openaiTools(tools: ToolSpec[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }))
}

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.reasoningContent !== undefined ? { reasoning_content: m.reasoningContent } : {}),
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments },
          ...(c.extraContent ? { extra_content: c.extraContent } : {})
        }))
      }
    }
    return {
      role: m.role,
      content: m.content,
      ...(m.role === 'assistant' && m.reasoningContent !== undefined
        ? { reasoning_content: m.reasoningContent } : {})
    }
  })
}

function toAnthropic(messages: ChatMessage[], tools: ToolSpec[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const converted: unknown[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      converted.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: m.content
          }
        ]
      })
      continue
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const content: unknown[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const call of m.toolCalls) {
        let input: unknown = {}
        try {
          input = JSON.parse(call.arguments || '{}')
        } catch {
          input = {}
        }
        content.push({ type: 'tool_use', id: call.id, name: call.name, input })
      }
      converted.push({ role: 'assistant', content })
      continue
    }
    converted.push({ role: m.role, content: m.content })
  }
  return {
    system,
    messages: converted,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }))
  }
}

function providerStreamError(json: Record<string, unknown>) {
  if (!json.error && json.type !== 'error') return
  const error = json.error
  const message = typeof error === 'string'
    ? error
    : error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : 'Provider returned a streaming error.'
  throw new Error(message)
}

async function readSseJson(response: Response, onEvent: (json: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('Provider returned an empty stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consume = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let json: Record<string, unknown>
    try {
      json = JSON.parse(data) as Record<string, unknown>
    } catch {
      throw new Error('Provider returned invalid streaming JSON.')
    }
    providerStreamError(json)
    onEvent(json)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) consume(line)
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  reasoningContent?: string
}

export async function streamChat(
  request: ChatRequest,
  onChunk: (chunk: ChatChunk) => void
): Promise<ChatResult> {
  if (request.kind === 'anthropic') {
    return streamAnthropic(request, onChunk)
  }
  return streamOpenAI(request, onChunk)
}

async function streamOpenAI(
  request: ChatRequest,
  onChunk: (chunk: ChatChunk) => void
): Promise<ChatResult> {
  const url = `${request.baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal: request.signal,
    body: JSON.stringify({
      model: request.model,
      stream: true,
      // Let reasoning models use compatible provider sampling defaults.
      temperature: /^(?:(?:openai\/)?(?:gpt-[56](?:[.-]|$)|o\d(?:-|$))|(?:moonshotai\/)?kimi-k(?:2\.[5-9]|[3-9]))/i.test(request.model)
        ? undefined : (request.temperature ?? 0.4),
      messages: toOpenAIMessages(request.messages),
      tools: request.tools.length ? openaiTools(request.tools) : undefined,
      tool_choice: request.tools.length ? 'auto' : undefined
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Provider error ${response.status}: ${body.slice(0, 800)}`)
  }

  let text = ''
  let reasoningContent = ''
  const toolAcc = new Map<number, ToolCall>()

  await readSseJson(response, (json) => {
    const choices = json.choices as Array<Record<string, unknown>> | undefined
    if (choices?.[0]?.finish_reason === 'length') throw new Error('Model output was truncated. Try a shorter request or another model.')
    const delta = (choices?.[0]?.delta ?? {}) as Record<string, unknown>
    const content = delta.content
    if (typeof content === 'string' && content) {
      text += content
      onChunk({ type: 'text', text: content })
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) {
      reasoningContent += reasoning
    }
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
    if (toolCalls) {
      for (const part of toolCalls) {
        const index = typeof part.index === 'number' ? part.index : 0
        const current: ToolCall = toolAcc.get(index) ?? { id: '', name: '', arguments: '' }
        if (typeof part.id === 'string') current.id = part.id
        if (part.extra_content && typeof part.extra_content === 'object' && !Array.isArray(part.extra_content)) {
          current.extraContent = { ...current.extraContent, ...part.extra_content as Record<string, unknown> }
        }
        const fn = (part.function ?? {}) as Record<string, unknown>
        if (typeof fn.name === 'string') current.name += fn.name
        if (typeof fn.arguments === 'string') current.arguments += fn.arguments
        toolAcc.set(index, current)
      }
    }
  })

  const toolCalls: ToolCall[] = [...toolAcc.values()]
    .filter((t) => t.name)
    .map((t, i) => ({
      id: t.id || `call_${i}`,
      name: t.name,
      arguments: t.arguments || '{}',
      ...(t.extraContent ? { extraContent: t.extraContent } : {})
    }))

  for (const call of toolCalls) onChunk({ type: 'tool_call', toolCall: call })
  onChunk({ type: 'done' })
  return { text, toolCalls, ...(reasoningContent ? { reasoningContent } : {}) }
}

async function streamAnthropic(
  request: ChatRequest,
  onChunk: (chunk: ChatChunk) => void
): Promise<ChatResult> {
  const url = `${request.baseUrl.replace(/\/$/, '')}/messages`
  const payload = toAnthropic(request.messages, request.tools)
  const response = await fetch(url, {
    method: 'POST',
    signal: request.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': request.apiKey ?? '',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: 8192,
      stream: true,
      temperature: /^claude-[a-z]+-[5-9](?:-|$)/i.test(request.model)
        ? undefined : (request.temperature ?? 0.4),
      ...payload
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Anthropic error ${response.status}: ${body.slice(0, 800)}`)
  }

  let text = ''
  const toolCalls: ToolCall[] = []
  let currentTool: ToolCall | null = null

  await readSseJson(response, (json) => {
    const type = json.type
    if (type === 'content_block_delta') {
      const delta = json.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        text += delta.text
        onChunk({ type: 'text', text: delta.text })
      }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && currentTool) {
        currentTool.arguments += delta.partial_json
      }
    }
    if (type === 'content_block_start') {
      const block = json.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use') {
        currentTool = {
          id: String(block.id ?? `call_${toolCalls.length}`),
          name: String(block.name ?? ''),
          arguments: ''
        }
      }
    }
    if (type === 'content_block_stop' && currentTool) {
      if (!currentTool.arguments) currentTool.arguments = '{}'
      toolCalls.push(currentTool)
      onChunk({ type: 'tool_call', toolCall: currentTool })
      currentTool = null
    }
  })

  onChunk({ type: 'done' })
  return { text, toolCalls }
}

/** Read the provider's authenticated catalog instead of relying on bundled model names. */
export async function listProviderModels(
  baseUrl: string,
  apiKey?: string,
  kind: ChatRequest['kind'] = 'openai'
): Promise<string[]> {
  const endpoint = kind === 'ollama-native'
    ? `${baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')}/api/tags`
    : `${baseUrl.replace(/\/$/, '')}/models`
  const headers: Record<string, string> = {}
  if (kind === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const ids = new Set<string>()
  const visited = new Set<string>()
  const signal = AbortSignal.timeout(20_000)
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const url = new URL(endpoint)
    if (kind === 'anthropic') url.searchParams.set('limit', '1000')
    if (cursor) url.searchParams.set(kind === 'anthropic' ? 'after_id' : 'after', cursor)
    const response = await fetch(url, { headers, signal })
    if (!response.ok) throw new Error(`Could not list models (${response.status}). Check the provider key and endpoint.`)
    const json = (await response.json()) as {
      models?: Array<{ name?: unknown }>
      data?: Array<{ id?: unknown }>
      has_more?: boolean
      last_id?: string
    }
    if (kind === 'ollama-native') {
      if (!Array.isArray(json.models)) throw new Error('Provider returned an invalid model list.')
      return [...new Set(json.models.flatMap((model) =>
        typeof model.name === 'string' && model.name.trim() ? [model.name] : []
      ))].sort((a, b) => a.localeCompare(b))
    }
    if (!Array.isArray(json.data)) throw new Error('Provider returned an invalid model list.')
    for (const model of json.data) {
      if (typeof model.id === 'string' && model.id.trim()) ids.add(model.id)
    }
    if (!json.has_more) return [...ids].sort((a, b) => a.localeCompare(b))
    const next = json.last_id ?? json.data.at(-1)?.id
    if (typeof next !== 'string' || !next || visited.has(next)) {
      throw new Error('Provider returned an invalid model pagination cursor.')
    }
    visited.add(next)
    cursor = next
  }
  throw new Error('Provider model list exceeded the pagination limit.')
}

export async function listOpenAIModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  return listProviderModels(baseUrl, apiKey)
}
