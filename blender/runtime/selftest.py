"""Headless smoke test for the GameCreator Prime SDK.

Run: blender --background --factory-startup --python blender/runtime/selftest.py
Exercises every public helper an agent is told about in the system prompt and
reports one line per helper so version drift in bpy shows up immediately.
"""

import os
import sys
import tempfile
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from gcp import (  # noqa: E402
    area_light,
    assign_mat,
    bevel,
    clear_zone,
    displace_surface,
    height_noise,
    noise_material,
    pine,
    rock,
    sample_height,
    scatter_on,
    smooth_subdiv,
    smoothstep,
    bake_physics,
    building_block,
    camera,
    fcurves_of,
    character_capsule,
    collision_box,
    configure,
    crate,
    dolly_shot,
    dump_scene,
    encounter_volume,
    export_glb,
    fog,
    fog_volume,
    follow_camera,
    grasp_target,
    ground,
    key_pose,
    light_array,
    nav_volume,
    open_or_reset,
    pbr,
    player_anchor,
    point_light,
    primitive,
    render_still,
    rigid,
    save_blend,
    scatter,
    set_active_camera,
    simple_armature,
    sky,
    spawn_marker,
    sun,
    tag,
    terrain,
    walk_cycle,
    waypoint_path,
    write_inspect_json,
)

FAILURES = []


def step(label, fn):
    try:
        value = fn()
        print(f"  ok   {label}")
        return value
    except Exception as exc:
        FAILURES.append((label, traceback.format_exc()))
        print(f"  FAIL {label}: {type(exc).__name__}: {exc}")
        return None


def check(label, condition, detail=""):
    if condition:
        print(f"  ok   {label}")
        return True
    FAILURES.append((label, detail or "assertion failed"))
    print(f"  FAIL {label}: {detail or 'assertion failed'}")
    return False


