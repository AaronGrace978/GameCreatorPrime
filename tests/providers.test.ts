import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { listProviderModels, streamChat, type ChatRequest } from '../src/main/providers/client.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const request: ChatRequest = {
  baseUrl: 'https://provider.example/v1',
  apiKey: 'test-key',
  kind: 'openai',
  model: 'kimi-k2.5',
  messages: [{ role: 'user', content: 'Make a rock.' }],
  tools: [{ name: 'run_blender', description: 'Build geometry', parameters: { type: 'object' } }],
  temperature: 0.35
}

function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n'))
}

test('thinking tool calls retain provider state across subsequent requests without displaying it', async () => {
  let payload: Record<string, any> = {}
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(String(options?.body))
    return sse([
      { choices: [{ delta: { reasoning_content: 'private state', tool_calls: [{ index: 0, id: 'call_1', function: { name: 'run_', arguments: '{"code":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'blender', arguments: '"rock()"}' } }] } }] }
    ])
  }
  const visible: string[] = []
  const first = await streamChat(request, (chunk) => { if (chunk.text) visible.push(chunk.text) })
  assert.equal(first.reasoningContent, 'private state')
  assert.deepEqual(visible, [])
  assert.deepEqual(first.toolCalls, [{ id: 'call_1', name: 'run_blender', arguments: '{"code":"rock()"}' }])
  await streamChat({
    ...request,
    messages: [...request.messages, { role: 'assistant', content: first.text, toolCalls: first.toolCalls, reasoningContent: first.reasoningContent }, { role: 'tool', toolCallId: 'call_1', content: 'built' }]
  }, () => {})
  assert.equal(payload.messages[1].reasoning_content, 'private state')
  assert.equal(payload.messages[2].tool_call_id, 'call_1')
  assert.equal('temperature' in payload, false)
})

test('Gemini tool-call thought signatures survive streaming and the tool result round trip', async () => {
  const signature = { google: { thought_signature: 'opaque-signature' } }
  let payload: Record<string, any> = {}
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(String(options?.body))
    return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_gemini', function: { name: 'run_blender', arguments: '{}' }, extra_content: signature }] } }] }])
  }
  const events: unknown[] = []
  const first = await streamChat({ ...request, model: 'gemini-4-pro' }, (event) => events.push(event))
  assert.deepEqual(first.toolCalls[0].extraContent, signature)
  assert.equal(events.some((event: any) => event.type === 'text' && event.text?.includes('opaque-signature')), false)
  await streamChat({ ...request, model: 'gemini-4-pro', messages: [
    ...request.messages,
    { role: 'assistant', content: '', toolCalls: first.toolCalls },
    { role: 'tool', content: 'built', toolCallId: 'call_gemini' }
  ] }, () => {})
  assert.deepEqual(payload.messages[1].tool_calls[0].extra_content, signature)
})

test('new OpenAI reasoning families use provider sampling defaults, older chat models keep temperature', async () => {
  const payloads: Record<string, any>[] = []
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body)))
    return sse([{ choices: [{ delta: { content: 'Ready' } }] }])
  }
  for (const model of ['gpt-5.2', 'gpt-6', 'openai/gpt-6-mini', 'o3', 'gpt-4.1']) {
    const result = await streamChat({ ...request, model }, () => {})
    assert.equal(result.text, 'Ready')
  }
  assert.deepEqual(payloads.map((payload) => payload.temperature), [undefined, undefined, undefined, undefined, 0.35])
})

test('new Anthropic families use default sampling without changing older model requests', async () => {
  const payloads: Record<string, any>[] = []
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body)))
    return sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ready' } }])
  }
  for (const model of ['claude-opus-5-5', 'claude-mythos-5-1', 'claude-sonnet-4-6']) {
    const result = await streamChat({ ...request, kind: 'anthropic', model }, () => {})
    assert.equal(result.text, 'Ready')
  }
  assert.deepEqual(payloads.map((payload) => payload.temperature), [undefined, undefined, 0.35])
})

test('SSE errors and truncated tool calls reject instead of silently completing', async () => {
  for (const kind of ['openai', 'anthropic'] as const) {
    globalThis.fetch = async () => sse([{ type: 'error', error: { message: 'Quota exceeded' } }])
    await assert.rejects(streamChat({ ...request, kind }, () => {}), /Quota exceeded/)
  }
  globalThis.fetch = async () => sse([{ choices: [{ delta: {}, finish_reason: 'length' }] }])
  await assert.rejects(streamChat(request, () => {}), /truncated/)
})

test('SSE decoder handles split UTF-8 bytes and final event without trailing newline', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"🪨"}}]}')
  const marker = bytes.indexOf(0xf0)
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, marker + 1))
      controller.enqueue(bytes.slice(marker + 1))
      controller.close()
    }
  }))
  const result = await streamChat(request, () => {})
  assert.equal(result.text, '🪨')
})

test('model discovery preserves provider IDs, authenticates, deduplicates, and sorts', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://provider.example/v1/models')
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-key')
    assert.ok(options?.signal)
    return Response.json({ data: [{ id: 'kimi-k3.1-pro' }, { id: 'model-z' }, { id: 'kimi-k3.1-pro' }, { id: null }] })
  }
  assert.deepEqual(await listProviderModels(request.baseUrl, 'test-key'), ['kimi-k3.1-pro', 'model-z'])
})

test('Anthropic discovery reads every catalog page with native authentication', async () => {
  let calls = 0
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input))
    const headers = options?.headers as Record<string, string>
    assert.equal(headers['x-api-key'], 'test-key')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    assert.equal(headers.Authorization, undefined)
    calls++
    if (calls === 1) return Response.json({ data: [{ id: 'claude-first' }], has_more: true, last_id: 'claude-first' })
    assert.equal(url.searchParams.get('after_id'), 'claude-first')
    return Response.json({ data: [{ id: 'claude-second' }], has_more: false })
  }
  assert.deepEqual(await listProviderModels('https://api.anthropic.com/v1', 'test-key', 'anthropic'), ['claude-first', 'claude-second'])
  assert.equal(calls, 2)
})

test('Ollama discovery uses native tags and keeps exact runnable tags', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://ollama.com/api/tags')
    return Response.json({ models: [{ name: 'kimi-k2.5:cloud' }, { name: 'gpt-oss:120b' }] })
  }
  assert.deepEqual(await listProviderModels('https://ollama.com/v1', 'test-key', 'ollama-native'), ['gpt-oss:120b', 'kimi-k2.5:cloud'])
})

test('model discovery exposes authorization, invalid catalogs and looping pagination failures', async () => {
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 })
  await assert.rejects(listProviderModels(request.baseUrl), /401/)
  globalThis.fetch = async () => Response.json({ wrong: [] })
  await assert.rejects(listProviderModels(request.baseUrl), /invalid model list/)
  globalThis.fetch = async () => Response.json({ data: [{ id: 'same' }], has_more: true, last_id: 'same' })
  await assert.rejects(listProviderModels(request.baseUrl), /pagination cursor/)
})
