import { useEffect, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type Status = 'empty' | 'loading' | 'ready' | 'error'

/**
 * Live 3D view of the exported world. The still render is a second opinion;
 * this is the thing the director actually navigates.
 */
export default function WorldViewport({ src, onError }: { src: string; onError?: (msg: string) => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const frameRef = useRef<() => void>(() => {})
  const [status, setStatus] = useState<Status>('empty')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !src) {
      setStatus('empty')
      return
    }
    setStatus('loading')

    const renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    mount.appendChild(renderer.domElement)

    const scene = new Scene()
    scene.background = new Color(0x0b0e14)
    scene.fog = new Fog(0x0b0e14, 60, 400)

    const camera = new PerspectiveCamera(45, 1, 0.1, 5000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.495
    controlsRef.current = controls

    scene.add(new AmbientLight(0xbcd2e8, 1.1))
    const key = new DirectionalLight(0xfff2dc, 2.2)
    key.position.set(40, 60, 25)
    scene.add(key)
    const rim = new DirectionalLight(0x8fb6ff, 0.8)
    rim.position.set(-50, 20, -40)
    scene.add(rim)

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()

    let disposed = false
    let raf = 0
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }

    const loader = new GLTFLoader()
    loader.load(
      src,
      (gltf) => {
        if (disposed) return
        scene.add(gltf.scene)

        const box = new Box3().setFromObject(gltf.scene)
        const size = box.getSize(new Vector3())
        const center = box.getCenter(new Vector3())
        const span = Math.max(size.x, size.y, size.z) || 10
        controls.target.copy(center)
        camera.position.set(center.x + span * 0.55, center.y + span * 0.42, center.z + span * 0.75)
        camera.near = span / 500
        camera.far = span * 12
        camera.updateProjectionMatrix()
        scene.fog = new Fog(0x0b0e14, span * 0.9, span * 4)
        controls.update()

        frameRef.current = () => {
          controls.target.copy(center)
          camera.position.set(center.x + span * 0.55, center.y + span * 0.42, center.z + span * 0.75)
          controls.update()
        }
        setStatus('ready')
        tick()
      },
      undefined,
      (err) => {
        if (disposed) return
        setStatus('error')
        onError?.(err instanceof Error ? err.message : 'Could not load the exported GLB.')
      }
    )

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      scene.traverse((obj) => {
        const mesh = obj as { geometry?: { dispose(): void }; material?: unknown }
        mesh.geometry?.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => (m as { dispose(): void }).dispose())
        else if (mat) (mat as { dispose(): void }).dispose()
      })
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [src, onError])

  return (
    <div className="viewport3d">
      <div className="viewport3d-canvas" ref={mountRef} />
      {status === 'loading' && <div className="viewport3d-note">Loading the world…</div>}
      {status === 'error' && <div className="viewport3d-note">The GLB could not be loaded.</div>}
      {status === 'ready' && (
        <button className="ghost viewport3d-reframe" onClick={() => frameRef.current()}>
          Reframe
        </button>
      )}
    </div>
  )
}
