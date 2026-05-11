export const PLAYER_CONFIG = {
  modelUrl: '/models/Player/Player.glb',
  laneCount: 3,
  defaultLane: 1,
  modelScale: 0.8,
  laneLerpSpeed: 0.14,
  speed: {
    initial: 10,
    max: 18.0,
    acceleration: 0.08,
    curve: 'linear',
  },
  jump: {
    velocity: 8.8,
    gravity: -24.0,
    minHeight: 0.05,
  },
  roll: {
    duration: 0.8,
    heightScale: 0.45,
    blendAhead: 0.12,
  },
  collision: {
    halfHeight: 0.55,
    castDistance: 60,
    maxGroundStepUp: 2.5,
    maxGroundDrop: 8,
  },
  animations: {
    idle: 'RemadeIdle.002',
    run: 'RemadeRun',
    jump: 'RemadeJump',
    roll: 'RemadeRoll',
    land: 'RemadeFall',
  },
}
