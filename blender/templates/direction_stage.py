"""Direction seed — cinematic + gameplay cameras, lights, walk cycle."""
from gcp import (
    area_light,
    building_block,
    camera,
    dolly_shot,
    follow_camera,
    ground,
    light_array,
    save_blend,
    simple_armature,
    sun,
    walk_cycle,
    write_inspect_json,
)

ground(28)
building_block("Facade", (0, 8, 3), (14, 1.2, 6), color=(0.12, 0.13, 0.16, 1))
hero = simple_armature("HeroRig", (0, 0, 0), height=1.8)
walk_cycle(hero, distance=8, frames=64)
sun(8.0)
light_array("RimRail", (0, 6, 3.2), count=6, spacing=1.6, energy=90, color=(0.55, 0.7, 1))
area_light("Key", (-3, -2, 4.5), energy=320, color=(1, 0.92, 0.82))
beauty = camera("Beauty", (7, -9, 3.2), look_at=(0, 2, 1.4), lens=50, kind="beauty")
follow_camera(hero, offset=(1.2, -6.5, 2.1), name="GameplayFollow")
dolly_shot("IntroDolly", (4, -8, 1.6), (1.2, -3.5, 1.5), look_at=(0, 1, 1.4), frames=(1, 72))
save_blend()
write_inspect_json()
