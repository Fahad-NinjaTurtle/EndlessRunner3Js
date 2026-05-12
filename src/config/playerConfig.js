export const PLAYER_CONFIG = {
  modelUrl: 'models/Player/Player.glb',
  laneCount: 3,
  defaultLane: 1,
  modelScale: 0.65,
  laneLerpSpeed: 0.14,
  speed: {
    initial: 15,
    max: 50,
    acceleration: 0.1,
    curve: 'linear',
  },
  jump: {
    velocity: 10,
    gravity: -24.0,
    minHeight: 0.05,
    /** Extra gravity multiplier when slamming down from jump (smooth but fast) */
    fastFallGravityMultiplier: 3.4,
    /** Added to vertical velocity when starting fast fall */
    fastFallVelocityBoost: -9,
    /** After boost, velocity is clamped to at most this (negative = downward), so slam always pulls down quickly */
    fastFallMinDownVelocity: -7,
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
