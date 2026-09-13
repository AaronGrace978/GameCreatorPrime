"""
GameCreator Prime — Blender world SDK.

Agents should prefer these helpers over raw bpy. Scale is 1 Blender unit = 1 meter.
Collections are the contract the inspector and exporters rely on:

  ENV        terrain, architecture, sky
  PROPS      set dressing
  ACTORS     characters, robots, pawns
  PHYSICS    rigid bodies, colliders, graspables
  NAV        waypoints, volumes, locomotion paths
  SPAWN      live generative markers (enemies, loot, events)
  LIGHTS     game + cinematic lighting
  CAMERAS    gameplay cameras and shot cameras
  ANIM       armatures, actions, NLA
"""

from __future__ import annotations

import json
import math
import os
import random
from typing import Iterable, Sequence

import bpy
from mathutils import Euler, Vector
from mathutils import noise as bl_noise

PROJECT_DIR = ""
BLEND_PATH = ""
RENDER_DIR = ""
EXPORT_DIR = ""
MODE = "generative"
_configured = False


def configure(*, project_dir: str, blend_path: str, render_dir: str, export_dir: str, mode: str = "generative") -> None:
    global PROJECT_DIR, BLEND_PATH, RENDER_DIR, EXPORT_DIR, MODE, _configured
    PROJECT_DIR = project_dir
    BLEND_PATH = blend_path
    RENDER_DIR = render_dir
    EXPORT_DIR = export_dir
    MODE = mode
    _configured = True
    os.makedirs(RENDER_DIR, exist_ok=True)
    os.makedirs(EXPORT_DIR, exist_ok=True)
    os.makedirs(os.path.join(PROJECT_DIR, "scripts"), exist_ok=True)


def open_or_reset(live: bool = False) -> None:
    """Open the world .blend for live mutation, otherwise start a clean scene."""
    if live and BLEND_PATH and os.path.exists(BLEND_PATH):
        bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
        return
    reset_scene()


def _available_engines(scene) -> list[str]:
    try:
        return [item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items]
    except Exception:
        return []


def _set_render_engine(scene) -> None:
    """Blender 4.2 used BLENDER_EEVEE_NEXT; 5.x LTS restored BLENDER_EEVEE."""
    available = _available_engines(scene)
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE", "BLENDER_WORKBENCH", "CYCLES"):
        if available and candidate not in available:
            continue
        try:
            scene.render.engine = candidate
            return
        except Exception:
            continue


def _set_quality(scene) -> None:
    """Preview stills are the only thing the director ever sees. Don't ship noise."""
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        for attr, value in (
            ("taa_render_samples", 64),
            ("use_raytracing", True),
            ("use_shadows", True),
            ("volumetric_samples", 64),
        ):
            try:
                setattr(eevee, attr, value)
            except Exception:
                pass
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium Contrast"
    except Exception:
        pass


def reset_scene() -> None:
    try:
        bpy.ops.wm.read_homefile(use_empty=True)
    except Exception:
        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    _set_render_engine(scene)
    _set_quality(scene)
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 120
    scene.world = bpy.data.worlds.new("GCP_World")
    sky()
    for name in (
        "ENV",
        "PROPS",
        "ACTORS",
        "PHYSICS",
        "NAV",
        "SPAWN",
        "LIGHTS",
        "CAMERAS",
        "ANIM",
        "GAMEPLAY",
    ):
        collection(name)
    _ensure_rigidworld()


def collection(name: str) -> bpy.types.Collection:
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def _scene_collections() -> set:
    scene_col = bpy.context.scene.collection
    seen = {scene_col}
    stack = [scene_col]
    while stack:
        for child in stack.pop().children:
            if child not in seen:
                seen.add(child)
                stack.append(child)
    return seen


def _link(obj: bpy.types.Object, col_name: str) -> bpy.types.Object:
    """Move obj into one authored collection.

    Only scene-tree collections are unlinked. RigidBodyWorld lives outside the
    scene tree, and dropping the object from it removes it from the simulation.
    """
    target = collection(col_name)
    scene_cols = _scene_collections()
    for col in list(obj.users_collection):
        if col is not target and col in scene_cols:
            col.objects.unlink(obj)
    if obj.name not in target.objects:
        target.objects.link(obj)
    return obj


def _mesh_obj(name: str, mesh: bpy.types.Mesh, col: str, location=(0, 0, 0)) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    return _link(obj, col)


def primitive(kind: str, name: str, col: str = "PROPS", location=(0, 0, 0), scale=(1, 1, 1), **kw):
    if kind == "plane":
        bpy.ops.mesh.primitive_plane_add(location=location)
    elif kind == "uv_sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(location=location)
    elif kind == "ico":
        bpy.ops.mesh.primitive_ico_sphere_add(location=location)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(location=location)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(location=location)
    else:
        bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if kind == "capsule":
        _make_capsule(obj, height=kw.get("depth", 1.8), radius=kw.get("radius", 0.35))
    return _link(obj, col)


