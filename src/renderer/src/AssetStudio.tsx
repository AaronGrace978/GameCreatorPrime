import { useEffect, useState } from 'react'
import type { AssetRecord, AssetPreset } from '@shared/assets'
import { ASSET_PRESETS } from '@shared/assets'
import WorldViewport from './WorldViewport'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function AssetStudio() {
  const [items, setItems] = useState<AssetRecord[]>([])
  const [selected, setSelected] = useState<AssetRecord | null>(null)
  const [title, setTitle] = useState('')
  const [preset, setPreset] = useState<AssetPreset>('balanced')
  const [seed, setSeed] = useState(1234)
  const [server, setServer] = useState('http://127.0.0.1:8081')
  const [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const generating = items.some(item => item.status === 'generating')

  useEffect(() => {
    window.gcp.assets.list().then(next => { setItems(next); setSelected(next[0] ?? null); setTitle(next[0]?.title ?? '') }).catch(e => setNotice(message(e)))
    window.gcp.settings.get().then(s => setServer(s.assetServerUrl)).catch(e => setNotice(message(e)))
    return window.gcp.assets.onChange(asset => {
      setItems(current => [asset, ...current.filter(a => a.id !== asset.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      setSelected(current => current?.id === asset.id || asset.status === 'generating' ? asset : current)
    })
  }, [])

  function select(asset: AssetRecord) {
    setSelected(asset); setTitle(asset.title); setNotice('')
    setPreset(asset.preset ?? 'balanced'); setSeed(asset.seed ?? 1234)
  }

  async function choose(kind: 'reference' | 'import') {
    setNotice('')
    try { const asset = await window.gcp.assets[kind](); if (asset) select(asset) }
    catch (e) { setNotice(message(e)) }
  }

  async function generate() {
    if (!selected || working || generating) return
    setWorking(true); setNotice('')
    try {
      const result = await window.gcp.assets.generate({ id: selected.id, title, preset, seed })
      setSelected(result)
    } catch (e) { setNotice(message(e)) }
    finally { setWorking(false) }
  }

  return <div className="asset-studio">
    <aside className="asset-controls">
      <div className="kicker">Image to 3D · Local generation</div>
      <h1>Create a hero asset.</h1>
      <p className="help">Start with one object, a clear silhouette, and an uncluttered background. Generate geometry and PBR textures on your NVIDIA GPU.</p>
      <div className="asset-actions">
        <button className="primary" onClick={() => choose('reference')}>Choose reference</button>
        <button className="ghost" onClick={() => choose('import')}>Import GLB</button>
      </div>
      {selected?.referencePath && <img className="asset-reference" src={window.gcp.toPreviewUrl(selected.referencePath)} alt="Generation reference" />}
      {selected?.referenceWidth && <div className="help">{selected.referenceWidth} × {selected.referenceHeight} reference</div>}
      <label className="field">Asset name<input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} /></label>
      <label className="field">Generation quality<select value={preset} onChange={e => setPreset(e.target.value as AssetPreset)}>
        {Object.entries(ASSET_PRESETS).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}
      </select></label>
      <p className="help">{preset === 'balanced' ? '30 geometry steps · 6 texture views. Start here on a 16 GB GPU.' : '50 geometry steps · 9 texture views. Requires more memory; test on your GPU before batch work.'} Original models are retained for every attempt.</p>
      <label className="field">Geometry seed<input type="number" min={0} max={4294967295} step={1} value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
      <button className="primary asset-generate" disabled={!selected?.referencePath || !title.trim() || working || generating || !Number.isInteger(seed) || seed < 0 || seed > 4294967295} onClick={generate}>
        {working || generating ? 'Generating…' : selected?.modelPath ? 'Generate another version' : 'Generate textured asset'}
      </button>
      {generating && <button className="ghost" onClick={() => {
        const active = items.find(a => a.status === 'generating')
        if (active) window.gcp.assets.cancel(active.id).catch(e => setNotice(message(e)))
      }}>Cancel request</button>}
      <details className="asset-connection"><summary>Generation server</summary>
        <label className="field">Server URL<input value={server} onChange={e => setServer(e.target.value)} /></label>
        <button className="ghost" onClick={async () => {
          try { await window.gcp.settings.set({ assetServerUrl: server.trim() }); setNotice('Server connection saved.') }
          catch (e) { setNotice(message(e)) }
        }}>Save server</button>
        <button className="ghost" onClick={async () => {
          try { const health = await window.gcp.assets.checkServer(server.trim()); setNotice(`Server ${health.status} · ${health.memoryMode} memory mode. Model inference is checked when you generate.`) }
          catch (e) { setNotice(message(e)) }
        }}>Check connection</button>
        <p className="help">Start the GameCreator backend from services/hunyuan on your GPU machine. Generation runs locally; no provider key is needed.</p>
        <div className="asset-actions">
          <button className="ghost" onClick={() => window.gcp.assets.setupFolder().catch(e => setNotice(message(e)))}>Backend files</button>
          <button className="ghost" onClick={() => window.gcp.assets.setupGuide().catch(e => setNotice(message(e)))}>GPU setup guide</button>
        </div>
      </details>
      {notice && <p className="asset-notice" role="status">{notice}</p>}
    </aside>
    <section className="asset-main">
      <div className="col-head"><h2>{selected?.title ?? 'Asset workbench'}</h2><span className="chip">{selected?.status ?? 'Choose a reference'}</span></div>
      <div className="asset-preview">
        {selected?.modelPath ? <WorldViewport src={window.gcp.toPreviewUrl(selected.modelPath)} onError={setNotice} /> : <div className="asset-empty">
          <span className="asset-orbit" aria-hidden="true">◇</span>
          <h2>{selected?.status === 'generating' ? 'Building shape and materials' : 'From reference to playable asset'}</h2>
          <p>{selected?.status === 'generating' ? 'Geometry and texturing can take several minutes. This is real model inference; completion appears when the GLB arrives.' : 'Inspect the generated mesh here, check its materials, and prepare a Blender scene.'}</p>
        </div>}
      </div>
      {selected?.error && <p className="asset-notice" role="alert">{selected.error}</p>}
      {selected?.report && <section className="asset-report" aria-label="Asset checks">
        <div className="asset-metrics">
          <div><b>{selected.report.triangles.toLocaleString()}</b><span>Triangles</span></div>
          <div><b>{selected.report.materials}</b><span>Materials</span></div>
          <div><b>{selected.report.images}</b><span>Embedded textures</span></div>
          <div><b>{selected.report.hasUVs ? 'Present' : 'Missing'}</b><span>UVs</span></div>
        </div>
        <ul>{selected.report.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        <div className="asset-actions">
          <button className="primary" onClick={async () => {
            try { if (await window.gcp.assets.export(selected.id)) setNotice('Original GLB exported.') } catch (e) { setNotice(message(e)) }
          }}>Export GLB</button>
          <button className="ghost" disabled={preparing} onClick={async () => {
            setPreparing(true); setNotice('Preparing a Blender scene…')
            try { const result = await window.gcp.assets.blend(selected.id); setSelected(result); setNotice('asset.blend saved with the mesh, materials, camera, and studio lighting.') }
            catch (e) { setNotice(message(e)) } finally { setPreparing(false) }
          }}>{preparing ? 'Preparing…' : 'Prepare Blender scene'}</button>
          <button className="ghost" onClick={() => window.gcp.assets.folder(selected.id).catch(e => setNotice(message(e)))}>Open folder</button>
        </div>
      </section>}
      <section className="asset-library"><h3>Asset library</h3>
        {!items.length && <p className="help">Your references and generated versions will appear here.</p>}
        <div className="asset-versions">{items.map(asset => <button key={asset.id} className={`asset-version ${selected?.id === asset.id ? 'active' : ''}`} onClick={() => select(asset)}>
          <b>{asset.title}</b><span>{asset.status} · {asset.preset ?? asset.source}{asset.seed !== undefined ? ` · seed ${asset.seed}` : ''}</span>
        </button>)}</div>
      </section>
    </section>
  </div>
}
