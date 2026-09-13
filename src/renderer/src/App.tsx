import { useEffect, useRef, useState } from 'react'
import { STUDIO_MODES, type StudioMode, modeMeta } from '@shared/modes'
import WorldViewport from './WorldViewport'

type View = 'home' | 'studio' | 'settings'

type World = {
  id: string
  title: string
  brief: string
  mode: StudioMode
  status: string
  previewPath?: string
  glbPath?: string
  lastError?: string
}

type Settings = {
  providerId: string
  modelId: string
  customBaseUrl: string
  customModelId: string
  blenderPath: string
  maxAgentSteps: number
  temperature: number
  configuredProviders: string[]
}

type Provider = {
  id: string
  name: string
  keyHint: string
  keyOptional?: boolean
  models: { id: string; name: string; tag?: string }[]
}

type LogItem =
  | { id: string; kind: 'user' | 'assistant' | 'status' | 'error'; text: string }
  | { id: string; kind: 'tool'; name: string; text: string }

type SceneDump = {
  objects?: Array<{ name: string; type: string; collections?: string[]; physics?: string | null; tags?: Record<string, unknown> }>
  cameras?: string[]
  counts?: Record<string, number>
}

export default function App() {
  const [view, setView] = useState<View>('home')
  const [mode, setMode] = useState<StudioMode>('generative')
  const [prompt, setPrompt] = useState(STUDIO_MODES[1].examples[0])
  const [worlds, setWorlds] = useState<World[]>([])
  const [world, setWorld] = useState<World | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [logs, setLogs] = useState<LogItem[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [preview, setPreview] = useState('')
  const [model, setModel] = useState('')
  const [view3d, setView3d] = useState(true)
  const [scene, setScene] = useState<SceneDump | null>(null)
  const [livePrompt, setLivePrompt] = useState('')
  const [listening, setListening] = useState(false)
  const [tab, setTab] = useState<'objects' | 'physics' | 'spawn' | 'cameras'>('objects')
  const recRef = useRef<MicRec | null>(null)
  const worldIdRef = useRef<string | null>(null)
  const streamRef = useRef('')
  worldIdRef.current = world?.id ?? null

  const meta = modeMeta(world?.mode ?? mode)
  const provider = providers.find((p) => p.id === settings?.providerId)

  async function refresh() {
    const [w, s, p] = await Promise.all([window.gcp.worlds.list(), window.gcp.settings.get(), window.gcp.providers.list()])
    setWorlds(w)
    setSettings(s)
    setProviders(p)
  }

  useEffect(() => {
    if (!window.gcp) {
      setStatus('Open GameCreator Prime in the Electron app to connect the agent.')
      return
    }
    refresh()
    return window.gcp.agent.onEvent((event) => {
      if (worldIdRef.current && event.worldId !== worldIdRef.current) return
      if (event.type === 'status' && event.text) setStatus(event.text)
      if (event.type === 'text' && event.text) {
        streamRef.current += event.text
        setLogs((curr) => {
          const last = curr[curr.length - 1]
          if (last?.kind === 'assistant') return [...curr.slice(0, -1), { ...last, text: streamRef.current }]
          return [...curr, { id: crypto.randomUUID(), kind: 'assistant', text: streamRef.current }]
        })
      }
      if (event.type === 'tool_start') {
        streamRef.current = ''
        setLogs((curr) => [
          ...curr,
          { id: crypto.randomUUID(), kind: 'tool', name: event.name || 'tool', text: `→ ${event.name}\n${(event.arguments || '').slice(0, 400)}` }
        ])
      }
      if (event.type === 'tool_end') {
        setLogs((curr) => [
          ...curr,
          { id: crypto.randomUUID(), kind: 'tool', name: event.name || 'tool', text: String(event.result || '').slice(0, 900) }
        ])
      }
      if (event.type === 'preview' && event.path) setPreview(window.gcp.toPreviewUrl(event.path))
      if (event.type === 'model' && event.path) {
        // Bust the cache so a rebuilt world replaces the mesh already on screen.
        setModel(`${window.gcp.toPreviewUrl(event.path)}&v=${Date.now()}`)
      }
      if (event.type === 'scene') setScene(event.scene as SceneDump)
      if (event.type === 'error' && event.text) {
        setLogs((curr) => [...curr, { id: crypto.randomUUID(), kind: 'error', text: event.text || '' }])
        setStatus(event.text)
      }
      if (event.type === 'done') {
        setBusy(false)
        setStatus(event.summary || 'Complete')
        streamRef.current = ''
        refresh()
      }
    })
  }, [])

  function listen(target: 'home' | 'live') {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => MicRec }).webkitSpeechRecognition
    if (!SR) {
      setStatus('Voice is not available in this build of Chromium.')
      return
    }
    recRef.current?.stop()
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.onresult = (ev: MicEvent) => {
      const text = Array.from({ length: ev.results.length }, (_, i) => ev.results[i][0].transcript).join(' ')
      if (target === 'home') setPrompt(text)
      else setLivePrompt(text)
    }
    rec.onend = () => setListening(false)
    rec.start()
    recRef.current = rec
    setListening(true)
  }

  async function createAndRun() {
    if (!prompt.trim() || busy) return
    setBusy(true)
    try {
      const created = (await window.gcp.worlds.create({
        title: prompt.trim().slice(0, 48),
        brief: prompt.trim(),
        mode
      })) as World
      setWorld(created)
      setLogs([{ id: crypto.randomUUID(), kind: 'user', text: prompt.trim() }])
      setPreview('')
      setModel('')
      setScene(null)
      setView('studio')
      setStatus('Starting agent…')
      await window.gcp.agent.run({ worldId: created.id, message: prompt.trim() })
    } catch (err) {
      setBusy(false)
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  async function openWorld(next: World) {
    setWorld(next)
    setLogs([{ id: crypto.randomUUID(), kind: 'status', text: `Opened ${next.title}` }])
    setPreview(window.gcp.toPreviewUrl(next.previewPath))
    setModel(next.glbPath ? window.gcp.toPreviewUrl(next.glbPath) : '')
    setView('studio')
    setMode(next.mode || 'generative')
  }

  async function sendLive() {
    if (!world || !livePrompt.trim() || busy) return
    setBusy(true)
    setLogs((curr) => [...curr, { id: crypto.randomUUID(), kind: 'user', text: livePrompt.trim() }])
    const message = livePrompt.trim()
    setLivePrompt('')
    try {
      await window.gcp.agent.run({ worldId: world.id, message, live: true })
    } catch (err) {
      setBusy(false)
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }

  const objects = scene?.objects ?? []
  const physics = objects.filter((o) => o.physics || o.tags?.gcp_physics || o.tags?.gcp_kind === 'collider' || o.tags?.gcp_kind === 'graspable')
  const spawns = objects.filter((o) => o.tags?.gcp_kind === 'spawn' || o.tags?.gcp_kind === 'encounter' || o.tags?.gcp_kind === 'player_anchor')
  const cameras = objects.filter((o) => o.type === 'CAMERA')

  return (
    <div className="app" data-mode={world?.mode ?? mode}>
      <header className="titlebar">
        <div className="brand">
          <span className="mark" />
          GameCreator Prime
        </div>
        <div className="title-actions">
          <button className={`chip ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>
            Studio
          </button>
          <button className={`chip ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            Providers
          </button>
          {provider && settings && (
            <span className="chip active model-chip" title={`${provider.name} · ${settings.modelId}`}>
              {provider.name} · {settings.modelId}
            </span>
          )}
        </div>
      </header>

      <main className="stage">
        {view === 'home' && (
          <div className="home">
            <div className="kicker">Free world studio · Blender Python agent</div>
            <h1 className="display">Build worlds the player can inhabit.</h1>
            <p className="lede">
              An agent harness that drives Blender: train bodies with real collisions, grow a level while someone is
              standing inside it, and direct cameras, lights, and animation for games and film.
            </p>
            <div className="modes">
              {STUDIO_MODES.map((item) => (
                <button
                  key={item.id}
                  className={`mode-card ${mode === item.id ? 'active' : ''}`}
                  onClick={() => {
                    setMode(item.id)
                    setPrompt(item.examples[0])
                  }}
                >
                  <div className="kicker">{item.kicker}</div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </button>
              ))}
            </div>
            <div className={`composer ${listening ? 'listening' : ''}`}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={meta.prompt}
              />
              <div className="composer-row">
                <div className="examples">
                  {meta.examples.map((ex) => (
                    <button key={ex} className="example" onClick={() => setPrompt(ex)}>
                      {ex.slice(0, 42)}…
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="ghost" onClick={() => listen('home')}>
                    {listening ? 'Listening' : 'Voice'}
                  </button>
                  <button className="primary" disabled={busy || !prompt.trim()} onClick={createAndRun}>
                    {busy ? 'Building…' : 'Direct the agent'}
                  </button>
                </div>
              </div>
            </div>
            <section className="library">
              <h2>Recent worlds</h2>
              <div className="cards">
                {worlds.length === 0 && <p className="empty-note">No worlds yet. Pick a mode and send a brief.</p>}
                {worlds.map((item) => (
                  <button key={item.id} className="world-card" onClick={() => openWorld(item)}>
                    <div
                      className="thumb"
                      style={
                        item.previewPath
                          ? { backgroundImage: `url("${window.gcp.toPreviewUrl(item.previewPath)}")` }
                          : undefined
                      }
                    />
                    <div className="meta">
                      <h4>{item.title}</h4>
                      <p>
                        {item.mode} · {item.status}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === 'studio' && world && (
          <div className="studio">
            <section className="col">
              <div className="col-head">
                <h3>Agent</h3>
                <button className="ghost" onClick={() => world && window.gcp.agent.stop(world.id)}>
                  Stop
                </button>
              </div>
              <div className="transcript">
                {logs.map((item) =>
                  item.kind === 'tool' ? (
                    <div className="tool" key={item.id}>
                      <strong>{item.name}</strong>
                      {'\n'}
                      {item.text}
                    </div>
                  ) : (
                    <div className={`bubble ${item.kind}`} key={item.id}>
                      {item.text}
                    </div>
                  )
                )}
              </div>
              <div className="livebar">
                <textarea
                  value={livePrompt}
                  placeholder={
                    world.mode === 'generative'
                      ? 'Live prompt: raise a tower, spawn two sentries…'
                      : world.mode === 'embodiment'
                        ? 'Live prompt: add stairs, a mug, a waypoint loop…'
                        : 'Live prompt: dolly in, rim lights, follow cam…'
                  }
                  onChange={(e) => setLivePrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendLive()
                    }
                  }}
                />
                <div style={{ display: 'grid', gap: 8 }}>
                  <button className="ghost" onClick={() => listen('live')}>
                    Mic
                  </button>
                  <button className="primary" disabled={busy} onClick={sendLive}>
                    Live
                  </button>
                </div>
              </div>
            </section>
            <section className="col" style={{ borderRight: 0 }}>
              <div className="col-head">
                <h3>{modeMeta(world.mode).title}</h3>
                <button className="ghost" onClick={() => window.gcp.worlds.openFolder(world.id)}>
                  Folder
                </button>
              </div>
              <div className="viewport">
                <div className="badge">{world.mode} · {world.status}</div>
                {(model || preview) && (
                  <div className="view-toggle">
                    <button
                      className={`chip ${view3d && model ? 'active' : ''}`}
                      disabled={!model}
                      onClick={() => setView3d(true)}
                    >
                      3D
                    </button>
                    <button
                      className={`chip ${!view3d || !model ? 'active' : ''}`}
                      disabled={!preview}
                      onClick={() => setView3d(false)}
                    >
                      Still
                    </button>
                  </div>
                )}
                {view3d && model ? (
                  <WorldViewport src={model} onError={setStatus} />
                ) : preview ? (
                  <img src={preview} alt="World preview" />
                ) : (
                  <div className="empty">
                    <h2>The stage is dark.</h2>
                    <p>The agent is writing Blender Python and will light this viewport when the world lands.</p>
                  </div>
                )}
              </div>
            </section>
            <aside className="col">
              <div className="col-head">
                <h3>Inspector</h3>
              </div>
              <div className="tabs">
                {(['objects', 'physics', 'spawn', 'cameras'] as const).map((id) => (
                  <button key={id} className={`chip ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                    {id}
                  </button>
                ))}
              </div>
              <div className="inspector">
                {(tab === 'objects' ? objects : tab === 'physics' ? physics : tab === 'spawn' ? spawns : cameras).map(
                  (obj) => (
                    <div className="row" key={obj.name}>
                      <b>{obj.name}</b>
                      <span>{obj.physics || obj.type}</span>
                    </div>
                  )
                )}
                {!(tab === 'objects' ? objects : tab === 'physics' ? physics : tab === 'spawn' ? spawns : cameras).length && (
                  <div className="empty-note">Nothing tagged yet. After the first Blender run, this fills from the scene dump.</div>
                )}
              </div>
            </aside>
          </div>
        )}

        {view === 'settings' && settings && (
          <SettingsView
            settings={settings}
            providers={providers}
            onSave={async (patch) => {
              const next = await window.gcp.settings.set(patch)
              setSettings(next)
            }}
          />
        )}
      </main>
      <footer className="status">
        <span className="status-msg" title={status}>
          {status}
        </span>
        <span className="status-stack" title="Ollama Cloud · OpenAI · Anthropic · Gemini · Groq · OpenRouter · Local">
          Ollama Cloud · OpenAI · Anthropic · Gemini · Groq · OpenRouter · Local
        </span>
      </footer>
    </div>
  )
}

function SettingsView({
  settings,
  providers,
  onSave
}: {
  settings: Settings
  providers: Provider[]
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState(settings)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [blenderHits, setBlenderHits] = useState<string[]>([])
  const selected = providers.find((p) => p.id === draft.providerId)

  useEffect(() => {
    window.gcp.blender.detect().then(setBlenderHits)
  }, [])

  return (
    <div className="settings">
      <div className="kicker">Premium, free to ship</div>
      <h1>Keys, models, Blender.</h1>
      <p className="lede">
        Ollama Cloud is first-class. Add any OpenAI-compatible provider, Anthropic, Gemini, Groq, or a custom endpoint.
        API keys are stored with OS encryption.
      </p>
      <div className="settings-grid">
        <div className="field">
          <label>Provider</label>
          <select
            value={draft.providerId}
            onChange={(e) => {
              const provider = providers.find((p) => p.id === e.target.value)
              setDraft({
                ...draft,
                providerId: e.target.value,
                modelId: provider?.models[0]?.id || draft.modelId
              })
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Model</label>
          <select value={draft.modelId} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}>
            {(selected?.models || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.tag ? ` · ${m.tag}` : ''}
              </option>
            ))}
          </select>
        </div>
        {selected && (
          <div className="field">
            <label>{selected.name} API key</label>
            <input
              type="password"
              placeholder={selected.keyHint}
              value={keys[selected.id] || ''}
              onChange={(e) => setKeys({ ...keys, [selected.id]: e.target.value })}
            />
            <div className="help">{selected.keyOptional ? 'Optional for local Ollama.' : selected.keyHint}</div>
          </div>
        )}
        {draft.providerId === 'custom' && (
          <>
            <div className="field">
              <label>Custom base URL</label>
              <input
                value={draft.customBaseUrl}
                onChange={(e) => setDraft({ ...draft, customBaseUrl: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Custom model id</label>
              <input
                value={draft.customModelId}
                onChange={(e) => setDraft({ ...draft, customModelId: e.target.value })}
              />
            </div>
          </>
        )}
        <div className="field">
          <label>Blender executable</label>
          <input
            value={draft.blenderPath}
            placeholder="C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"
            onChange={(e) => setDraft({ ...draft, blenderPath: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              className="ghost"
              onClick={async () => {
                const picked = await window.gcp.blender.pick()
                if (picked) setDraft({ ...draft, blenderPath: picked })
              }}
            >
              Browse
            </button>
            {blenderHits.slice(0, 3).map((hit) => (
              <button key={hit} className="example" onClick={() => setDraft({ ...draft, blenderPath: hit })}>
                {hit}
              </button>
            ))}
          </div>
        </div>
        <div>
          <button
            className="primary"
            onClick={() =>
              onSave({
                providerId: draft.providerId,
                modelId: draft.modelId,
                customBaseUrl: draft.customBaseUrl,
                customModelId: draft.customModelId,
                blenderPath: draft.blenderPath,
                maxAgentSteps: draft.maxAgentSteps,
                temperature: draft.temperature,
                apiKeys: keys
              })
            }
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  )
}

type MicRec = {
  lang: string
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((ev: MicEvent) => void) | null
  onend: (() => void) | null
}
type MicEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> }