def _make_capsule(obj: bpy.types.Object, height: float, radius: float) -> None:
    obj.dimensions = (radius * 2, radius * 2, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def ground(size: float = 40.0, name: str = "Ground") -> bpy.types.Object:
    obj = primitive("plane", name, "ENV", location=(0, 0, 0), scale=(size / 2, size / 2, 1))
    assign_mat(obj, pbr("GroundMat", (0.18, 0.2, 0.16, 1), roughness=0.85))
    rigid(obj, "PASSIVE", "MESH")
    return obj


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    """Ease between two thresholds. Use it to blend paths and clearings."""
    if edge1 == edge0:
        return 0.0 if x < edge0 else 1.0
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def height_noise(x: float, y: float, scale: float = 0.012, octaves: int = 4, seed: int = 7) -> float:
    """Smooth fractal hills in roughly -1..1. Build height fields out of this."""
    off = seed * 17.13
    return bl_noise.fractal(Vector((x * scale + off, y * scale + off, 0.0)), 1.0, 2.0, octaves)


def terrain(
    name: str = "Terrain",
    size=48.0,
    cuts: int = 32,
    height=3.0,
    seed: int = 7,
    live_shift: float = 0.0,
    rim_falloff: bool = True,
    smooth: bool = True,
) -> bpy.types.Object:
    """Displaced ground plane.

    size   — a number or (x, y) / (x, y, z) full extents in meters.
    height — an amplitude in meters for smooth fractal hills, OR a callable
             f(x, y) -> z for an authored height field. Use a callable to carve
             paths, flatten clearings, and raise ridges:

                 def land(x, y):
                     h = height_noise(x, y, seed=7) * 6.0
                     h *= smoothstep(2.0, 7.0, abs(x))   # flatten a path corridor at x=0
                     return h

             smoothstep returns 0 inside edge0 and 1 outside edge1, so multiplying
             by it flattens the middle. Multiply by (1 - smoothstep) to do the
             opposite and keep only the middle.

                 terrain("Ridge", size=(200, 200), cuts=96, height=land)
    """
    sx, sy, _ = _size3(size)
    obj = primitive("plane", name, "ENV", scale=(sx / 2, sy / 2, 1))
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.subdivide(number_cuts=cuts)
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh = obj.data
    authored = callable(height)
    amplitude = 0.0 if authored else float(height)
    for v in mesh.vertices:
        x, y = v.co.x, v.co.y
        if authored:
            v.co.z += float(height(x, y))
            continue
        z = height_noise(x + live_shift * 10.0, y, seed=seed) * amplitude
        if rim_falloff:
            edge = max(abs(x) / (sx / 2 + 1e-6), abs(y) / (sy / 2 + 1e-6))
            z *= 1.0 - smoothstep(0.72, 1.0, edge)
        v.co.z += z
    mesh.update()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    assign_mat(obj, pbr("TerrainMat", (0.16, 0.28, 0.14, 1), roughness=0.9))
    rigid(obj, "PASSIVE", "MESH")
    tag(obj, gcp_kind="terrain")
    return obj


def sample_height(obj: bpy.types.Object, x: float, y: float) -> float:
    """World-space ground height under (x, y). Use it to sit props on terrain."""
    origin = Vector((x, y, 1000.0))
    hit, location, _, _ = obj.ray_cast(obj.matrix_world.inverted() @ origin, Vector((0, 0, -1)))
    if hit:
        return (obj.matrix_world @ location).z
    return 0.0


def _frames2(frames, start: int = 1) -> tuple[int, int]:
    """Accept a frame count or an explicit (start, end) range."""
    if isinstance(frames, (int, float)):
        return (start, max(start + 1, int(frames)))
    seq = [int(f) for f in frames]
    if len(seq) == 1:
        return (start, max(start + 1, seq[0]))
    return (seq[0], max(seq[0] + 1, seq[1]))


def _size3(size) -> tuple[float, float, float]:
    """Accept a number or an (x, y, z) sequence as full-extent dimensions."""
    if isinstance(size, (int, float)):
        v = float(size)
        return (v, v, v)
    seq = [float(s) for s in size]
    while len(seq) < 3:
        seq.append(seq[-1] if seq else 1.0)
    return (seq[0], seq[1], seq[2])


def _half3(size) -> tuple[float, float, float]:
    x, y, z = _size3(size)
    return (x / 2, y / 2, z / 2)


def _rgba(value, alpha: float = 1.0) -> tuple[float, float, float, float]:
    seq = tuple(value)
    if len(seq) >= 4:
        return (float(seq[0]), float(seq[1]), float(seq[2]), float(seq[3]))
    if len(seq) == 3:
        return (float(seq[0]), float(seq[1]), float(seq[2]), alpha)
    if len(seq) == 1:
        v = float(seq[0])
        return (v, v, v, alpha)
    return (0.0, 0.0, 0.0, alpha)


def pbr(
    name: str,
    color=(0.8, 0.8, 0.8, 1),
    roughness: float = 0.5,
    metallic: float = 0.0,
    emission=(0, 0, 0, 1),
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    principled = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    principled.inputs["Base Color"].default_value = _rgba(color)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    emit = _rgba(emission)
    if "Emission Color" in principled.inputs:
        principled.inputs["Emission Color"].default_value = emit
        principled.inputs["Emission Strength"].default_value = emission_strength
    elif "Emission" in principled.inputs:
        principled.inputs["Emission"].default_value = emit
    return mat


def _output_node(nt, node_type: str, bl_idname: str):
    """Re-fetch by type. Node references go stale after nodes.remove()."""
    node = next((n for n in nt.nodes if n.type == node_type), None)
    return node if node is not None else nt.nodes.new(bl_idname)


def _world_tree():
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("GCP_World")
    scene.world.use_nodes = True
    return scene.world.node_tree


def sky(top=(0.05, 0.08, 0.14), horizon=(0.35, 0.38, 0.42), strength: float = 1.0):
    """Gradient sky dome on the world background. Replaces the flat reset color."""
    nt = _world_tree()
    for node in list(nt.nodes):
        if node.type in ("BACKGROUND", "TEX_GRADIENT", "VALTORGB", "MAPPING", "TEX_COORD", "SEPXYZ", "MAP_RANGE"):
            nt.nodes.remove(node)
    out = _output_node(nt, "OUTPUT_WORLD", "ShaderNodeOutputWorld")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    # The view vector's Z runs -1 at the nadir to +1 at the zenith.
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = -0.25
    rng.inputs["From Max"].default_value = 0.6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = _rgba(horizon)
    ramp.color_ramp.elements[1].color = _rgba(top)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return bpy.context.scene.world


def _scene_bounds(pad: float = 12.0):
    xs, ys, zs = [], [], []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.get("gcp_kind") == "fog":
            continue
        for corner in obj.bound_box:
            world_co = obj.matrix_world @ Vector(corner)
            xs.append(world_co.x)
            ys.append(world_co.y)
            zs.append(world_co.z)
    if not xs:
        return (0.0, 0.0, 15.0), (200.0, 200.0, 40.0)
    center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2 + pad / 2)
    size = (max(xs) - min(xs) + pad * 2, max(ys) - min(ys) + pad * 2, max(zs) - min(zs) + pad * 2)
    return center, size


def fog(density: float = 0.005, color=(0.62, 0.68, 0.74)):
    """Scene-wide volumetric haze covering everything built so far.

    A box volume, not a world volume: EEVEE renders world volumes as a black
    frame. Call this after the geometry exists so the box can enclose it.

    Density is extinction per meter. On a 150m landscape, 0.004-0.008 reads as
    distance haze; past ~0.02 the frame turns into milk.
    """
    existing = bpy.data.objects.get("GCP_Fog")
    if existing:
        bpy.data.objects.remove(existing, do_unlink=True)
    center, size = _scene_bounds()
    obj = fog_volume("GCP_Fog", center, size, density=density, color=color)
    tag(obj, gcp_fog_auto=True)
    return obj


def _refit_fog() -> None:
    """Re-enclose the scene so fog() can be called before the geometry exists."""
    obj = bpy.data.objects.get("GCP_Fog")
    if obj is None or not obj.get("gcp_fog_auto"):
        return
    center, size = _scene_bounds()
    obj.location = center
    obj.scale = (1, 1, 1)
    obj.dimensions = size


def fog_volume(name: str, location, size, density: float = 0.02, color=(0.72, 0.76, 0.8)):
    """A box of localized mist — ground haze, a foggy hollow, smoke in a room."""
    obj = primitive("cube", name, "ENV", location=location, scale=_half3(size))
    mat = bpy.data.materials.get(f"{name}Mat") or bpy.data.materials.new(f"{name}Mat")
    mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        if node.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(node)
    out = _output_node(nt, "OUTPUT_MATERIAL", "ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = _rgba(color)
    vol.inputs["Density"].default_value = density
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    assign_mat(obj, mat)
    obj.display_type = "WIRE"
    tag(obj, gcp_kind="fog")
    return obj


def _shade(color, factor: float):
    r, g, b, a = _rgba(color)
    return (min(1.0, r * factor), min(1.0, g * factor), min(1.0, b * factor), a)


def noise_material(
    name: str,
    color=(0.3, 0.3, 0.3),
    accent=None,
    scale: float = 6.0,
    roughness: float = 0.85,
    bump: float = 0.25,
    metallic: float = 0.0,
):
    """PBR with procedural colour break-up and bump.

    Flat single-colour materials are what make a world read as untextured
    plastic. Use this for ground, bark, rock, moss, plaster, snow.
    """
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        if node.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(node)
    out = _output_node(nt, "OUTPUT_MATERIAL", "ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = 8.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[0].color = _rgba(color)
    ramp.color_ramp.elements[1].color = _rgba(accent) if accent else _shade(color, 1.45)
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    if bump > 0:
        bump_node = nt.nodes.new("ShaderNodeBump")
        bump_node.inputs["Strength"].default_value = bump
        nt.links.new(tex.outputs["Fac"], bump_node.inputs["Height"])
        nt.links.new(bump_node.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _join(objects, name: str, col: str):
    objects = [o for o in objects if o is not None]
    if not objects:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    bpy.ops.object.select_all(action="DESELECT")
    return _link(joined, col)


def rock(name: str, location, size=1.6, seed: int = 1, col: str = "PROPS", color=(0.29, 0.28, 0.26)):
    """A displaced boulder. Beats a scaled sphere everywhere it is used."""
    sx, sy, sz = _size3(size)
    obj = primitive("ico", name, col, location=location, scale=(sx / 2, sy / 2, sz / 2))
    rng = random.Random(seed)
    jitter = Vector((rng.uniform(-40, 40), rng.uniform(-40, 40), rng.uniform(-40, 40)))
    for v in obj.data.vertices:
        amount = bl_noise.fractal(v.co * 1.8 + jitter, 1.0, 2.0, 3)
        v.co += v.co.normalized() * amount * (max(sx, sy, sz) * 0.16)
    obj.data.update()
    obj.rotation_euler = Euler((rng.uniform(0, 0.4), rng.uniform(0, 0.4), rng.uniform(0, 6.28)))
    assign_mat(obj, noise_material(f"M_Rock_{name}", color, scale=9.0, roughness=0.92, bump=0.4))
    tag(obj, gcp_kind="rock")
    return obj


def pine(
    name: str,
    location,
    height: float = 12.0,
    seed: int = 1,
    tiers: int = 6,
    col: str = "PROPS",
    trunk_color=(0.16, 0.11, 0.08),
    needle_color=(0.08, 0.16, 0.10),
):
    """A conifer built from a tapered trunk and jittered canopy tiers, joined
    into one object. Stacked identical cones are what make a forest look fake."""
    rng = random.Random(seed)
    x, y, z = location
    trunk_h = height * 0.55
    parts = []
    trunk = primitive("cone", f"{name}_trunk", col, location=(x, y, z + trunk_h / 2), scale=(height * 0.035, height * 0.035, trunk_h / 2))
    trunk.data.materials.clear()
    assign_mat(trunk, noise_material("M_Bark", trunk_color, scale=22.0, roughness=0.95, bump=0.55))
    parts.append(trunk)

    needles = noise_material("M_Needle", needle_color, accent=_shade(needle_color, 1.7), scale=7.0, roughness=0.8, bump=0.3)
    for tier in range(tiers):
        t = tier / max(1, tiers - 1)
        radius = height * 0.26 * (1.0 - t * 0.78) * rng.uniform(0.9, 1.1)
        tier_h = height * 0.30 * (1.0 - t * 0.45)
        cz = z + height * (0.32 + t * 0.60)
        cone = primitive(
            "cone",
            f"{name}_c{tier}",
            col,
            location=(x + rng.uniform(-0.12, 0.12), y + rng.uniform(-0.12, 0.12), cz),
            scale=(radius, radius, tier_h),
        )
        cone.rotation_euler = Euler((rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), rng.uniform(0, 6.28)))
        assign_mat(cone, needles)
        parts.append(cone)

    tree = _join(parts, name, col)
    tree.rotation_euler = Euler((rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), rng.uniform(0, 6.28)))
    tag(tree, gcp_kind="tree")
    return tree


def scatter_on(ground: bpy.types.Object, factory, count: int, region, seed: int = 1, reject=None, tries: int = 12):
    """Place props ON the terrain surface.

    factory(index, x, y, z, rng) -> object. reject(x, y) -> True to skip a spot,
    which is how you keep a path, clearing, or building footprint clear.
    """
    rng = random.Random(seed)
    x0, y0, x1, y1 = region
    made = []
    for i in range(count):
        for _ in range(tries):
            px = rng.uniform(x0, x1)
            py = rng.uniform(y0, y1)
            if reject and reject(px, py):
                continue
            pz = sample_height(ground, px, py)
            obj = factory(i, px, py, pz, rng)
            if obj is not None:
                made.append(obj)
            break
    return made


def clear_zone(location, radius: float, collections=("PROPS",)) -> int:
    """Delete scattered props inside a radius.

    Scatter first, then clear camera lanes, doorways, and spawn pads. A tree
    dropped on the beauty camera renders as a wall of foliage.
    """
    cx, cy = location[0], location[1]
    removed = 0
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        if collections and not any(c.name in collections for c in obj.users_collection):
            continue
        if math.hypot(obj.location.x - cx, obj.location.y - cy) <= radius:
            bpy.data.objects.remove(obj, do_unlink=True)
            removed += 1
    return removed


def clear_camera_lane(cam: bpy.types.Object, radius: float = 6.0, collections=("PROPS",)) -> int:
    """Clear props sitting on top of a camera. Call it after scattering."""
    return clear_zone((cam.location.x, cam.location.y), radius, collections)


def bevel(obj: bpy.types.Object, width: float = 0.03, segments: int = 2):
    """Catch a highlight on every edge. Raw boxes read as untextured blockout."""
    mod = obj.modifiers.new("GCP_Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    return obj


def smooth_subdiv(obj: bpy.types.Object, levels: int = 1):
    mod = obj.modifiers.new("GCP_Subdiv", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def displace_surface(obj: bpy.types.Object, strength: float = 0.3, scale: float = 1.2, seed: int = 1):
    tex = bpy.data.textures.new(f"{obj.name}_disp", "CLOUDS")
    tex.noise_scale = scale
    mod = obj.modifiers.new("GCP_Displace", "DISPLACE")
    mod.texture = tex
    mod.strength = strength
    return obj


def assign_mat(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def tag(obj: bpy.types.Object, **props) -> None:
    for k, v in props.items():
        obj[k] = v


def sun(energy: float = 6.0, rotation=(0.9, 0.2, 0.8), name: str = "KeySun") -> bpy.types.Object:
    light = bpy.data.lights.new(name, type="SUN")
    light.energy = energy
    obj = bpy.data.objects.new(name, light)
    obj.rotation_euler = Euler(rotation)
    return _link(obj, "LIGHTS")


def area_light(name: str, location, size: float = 3.0, energy: float = 250.0, color=(1, 0.95, 0.85)):
    light = bpy.data.lights.new(name, type="AREA")
    light.energy = energy
    light.size = size
    light.color = color[:3]
    obj = bpy.data.objects.new(name, light)
    obj.location = location
    return _link(obj, "LIGHTS")


def point_light(name: str, location, energy: float = 80.0, color=(1, 0.7, 0.4)):
    light = bpy.data.lights.new(name, type="POINT")
    light.energy = energy
    light.color = color[:3]
    obj = bpy.data.objects.new(name, light)
    obj.location = location
    return _link(obj, "LIGHTS")


def light_array(
    name: str,
    origin,
    count: int = 5,
    spacing: float = 2.0,
    axis: str = "X",
    energy: float = 120.0,
    color=(1, 0.85, 0.65),
) -> list:
    lights = []
    ox, oy, oz = origin
    for i in range(count):
        loc = [ox, oy, oz]
        idx = {"X": 0, "Y": 1, "Z": 2}[axis]
        loc[idx] += (i - (count - 1) / 2) * spacing
        lights.append(area_light(f"{name}_{i:02d}", tuple(loc), energy=energy, color=color))
    return lights


def _ensure_rigidworld() -> None:
    scene = bpy.context.scene
    if not scene.rigidbody_world:
        bpy.ops.rigidbody.world_add()
    scene.rigidbody_world.point_cache.frame_start = scene.frame_start
    scene.rigidbody_world.point_cache.frame_end = max(scene.frame_end, 250)


def rigid(obj: bpy.types.Object, body_type: str = "ACTIVE", shape: str = "CONVEX_HULL", mass: float = 1.0):
    _ensure_rigidworld()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if not obj.rigid_body:
        bpy.ops.rigidbody.object_add()
    obj.rigid_body.type = body_type
    obj.rigid_body.collision_shape = shape
    obj.rigid_body.mass = mass
    obj.rigid_body.friction = 0.7
    obj.rigid_body.restitution = 0.05
    if body_type == "ACTIVE":
        _link(obj, "PHYSICS")
    tag(obj, gcp_physics=body_type, gcp_collision=shape)
    return obj


def collision_box(name: str, location, size, invisible: bool = True):
    obj = primitive("cube", name, "PHYSICS", location=location, scale=_half3(size))
    rigid(obj, "PASSIVE", "BOX")
    if invisible:
        obj.display_type = "WIRE"
        obj.hide_render = True
    tag(obj, gcp_kind="collider")
    return obj


def character_capsule(
    name: str = "Pawn",
    location=(0, 0, 1.0),
    height: float = 1.8,
    radius: float = 0.32,
    mass: float = 70.0,
) -> bpy.types.Object:
    obj = primitive("capsule", name, "ACTORS", location=location, depth=height, radius=radius)
    assign_mat(obj, pbr(f"{name}Mat", (0.2, 0.55, 0.85, 1), roughness=0.4))
    rigid(obj, "ACTIVE", "CAPSULE", mass=mass)
    tag(obj, gcp_kind="pawn", gcp_locomotion="walk", gcp_height=height)
    _link(obj, "ACTORS")
    return obj


def grasp_target(name: str, location, size=0.12, color=(0.95, 0.75, 0.15, 1)):
    obj = primitive("uv_sphere", name, "PHYSICS", location=location, scale=_size3(size))
    assign_mat(obj, pbr(f"{name}Mat", color, roughness=0.25, metallic=0.15))
    rigid(obj, "ACTIVE", "SPHERE", mass=0.2)
    tag(obj, gcp_kind="graspable")
    return obj


def crate(name: str, location, size=0.6, mass: float = 8.0):
    obj = primitive("cube", name, "PROPS", location=location, scale=_half3(size))
    assign_mat(obj, pbr("CrateMat", (0.45, 0.28, 0.12, 1), roughness=0.75))
    rigid(obj, "ACTIVE", "BOX", mass=mass)
    tag(obj, gcp_kind="prop")
    return obj


def waypoint_path(name: str, points: Sequence[Sequence[float]], closed: bool = False):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (p[0], p[1], p[2], 1)
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, curve)
    tag(obj, gcp_kind="nav_path")
    return _link(obj, "NAV")


def nav_volume(name: str, location, size):
    obj = primitive("cube", name, "NAV", location=location, scale=_half3(size))
    obj.display_type = "WIRE"
    obj.hide_render = True
    tag(obj, gcp_kind="nav_volume")
    return obj


def spawn_marker(
    name: str,
    location,
    kind: str = "enemy",
    archetype: str = "wolf",
    prompt: str = "",
):
    obj = primitive("ico", name, "SPAWN", location=location, scale=_size3(0.35))
    colors = {
        "enemy": (0.85, 0.15, 0.18, 1),
        "npc": (0.2, 0.55, 0.95, 1),
        "loot": (0.95, 0.8, 0.2, 1),
        "event": (0.7, 0.35, 0.95, 1),
        "player": (0.2, 0.9, 0.55, 1),
    }
    assign_mat(
        obj,
        pbr(f"{name}Mat", colors.get(kind, (0.8, 0.8, 0.8, 1)), emission=colors.get(kind, (1, 1, 1, 1)), emission_strength=2.2),
    )
    tag(obj, gcp_kind="spawn", gcp_spawn=kind, gcp_archetype=archetype, gcp_prompt=prompt)
    return obj


def encounter_volume(name: str, location, size, prompt: str):
    obj = nav_volume(name, location, size)
    _link(obj, "SPAWN")
    tag(obj, gcp_kind="encounter", gcp_prompt=prompt)
    return obj


def player_anchor(location=(0, 0, 1.0)):
    obj = primitive("uv_sphere", "PlayerAnchor", "GAMEPLAY", location=location, scale=(0.28, 0.28, 0.28))
    assign_mat(obj, pbr("PlayerAnchorMat", (0.2, 0.95, 0.7, 1), emission=(0.2, 0.95, 0.7, 1), emission_strength=3))
    tag(obj, gcp_kind="player_anchor")
    return obj


def camera(name: str, location, look_at=(0, 0, 1), lens: float = 35.0, kind: str = "gameplay"):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    obj = bpy.data.objects.new(name, cam)
    obj.location = location
    direction = Vector(look_at) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    tag(obj, gcp_kind="camera", gcp_camera=kind)
    _link(obj, "CAMERAS")
    if kind in ("beauty", "shot", "gameplay") and bpy.context.scene.camera is None:
        bpy.context.scene.camera = obj
    return obj


def follow_camera(target: bpy.types.Object, offset=(0, -6.5, 2.4), name: str = "FollowCam"):
    loc = Vector(target.location) + Vector(offset)
    cam = camera(name, loc, look_at=target.location, lens=32, kind="follow")
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    return cam


def fcurves_of(obj: bpy.types.Object) -> list:
    """Blender 4.4+ moved f-curves into action slots; action.fcurves is gone in 5.x."""
    anim = obj.animation_data
    action = anim.action if anim else None
    if action is None:
        return []
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return list(legacy)
    slot = getattr(anim, "action_slot", None)
    curves = []
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            bag = None
            if slot is not None:
                try:
                    bag = strip.channelbag(slot)
                except Exception:
                    bag = None
            bags = [bag] if bag is not None else list(getattr(strip, "channelbags", []))
            for item in bags:
                curves.extend(getattr(item, "fcurves", []))
    return curves


def set_interpolation(obj: bpy.types.Object, mode: str = "BEZIER") -> None:
    for fcurve in fcurves_of(obj):
        for kp in fcurve.keyframe_points:
            kp.interpolation = mode


def dolly_shot(name: str, start, end, look_at, frames=(1, 72), lens: float = 40.0):
    first, last = _frames2(frames)
    cam = camera(name, start, look_at=look_at, lens=lens, kind="shot")
    cam.location = start
    cam.keyframe_insert("location", frame=first)
    cam.location = end
    cam.keyframe_insert("location", frame=last)
    set_interpolation(cam, "BEZIER")
    bpy.context.scene.frame_end = max(bpy.context.scene.frame_end, last)
    tag(cam, gcp_shot=name)
    return cam


def simple_armature(name: str, location=(0, 0, 0), height: float = 1.8) -> bpy.types.Object:
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    obj.location = location
    _link(obj, "ANIM")
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bones = [
        ("root", (0, 0, 0), (0, 0, 0.1)),
        ("hips", (0, 0, height * 0.52), (0, 0, height * 0.55)),
        ("spine", (0, 0, height * 0.55), (0, 0, height * 0.78)),
        ("head", (0, 0, height * 0.78), (0, 0, height)),
        ("thigh.L", (0.12, 0, height * 0.52), (0.12, 0, height * 0.28)),
        ("shin.L", (0.12, 0, height * 0.28), (0.12, 0, 0.08)),
        ("thigh.R", (-0.12, 0, height * 0.52), (-0.12, 0, height * 0.28)),
        ("shin.R", (-0.12, 0, height * 0.28), (-0.12, 0, 0.08)),
        ("upper_arm.L", (0.18, 0, height * 0.74), (0.38, 0, height * 0.55)),
        ("upper_arm.R", (-0.18, 0, height * 0.74), (-0.38, 0, height * 0.55)),
    ]
    created = {}
    for bname, head, tail in bones:
        bone = arm.edit_bones.new(bname)
        bone.head = head
        bone.tail = tail
        created[bname] = bone
    created["hips"].parent = created["root"]
    created["spine"].parent = created["hips"]
    created["head"].parent = created["spine"]
    created["thigh.L"].parent = created["hips"]
    created["shin.L"].parent = created["thigh.L"]
    created["thigh.R"].parent = created["hips"]
    created["shin.R"].parent = created["thigh.R"]
    created["upper_arm.L"].parent = created["spine"]
    created["upper_arm.R"].parent = created["spine"]
    bpy.ops.object.mode_set(mode="OBJECT")
    tag(obj, gcp_kind="armature")
    return obj


def walk_cycle(arm_obj: bpy.types.Object, distance: float = 6.0, frames: int = 48):
    arm_obj.location = (0, 0, 0)
    arm_obj.keyframe_insert("location", frame=1)
    arm_obj.location = (0, distance, 0)
    arm_obj.keyframe_insert("location", frame=frames)
    bpy.context.scene.frame_end = max(bpy.context.scene.frame_end, frames)
    tag(arm_obj, gcp_action="walk")
    return arm_obj


def key_pose(obj: bpy.types.Object, frame: int, location=None, rotation=None):
    if location is not None:
        obj.location = location
        obj.keyframe_insert("location", frame=frame)
    if rotation is not None:
        obj.rotation_euler = Euler(rotation)
        obj.keyframe_insert("rotation_euler", frame=frame)


def building_block(name: str, location, size, color=(0.22, 0.22, 0.24, 1)):
    obj = primitive("cube", name, "ENV", location=location, scale=_half3(size))
    assign_mat(obj, pbr(f"{name}Mat", color, roughness=0.7))
    rigid(obj, "PASSIVE", "BOX")
    return obj


def scatter(kind: str, prefix: str, count: int, region, seed: int = 1, col: str = "PROPS"):
    rng = random.Random(seed)
    x0, y0, x1, y1, z = region
    objs = []
    for i in range(count):
        loc = (rng.uniform(x0, x1), rng.uniform(y0, y1), z)
        scale = rng.uniform(0.4, 1.2)
        obj = primitive(kind, f"{prefix}_{i:03d}", col, location=loc, scale=(scale, scale, scale * rng.uniform(0.8, 1.6)))
        objs.append(obj)
    return objs


def set_active_camera(name: str) -> None:
    obj = bpy.data.objects.get(name)
    if obj and obj.type == "CAMERA":
        bpy.context.scene.camera = obj


def bake_physics(frames: int = 120) -> None:
    _ensure_rigidworld()
    scene = bpy.context.scene
    scene.frame_end = max(scene.frame_end, frames)
    if scene.rigidbody_world:
        scene.rigidbody_world.point_cache.frame_end = frames
    try:
        bpy.ops.ptcache.bake_all(bake=True)
    except Exception:
        pass


def save_blend() -> str:
    if not BLEND_PATH:
        raise RuntimeError("BLEND_PATH is not configured")
    _refit_fog()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    return BLEND_PATH


def render_still(filename: str = "preview.png", frame: int = 1) -> str:
    path = os.path.join(RENDER_DIR, filename)
    scene = bpy.context.scene
    _refit_fog()
    if scene.camera is None:
        camera("AutoCam", (12, -14, 8), look_at=(0, 0, 1.2), kind="beauty")
    scene.frame_set(frame)
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return path


def _principled_of(mat):
    if not mat or not mat.use_nodes:
        return None, None
    nt = mat.node_tree
    return nt, next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)


def bake_textures(
    objects=None,
    size: int = 512,
    samples: int = 4,
    bake_normal: bool = False,
    margin: int = 4,
) -> list:
    """Bake procedural materials down to image textures.

    glTF cannot carry a node graph, so an unbaked world exports with flat base
    colours and loses all the noise and bump. This renders each object's
    material into an image, rewires Base Color to that image, and packs it so
    export_glb() embeds it.

    Baking runs in Cycles and is per-object, so it is slow. Pass the hero
    objects rather than an entire forest.
    """
    scene = bpy.context.scene
    targets = [o for o in (objects if objects is not None else bpy.data.objects) if o.type == "MESH"]
    targets = [o for o in targets if o.data.materials and o.get("gcp_kind") != "fog"]
    if not targets:
        return []

    previous_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.margin = margin

    passes = [("DIFFUSE", "Base Color", False)]
    if bake_normal:
        passes.append(("NORMAL", "Normal", True))

    baked = []
    for obj in targets:
        if not obj.data.uv_layers:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
            bpy.ops.object.mode_set(mode="OBJECT")

        for bake_type, socket, is_normal in passes:
            # Every material slot gets its own target image, so one bake call
            # fills them all. Baking only slot 0 leaves joined objects like a
            # pine with untextured needles.
            pending = []
            for index, mat in enumerate(obj.data.materials):
                nt, bsdf = _principled_of(mat)
                if bsdf is None:
                    continue
                image = bpy.data.images.new(
                    f"{obj.name}_{index}_{bake_type.lower()}", size, size, alpha=False
                )
                image.colorspace_settings.name = "Non-Color" if is_normal else "sRGB"
                tex_node = nt.nodes.new("ShaderNodeTexImage")
                tex_node.image = image
                nt.nodes.active = tex_node
                for node in nt.nodes:
                    node.select = node is tex_node
                pending.append((nt, bsdf, tex_node, image))

            if not pending:
                continue

            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            try:
                bpy.ops.object.bake(type=bake_type)
            except RuntimeError:
                for nt, _, tex_node, image in pending:
                    nt.nodes.remove(tex_node)
                    bpy.data.images.remove(image)
                continue

            for nt, bsdf, tex_node, image in pending:
                image.pack()
                if is_normal:
                    normal_map = nt.nodes.new("ShaderNodeNormalMap")
                    nt.links.new(tex_node.outputs["Color"], normal_map.inputs["Color"])
                    nt.links.new(normal_map.outputs["Normal"], bsdf.inputs[socket])
                else:
                    for link in list(nt.links):
                        if link.to_node is bsdf and link.to_socket.name == socket:
                            nt.links.remove(link)
                    nt.links.new(tex_node.outputs["Color"], bsdf.inputs[socket])
                baked.append(image.name)

    bpy.ops.object.select_all(action="DESELECT")
    scene.render.engine = previous_engine
    return baked


def bake_vertex_colors(objects=None, scale: float = 6.0, strength: float = 0.35) -> int:
    """Cheap alternative to bake_textures: write procedural variation into a
    colour attribute.

    glTF multiplies COLOR_0 into the base colour, so this writes a shade factor
    around 1.0 rather than an absolute colour. A whole forest keeps its
    break-up for the cost of a loop instead of a Cycles bake per object.
    """
    targets = [o for o in (objects if objects is not None else bpy.data.objects) if o.type == "MESH"]
    touched = 0
    for obj in targets:
        mesh = obj.data
        if not mesh.vertices or obj.get("gcp_kind") == "fog" or not mesh.materials:
            continue
        layer = mesh.color_attributes.get("GCPColor") or mesh.color_attributes.new(
            name="GCPColor", type="FLOAT_COLOR", domain="POINT"
        )
        for i, vert in enumerate(mesh.vertices):
            world_co = obj.matrix_world @ vert.co
            n = bl_noise.fractal(world_co * (scale / 10.0), 1.0, 2.0, 3)
            f = min(1.6, max(0.4, 1.0 + n * strength))
            layer.data[i].color = (f, f, f, 1.0)
        touched += 1
    return touched


def export_glb(filename: str = "world.glb") -> str:
    path = os.path.join(EXPORT_DIR, filename)
    _refit_fog()
    for image in bpy.data.images:
        if image.has_data and not image.packed_file and not image.filepath:
            try:
                image.pack()
            except Exception:
                pass
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_vertex_color="ACTIVE",
    )
    return path


def dump_scene() -> dict:
    objects = []
    for obj in bpy.data.objects:
        objects.append(
            {
                "name": obj.name,
                "type": obj.type,
                "location": [round(c, 3) for c in obj.location],
                "collections": [c.name for c in obj.users_collection],
                "physics": obj.rigid_body.type if obj.rigid_body else None,
                "tags": {k: obj[k] for k in obj.keys() if k.startswith("gcp")},
            }
        )
    data = {
        "mode": MODE,
        "objects": objects,
        "cameras": [o.name for o in bpy.data.objects if o.type == "CAMERA"],
        "frame_end": bpy.context.scene.frame_end,
        "counts": {
            "objects": len(bpy.data.objects),
            "meshes": len(bpy.data.meshes),
            "lights": len([o for o in bpy.data.objects if o.type == "LIGHT"]),
            "cameras": len([o for o in bpy.data.objects if o.type == "CAMERA"]),
            "armatures": len([o for o in bpy.data.objects if o.type == "ARMATURE"]),
        },
    }
    return data


def write_inspect_json(path: str | None = None) -> str:
    path = path or os.path.join(PROJECT_DIR, "scene.json")
    payload = dump_scene()
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    print("GCP_SCENE_JSON:" + json.dumps(payload))
    return path
