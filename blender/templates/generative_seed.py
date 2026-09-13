"""Generative play seed — player standing in a living world."""
from gcp import (
    camera,
    encounter_volume,
    player_anchor,
    point_light,
    save_blend,
    spawn_marker,
    sun,
    terrain,
    write_inspect_json,
)

terrain("LivingGround", size=56, cuts=28, height=4.2, seed=11)
player_anchor((0, 0, 1.1))
spawn_marker("Spawn_Wolf_A", (8, 12, 1.2), kind="enemy", archetype="wolf", prompt="ridge wolves")
spawn_marker("Spawn_Loot_A", (-4, 7, 1.0), kind="loot", archetype="chest")
encounter_volume("EastWing", (16, 0, 1.5), (12, 18, 4), prompt="open the east wing")
sun(5.5, rotation=(0.85, 0.15, 1.1))
point_light("Campfire", (2, -2, 1.1), energy=140, color=(1, 0.45, 0.15))
camera("PlayerEye", (0, -4.5, 1.7), look_at=(0, 6, 1.4), lens=28, kind="gameplay")
save_blend()
write_inspect_json()
