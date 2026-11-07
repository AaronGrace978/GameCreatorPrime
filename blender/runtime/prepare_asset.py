"""Import an original GLB into an editable Blender studio without changing its mesh."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def prepare(source, destination):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise ValueError("The GLB has no mesh objects")
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    center = (low + high) / 2
    span = max(high - low)
    if not math.isfinite(span) or span <= 0:
        raise ValueError("The asset has invalid bounds")
    studio = bpy.data.collections.new("GCP Studio")
    bpy.context.scene.collection.children.link(studio)

    def add_object(name, data, position):
        obj = bpy.data.objects.new(name, data)
        studio.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
        return obj

    camera_data = bpy.data.cameras.new("Asset Camera")
    camera_data.lens = 50
    camera_data.clip_start = max(span / 1000, 0.0001)
    camera_data.clip_end = span * 100
    camera = add_object("Asset Camera", camera_data, center + Vector((1.5, -1.8, 1.1)) * span)
    bpy.context.scene.camera = camera
    for name, offset, power, color in [
        ("Key", (2, -2, 3), 500, (1.0, 0.91, 0.8)),
        ("Fill", (-2, -1, 1), 220, (0.74, 0.84, 1.0)),
        ("Rim", (0, 2, 2), 650, (1.0, 1.0, 1.0)),
    ]:
        light = bpy.data.lights.new(name, "AREA")
        light.energy = power * span * span
        light.shape = "DISK"
        light.size = span * 2
        light.color = color
        add_object(name, light, center + Vector(offset) * span)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("Studio World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.12, 0.14, 0.18, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.4
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1536
    scene.render.resolution_y = 1536
    scene.view_settings.view_transform = "AgX"
    scene["gcp_source_glb"] = str(source)
    scene["gcp_note"] = "Original geometry and materials retained. Inspect topology and scale before use."
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(destination))
    print("GCP_ASSET_READY")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    if len(args) != 2:
        raise ValueError("Expected source.glb and destination.blend")
    prepare(Path(args[0]).resolve(strict=True), Path(args[1]).resolve())
