"""Embodiment gym — physical locomotion + graspables."""
from gcp import (
    area_light,
    camera,
    character_capsule,
    collision_box,
    crate,
    grasp_target,
    ground,
    nav_volume,
    save_blend,
    sun,
    waypoint_path,
    write_inspect_json,
)

ground(36)
character_capsule("Trainee", location=(0, -8, 1.0))
for i, x in enumerate((-4, -1.5, 1.5, 4)):
    crate(f"Crate_{i}", (x, 0, 0.4), size=0.7 + i * 0.08)
grasp_target("GoldHandle", (0, 3.2, 0.2))
collision_box("ShelfCollider", (6, 2, 1.2), (0.4, 4, 2.4))
waypoint_path("Patrol", [(-6, -8, 0.05), (-6, 6, 0.05), (6, 6, 0.05), (6, -8, 0.05)], closed=True)
nav_volume("Walkable", (0, 0, 1), (30, 30, 3))
sun(7.5)
area_light("Fill", (0, -6, 5), energy=180)
camera("EvalCam", (14, -16, 9), look_at=(0, 0, 1), kind="beauty")
save_blend()
write_inspect_json()
