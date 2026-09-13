export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  role: ChatRole
  content: string
  name?: string
  toolCallId?: string
  toolCalls?: ToolCall[]
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
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments }
        }))
      }
    }
    return { role: m.role, content: m.content }
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

async function readSseJson(response: Response, onEvent: (json: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('Provider returned an empty stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        onEvent(JSON.parse(data) as Record<string, unknown>)
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

export async function streamChat(
  request: ChatRequest,
  onChunk: (chunk: ChatChunk) => void
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  if (request.kind === 'anthropic') {
    return streamAnthropic(request, onChunk)
  }
  return streamOpenAI(request, onChunk)
}

async function streamOpenAI(
  request: ChatRequest,
  onChunk: (chunk: ChatChunk) => void
): Promise<{ text: string; toolCalls: ToolCall[] }> {
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
      temperature: request.temperature ?? 0.4,
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
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>()

  await readSseJson(response, (json) => {
    const choices = json.choices as Array<Record<string, unknown>> | undefined
    const delta = (choices?.[0]?.delta ?? {}) as Record<string, unknown>
    const content = delta.content
    if (typeof content === 'string' && content) {
      text += content
      onChunk({ type: 'text', text: content })
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) {
      onChunk({ type: 'text', text: '' })
    }
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
    if (toolCalls) {
      for (const part of toolCalls) {
        const index = typeof part.index === 'number' ? part.index : 0
        const current = toolAcc.get(index) ?? { id: '', name: '', arguments: '' }
        if (typeof part.id === 'string') current.id = part.id
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
      arguments: t.arguments || '{}'
    }))

  for (const call of toolCalls) onChunk({ type: 'tool_call', toolCall: call })
  onChunk({ type: 'done' })
  return { text, toolCalls }
}

async function streamAnthropic(
  request: ChatRequest,
  onChunk: (chunk: ChatChunk) => void
): Promise<{ text: string; toolCalls: ToolCall[] }> {
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
      temperature: request.temperature ?? 0.4,
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

export async function listOpenAIModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Could not list models (${response.status})`)
  const json = (await response.json()) as { data?: Array<{ id: string }> }
  return (json.data ?? []).map((m) => m.id)
}
