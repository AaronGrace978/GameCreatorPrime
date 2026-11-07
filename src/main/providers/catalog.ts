export type ProviderKind = 'openai' | 'anthropic' | 'ollama-native'

export interface ModelInfo {
  id: string
  name: string
  tag?: string
  context?: string
  tools: boolean
  reasoning?: boolean
  vision?: boolean
}

export interface ProviderInfo {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  docsUrl?: string
  keyHint: string
  keyOptional?: boolean
  discover?: boolean
  models: ModelInfo[]
}

// Curated fallbacks; provider discovery is authoritative for account availability.
// Sources and verification scope: docs/model-catalog.md.
export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    kind: 'openai',
    baseUrl: 'https://ollama.com/v1',
    docsUrl: 'https://ollama.com/settings/keys',
    keyHint: 'OLLAMA_API_KEY from ollama.com/settings/keys',
    discover: true,
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3', tag: 'Flagship', context: '1M', tools: true, reasoning: true },
      { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', tag: 'Fast', context: '1M', tools: true, reasoning: true },
      { id: 'kimi-k3', name: 'Kimi K3', tag: 'Agentic', context: '1M', tools: true, reasoning: true, vision: true },
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', tag: 'Code', context: '256K', tools: true, reasoning: true, vision: true },
      { id: 'kimi-k2.6', name: 'Kimi K2.6', tag: 'Multimodal', context: '256K', tools: true, reasoning: true, vision: true },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', context: '256K', tools: true, reasoning: true, vision: true },
      { id: 'qwen3.5:397b', name: 'Qwen 3.5 397B', tag: 'Coding', context: '256K', tools: true, reasoning: true, vision: true },
      { id: 'gpt-oss:120b', name: 'GPT-OSS 120B', tag: 'Open', context: '128K', tools: true, reasoning: true },
      { id: 'gpt-oss:20b', name: 'GPT-OSS 20B', tag: 'Fast', context: '128K', tools: true, reasoning: true },
      { id: 'glm-5.2', name: 'GLM-5.2', context: '976K', tools: true, reasoning: true },
      { id: 'glm-5.1', name: 'GLM-5.1', context: '200K', tools: true, reasoning: true },
      { id: 'gemma4:31b', name: 'Gemma 4 31B', context: '256K', tools: true, reasoning: true },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', tag: 'Reasoning', context: '1M', tools: true },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tag: 'Fast', context: '1M', tools: true }
    ]
  },
  {
    id: 'ollama-local',
    name: 'Ollama Local',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    docsUrl: 'https://ollama.com',
    keyHint: 'Not required for local models',
    keyOptional: true,
    discover: true,
    models: [
      { id: 'glm-5.3:cloud', name: 'GLM-5.3 Cloud', tag: 'Cloud', tools: true, reasoning: true },
      { id: 'kimi-k3:cloud', name: 'Kimi K3 Cloud', tag: 'Cloud', tools: true, reasoning: true },
      { id: 'qwen3.5:cloud', name: 'Qwen 3.5 Cloud', tag: 'Cloud', tools: true, reasoning: true },
      { id: 'gpt-oss:120b-cloud', name: 'GPT-OSS 120B Cloud', tag: 'Cloud', tools: true, reasoning: true },
      { id: 'llama3.2', name: 'Llama 3.2', tools: true }
    ]
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    docsUrl: 'https://platform.moonshot.ai',
    keyHint: 'Moonshot API key from platform.moonshot.ai',
    discover: true,
    models: [
      { id: 'kimi-k3', name: 'Kimi K3', tag: 'Agentic', tools: true, reasoning: true },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', tools: true, reasoning: true, vision: true }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-... from platform.openai.com',
    discover: true,
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', tag: 'Coding', tools: true, reasoning: true },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', tag: 'Flagship', tools: true, reasoning: true },
      { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', tools: true, reasoning: true },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', tag: 'Fast', tools: true, reasoning: true },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', tools: true, reasoning: true },
      { id: 'gpt-5.5', name: 'GPT-5.5', tools: true, reasoning: true },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', tag: 'Efficient', tools: true, reasoning: true },
      { id: 'gpt-5.2', name: 'GPT-5.2', tools: true, reasoning: true },
      { id: 'gpt-5', name: 'GPT-5', tools: true, reasoning: true },
      { id: 'gpt-4.1', name: 'GPT-4.1', tools: true },
      { id: 'gpt-4o', name: 'GPT-4o', tools: true, vision: true },
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-... from console.anthropic.com',
    discover: true,
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', tag: 'Flagship', tools: true, reasoning: true },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', tag: 'Balanced', tools: true, reasoning: true },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', tag: 'Fast', tools: true },
      { id: 'claude-mythos-5-1', name: 'Claude Mythos 5.1', tools: true, reasoning: true },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', tools: true, reasoning: true },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', tag: 'Best', tools: true, reasoning: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tag: 'Balanced', tools: true, reasoning: true },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', tag: 'Fast', tools: true }
    ]
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    docsUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza... from Google AI Studio',
    discover: true,
    models: [
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', tag: 'Flagship', context: '1M', tools: true, reasoning: true, vision: true },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tag: 'Fast', context: '1M', tools: true, reasoning: true, vision: true },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', tag: 'Efficient', context: '1M', tools: true, vision: true },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', tools: true, vision: true }
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_... from console.groq.com',
    discover: true,
    models: [
      { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', tag: 'Latest', tools: true, reasoning: true },
      { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B', tools: true, reasoning: true },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', tag: 'Fast', tools: true, reasoning: true },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', tools: true, reasoning: true },
      { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 Instruct', tools: true },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', tools: true }
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-... from openrouter.ai',
    discover: true,
    models: [
      { id: 'z-ai/glm-5', name: 'GLM-5', tools: true },
      { id: 'moonshotai/kimi-k2', name: 'Kimi K2', tools: true },
      { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tools: true },
      { id: 'openai/gpt-5', name: 'GPT-5', tools: true },
      { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', tools: true }
    ]
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    keyHint: 'Optional bearer token',
    keyOptional: true,
    discover: true,
    models: [{ id: 'custom-model', name: 'Custom model', tools: true }]
  }
]

export function getProvider(id: string): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

export function getModel(providerId: string, modelId: string): ModelInfo | undefined {
  return getProvider(providerId).models.find((m) => m.id === modelId)
}