def main():
    root = os.path.join(tempfile.gettempdir(), "gcp_selftest")
    configure(
        project_dir=root,
        blend_path=os.path.join(root, "world.blend"),
        render_dir=os.path.join(root, "renders"),
        export_dir=os.path.join(root, "exports"),
        mode="generative",
    )
    print(f"Blender {bpy.app.version_string}")
    print("scene setup")
    step("open_or_reset", lambda: open_or_reset(live=False))

    print("geometry")
    step("ground", lambda: ground(60))
    terr = step("terrain", lambda: terrain("Terrain", size=80, cuts=24, height=4, seed=7))
    step("terrain/tuple size", lambda: terrain("TerrainRect", size=(60, 40), cuts=12, height=3, seed=2))
    step(
        "terrain/callable height field",
        lambda: terrain(
            "TerrainField",
            size=(50, 50),
            cuts=16,
            height=lambda x, y: height_noise(x, y, seed=4) * 5.0 * smoothstep(4.0, 12.0, abs(x)),
        ),
    )
    step("height_noise", lambda: height_noise(3.0, 4.0, seed=7))
    step("smoothstep", lambda: smoothstep(0.0, 1.0, 0.5))
    step("sample_height", lambda: sample_height(bpy.data.objects["Terrain"], 2.0, 2.0))
    step("primitive/cube", lambda: primitive("cube", "Cube_A", "PROPS", (2, 2, 1)))
    step("primitive/cylinder", lambda: primitive("cylinder", "Trunk_A", "PROPS", (3, 3, 1)))
    step("primitive/cone", lambda: primitive("cone", "Canopy_A", "PROPS", (3, 3, 3)))
    step("primitive/ico", lambda: primitive("ico", "Rock_A", "PROPS", (-3, 2, 0.4)))
    step("primitive/capsule", lambda: primitive("capsule", "Cap_A", "ACTORS", (0, 4, 1)))
    step("building_block", lambda: building_block("Wall_A", (0, 10, 1.5), (6, 0.6, 3)))
    step("scatter", lambda: scatter("cone", "Pine", 12, (-20, -20, 20, 20, 0), seed=3))

    print("materials (rgb and rgba inputs)")
    step("pbr/rgba", lambda: pbr("M_RGBA", (0.2, 0.3, 0.1, 1), 0.9, 0.0, (0.0, 0.0, 0.0, 1), 0.0))
    step("pbr/rgb", lambda: pbr("M_RGB", (0.13, 0.19, 0.11), 0.95, 0.0, (0.02, 0.03, 0.02), 0.15))
    step("assign_mat", lambda: assign_mat(bpy.data.objects["Cube_A"], pbr("M_Cube", (0.5, 0.5, 0.5))))
    step("noise_material", lambda: noise_material("M_Noise", (0.3, 0.25, 0.2), accent=(0.5, 0.4, 0.3)))

    print("procedural props")
    step("rock", lambda: rock("Boulder", (-8, -6, 0.6), size=2.4, seed=3))
    step("pine", lambda: pine("Pine_Hero", (-14, 4, 0), height=13.0, seed=5))
    step(
        "scatter_on",
        lambda: scatter_on(
            bpy.data.objects["Terrain"],
            lambda i, x, y, z, r: rock(f"ScatterRock_{i:02d}", (x, y, z), size=r.uniform(0.5, 1.5), seed=i),
            6,
            (-30, -30, 30, 30),
            seed=11,
            reject=lambda x, y: abs(x) < 4,
        ),
    )
    step("bevel", lambda: bevel(bpy.data.objects["Wall_A"], 0.05, 2))
    step("smooth_subdiv", lambda: smooth_subdiv(bpy.data.objects["Rock_A"], 1))
    step("displace_surface", lambda: displace_surface(bpy.data.objects["Canopy_A"], 0.2, 1.0))
    step("clear_zone", lambda: clear_zone((-14, 4), 2.0, ("NOPE",)))

    print("physics")
    step("rigid/active", lambda: rigid(bpy.data.objects["Cube_A"], "ACTIVE", "BOX", 4.0))
    step("collision_box/tuple", lambda: collision_box("Blocker", (4, 8, 1.5), (2, 0.4, 3)))
    step("collision_box/scalar", lambda: collision_box("Blocker2", (7, 8, 1.5), 2.0))
    step("character_capsule", lambda: character_capsule("Pawn", (0, 0, 1.1)))
    step("grasp_target/scalar", lambda: grasp_target("Mug", (1.2, 0.4, 1.0)))
    step("grasp_target/tuple", lambda: grasp_target("Mug2", (1.6, 0.4, 1.0), (0.1, 0.1, 0.2)))
    step("crate/scalar", lambda: crate("Cache", (2.4, 1.0, 0.4), 0.6, 8.0))
    step("crate/tuple", lambda: crate("Cache2", (3.4, 1.0, 0.45), (0.95, 0.95, 0.9), 18))
    step("nav_volume/scalar", lambda: nav_volume("NavScalar", (0, -8, 1), 4.0))
    step("building_block/scalar", lambda: building_block("Pillar", (-6, 10, 1.5), 1.2))
    step("bake_physics", lambda: bake_physics(48))

    print("nav and spawns")
    step("waypoint_path", lambda: waypoint_path("Patrol", [(0, 0, 0), (4, 6, 0), (9, 12, 1)], closed=True))
    step("nav_volume", lambda: nav_volume("NavA", (0, 6, 1), (12, 12, 3)))
    step("spawn_marker", lambda: spawn_marker("Wolf_01", (6, 14, 1), "enemy", "wolf", "ridge ambush"))
    step("encounter_volume", lambda: encounter_volume("Enc_01", (6, 14, 1.5), (8, 8, 4), "wolves close in"))
    step("player_anchor", lambda: player_anchor((0, 0, 1.0)))

    print("lights")
    step("sun", lambda: sun(4.0))
    step("area_light", lambda: area_light("Fill", (6, -6, 6)))
    step("point_light", lambda: point_light("Brazier", (0, 12, 2.4)))
    step("light_array", lambda: light_array("Rim", (0, 8, 3), count=3, spacing=2.0))

    print("atmosphere")
    step("sky", lambda: sky((0.04, 0.07, 0.13), (0.42, 0.45, 0.48), 1.2))
    step("fog", lambda: fog(0.010, (0.62, 0.68, 0.74)))
    step("fog_volume", lambda: fog_volume("GroundHaze", (0, 8, 1.2), (60, 60, 2.4), 0.05))

    print("cameras")
    step("camera", lambda: camera("Beauty", (14, -16, 8), (0, 6, 1.2), 35, "beauty"))
    step("follow_camera", lambda: follow_camera(bpy.data.objects["Pawn"]))
    step("dolly_shot/tuple", lambda: dolly_shot("Reveal", (10, -18, 3), (2, -6, 2.2), (0, 12, 4), (1, 72)))
    step("dolly_shot/int", lambda: dolly_shot("Reveal2", (-10, -16, 2), (-4, 6, 5), (0, 58, 9), 150, 35))
    step("set_active_camera", lambda: set_active_camera("Beauty"))

    print("animation")
    arm = step("simple_armature", lambda: simple_armature("Rig", (0, -4, 0)))
    if arm:
        step("walk_cycle", lambda: walk_cycle(arm, 6.0, 48))
        step("key_pose", lambda: key_pose(arm, 24, location=(0, -1, 0), rotation=(0, 0, 0.4)))
    step("tag", lambda: tag(bpy.data.objects["Cube_A"], gcp_kind="prop"))

    print("behavior")
    cube = bpy.data.objects["Cube_A"]
    rbw = bpy.context.scene.rigidbody_world
    check(
        "rigid body stays in the simulation collection",
        rbw is not None and rbw.collection is not None and cube.name in rbw.collection.objects,
        "collection membership is dropped when the helper relinks the object",
    )
    check(
        "active body is tagged for the inspector",
        cube.get("gcp_physics") == "ACTIVE",
        f"gcp_physics={cube.get('gcp_physics')}",
    )
    reveal = bpy.data.objects.get("Reveal")
    check(
        "dolly shot wrote keyframes",
        reveal is not None and len(fcurves_of(reveal)) > 0,
        "no f-curves found on the shot camera",
    )
    terr_obj = bpy.data.objects.get("Terrain")
    check(
        "terrain is actually displaced",
        terr_obj is not None and len({round(v.co.z, 3) for v in terr_obj.data.vertices}) > 1,
        "every terrain vertex is at the same height",
    )
    rect = bpy.data.objects.get("TerrainRect")
    check(
        "tuple size gives a rectangular terrain",
        rect is not None and abs(rect.dimensions.x - 60) < 2 and abs(rect.dimensions.y - 40) < 2,
        f"dimensions {tuple(round(d, 1) for d in rect.dimensions) if rect else None}",
    )
    field = bpy.data.objects.get("TerrainField")
    center_flat = field is not None and max(abs(v.co.z) for v in field.data.vertices if abs(v.co.x) < 3) < 1.0
    check(
        "callable height field carves where it is told",
        center_flat,
        "the authored corridor was not flattened",
    )
    tree = bpy.data.objects.get("Pine_Hero")
    check(
        "pine joins into a single object",
        tree is not None and len(tree.data.polygons) > 100,
        f"polygons {len(tree.data.polygons) if tree else None}",
    )
    boulder = bpy.data.objects.get("Boulder")
    check(
        "rock is displaced, not a smooth sphere",
        boulder is not None and len({round(v.co.length, 2) for v in boulder.data.vertices}) > 4,
        "every vertex is the same distance from centre",
    )
    check(
        "scatter_on respects the reject region",
        all(abs(o.location.x) >= 4 for o in bpy.data.objects if o.name.startswith("ScatterRock_")),
        "a prop landed inside the rejected strip",
    )
    check(
        "spawn markers carry director prompts",
        bpy.data.objects["Wolf_01"].get("gcp_prompt") == "ridge ambush",
        "prompt tag missing",
    )
    world_nt = bpy.context.scene.world.node_tree
    check(
        "fog is a box volume, not a world volume (EEVEE renders those black)",
        bpy.data.objects.get("GCP_Fog") is not None
        and not any(n.type == "VOLUME_SCATTER" for n in world_nt.nodes),
        "world volume scatter is back, or the fog box is missing",
    )
    fog_box = bpy.data.objects.get("GCP_Fog")
    check(
        "fog refits around geometry added after the fog() call",
        fog_box is not None and max(fog_box.dimensions) > 80,
        f"fog box dimensions {tuple(round(d, 1) for d in fog_box.dimensions) if fog_box else None}",
    )
    check(
        "sky reaches the world output",
        any(n.type == "BACKGROUND" for n in world_nt.nodes),
        "no background shader on the world",
    )

    print("output")
    step("save_blend", lambda: save_blend())
    rendered = step("render_still", lambda: render_still("preview.png"))
    if rendered:
        import numpy as np

        img = bpy.data.images.load(rendered)
        rgb = np.array(img.pixels[:]).reshape(-1, 4)[:, :3]
        check(
            "preview is not a black or blown-out frame",
            0.02 < rgb.mean() < 0.98,
            f"mean luminance {rgb.mean():.4f} — atmosphere is swallowing the render",
        )
    step("export_glb", lambda: export_glb("world.glb"))
    scene = step("dump_scene", lambda: dump_scene())
    step("write_inspect_json", lambda: write_inspect_json())

    if scene:
        print(f"objects={scene['counts']['objects']} cameras={scene['counts']['cameras']} lights={scene['counts']['lights']}")
    preview = os.path.join(root, "renders", "preview.png")
    print(f"preview_written={os.path.exists(preview)}")

    print("")
    if FAILURES:
        print(f"GCP_SELFTEST: {len(FAILURES)} FAILED")
        for label, tb in FAILURES:
            print(f"--- {label} ---")
            print(tb)
        sys.exit(1)
    print("GCP_SELFTEST: ALL PASS")


main()
