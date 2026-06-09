export const PLAYER_CONFIG = {
  modelUrl: 'models/Player/Player.glb',
  laneCount: 3,
  defaultLane: 1,
  modelScale: 0.65,
  laneLerpSpeed: 0.14,
  /** Y rotation (rad) while on tap-to-play / idle preview — faces the camera */
  menuFacingYaw: Math.PI,
  /** Y rotation (rad) during the run — faces down the track */
  gameplayYaw: 0,
  /** Seconds to rotate from menu facing to gameplay when starting */
  menuToGameplayRotateDuration: 0.42,
  /** When not running (tap-to-play / idle preview): extra Y on top of ground (negative = lower stance) */
  idle: {
    standingYOffset: -0.5,
    /** Extra X added to the lane centre while idle (positive = right) */
    standingXOffset: 0.03,
  },
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
    /** W during slide: snap to run this long, then jump — keeps parity with fast jump→slide */
    interruptToJumpChain: 0.055,
    /** Jump crossfade after that snap (snappy takeoff) */
    interruptJumpFade: 0.09,
    /** Ignore slide during early jump ascent — blocks phantom touch/keyboard slide */
    minJumpTimeBeforeSlide: 0.14,
  },
  collision: {
    halfHeight: 0.55,
    castDistance: 60,
    maxGroundStepUp: 2.5,
    maxGroundDrop: 8,
    /** Ignore tiny ground height jitter from scrolling road seams / physics */
    groundDeadband: 0.08,
    groundDeadbandMobile: 0.14,
    groundLerp: 0.22,
    groundLerpMobile: 0.14,
  },
  animations: {
    idle: 'RemadeIdle.002',
    run: 'RemadeRun',
    jump: 'RemadeJump',
    roll: 'RemadeRoll',
    land: 'RemadeFall',
  },
}
