import { useEffect, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  LoadingManager,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

type Status = 'empty' | 'loading' | 'ready' | 'error' | 'incomplete'

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

    let renderer: WebGLRenderer
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true }) }
    catch {
      setStatus('error')
      onError?.('A WebGL context could not be created. Check your graphics driver and restart the app.')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    mount.appendChild(renderer.domElement)

    const scene = new Scene()
    const pmrem = new PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const environment = pmrem.fromScene(room, 0.04)
    scene.environment = environment.texture
    room.dispose()
    pmrem.dispose()
    scene.background = new Color(0x0b0e14)
    scene.fog = new Fog(0x0b0e14, 60, 400)

    const camera = new PerspectiveCamera(45, 1, 0.1, 5000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI
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

    let resourceFailed = false
    const manager = new LoadingManager()
    manager.onError = () => { resourceFailed = true }
    const loader = new GLTFLoader(manager)
    loader.load(
      src,
      (gltf) => {
        if (disposed) {
          disposeModel(gltf.scene)
          return
        }
        scene.add(gltf.scene)

        const box = new Box3().setFromObject(gltf.scene)
        const size = box.getSize(new Vector3())
        const center = box.getCenter(new Vector3())
        const span = Math.max(size.x, size.y, size.z) || 10
        camera.near = span / 500
        camera.far = span * 12
        camera.updateProjectionMatrix()
        scene.fog = new Fog(0x0b0e14, span * 0.9, span * 4)
        frameRef.current = () => {
          const halfFov = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect))
          const distance = box.getBoundingSphere(new Sphere()).radius / Math.sin(halfFov) * 1.15
          controls.target.copy(center)
          camera.position.copy(center).add(new Vector3(0.55, 0.42, 0.75).normalize().multiplyScalar(distance))
          controls.update()
        }
        frameRef.current()
        setStatus(resourceFailed ? 'incomplete' : 'ready')
        if (resourceFailed) onError?.('Some model textures could not be loaded. Check the asset and reload it before judging its materials.')
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
      disposeModel(scene)
      environment.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [src, onError])

  return (
    <div className="viewport3d">
      <div className="viewport3d-canvas" ref={mountRef} />
      {status === 'loading' && <div className="viewport3d-note">Loading the world…</div>}
      {status === 'error' && <div className="viewport3d-note">The GLB could not be loaded.</div>}
      {status === 'incomplete' && <div className="viewport3d-note">Some textures could not be loaded.</div>}
      {status === 'ready' && (
        <button className="ghost viewport3d-reframe" onClick={() => frameRef.current()}>
          Reframe
        </button>
      )}
    </div>
  )
}

function disposeModel(root: import('three').Object3D) {
  const textures = new Set<import('three').Texture>()
  root.traverse(obj => {
    const mesh = obj as import('three').Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      for (const value of Object.values(material)) if (value && (value as import('three').Texture).isTexture) textures.add(value as import('three').Texture)
      material.dispose()
    }
  })
  textures.forEach(texture => texture.dispose())
}
