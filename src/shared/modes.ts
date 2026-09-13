export type StudioMode = 'embodiment' | 'generative' | 'cinematic'

export type WorldStatus = 'draft' | 'building' | 'ready' | 'error'

export interface ModeMeta {
  id: StudioMode
  title: string
  kicker: string
  description: string
  prompt: string
  examples: string[]
}

export const STUDIO_MODES: ModeMeta[] = [
  {
    id: 'embodiment',
    title: 'Embodiment',
    kicker: 'Robotics & locomotion',
    description:
      'Train an AI body in physical space — walking, collisions, grasping, and navigation with real rigid-body physics.',
    prompt: 'Build a robotics gym...',
    examples: [
      'Humanoid capsule in a cluttered warehouse. Rigid-body crates, shelves, a yellow grasp target, waypoint path around obstacles, and a locomotion test loop.',
      'Quadruped training yard: ramps, stairs, uneven terrain, and a ball the agent must push with physical collisions.',
      'Tabletop manipulation cell: robot arm reach envelope, graspable mugs, gravity, and a drop-bin.'
    ]
  },
  {
    id: 'generative',
    title: 'Generative Play',
    kicker: 'Worlds that rewrite themselves',
    description:
      'Generate a playable world while the player is standing in it. Shift terrain, spawn encounters, and mutate the level from text or voice.',
    prompt: 'Grow a world around the player...',
    examples: [
      'I am standing in a misty pine forest. Carve a dirt path, raise a ruined watchtower ahead, and spawn three wolf encounters along the ridge.',
      'Live dungeon: when I say “open the east wing”, extrude a torch-lit corridor, spawn two sentries, and drop a loot chest.',
      'Arena morph: flatten the courtyard into a lava ring, raise pillars, and spawn a boss gate when I call it.'
    ]
  },
  {
    id: 'cinematic',
    title: 'Direction',
    kicker: 'Cinematics & game cameras',
    description:
      'A virtual director for games and film — camera rigs, light arrays, and skeletal animation, whether you are shooting a cutscene or tuning gameplay.',
    prompt: 'Direct a sequence...',
    examples: [
      'Third-person RPG follow camera, rim-lit hero under a god-ray, walk-cycle on a cobbled street, then a dolly-in for the dialogue beat.',
      'Sci-fi airlock cutscene: two-shot, rack of practical lights, character waving the hatch, then a gameplay camera handoff.',
      'Boss intro previz: orbit camera, volumetric backlight, roar pose, and a game lock-on camera for the fight.'
    ]
  }
]

export function modeMeta(id: StudioMode): ModeMeta {
  return STUDIO_MODES.find((m) => m.id === id) ?? STUDIO_MODES[0]
}
