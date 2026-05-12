export const ROAD_CONFIG = {
  chunks: [
    {
      url: 'models/Chunk 1.glb',
      offsetX: 0,
    },
    {
      url: 'models/Chunk 2.glb',
      offsetX: 0.7,
    },
    // {
    //   url: 'models/Chunk 3.glb',
    //   offsetX: 0,
    // },
    {
      url: 'models/Chunk 4.glb',
      offsetX: 2.75,
    },
    {
      url: 'models/Chunk 5.glb',
      offsetX: -4.7,
    }
  ],
  segmentCount: 5,
  segmentLengthOffset: 0.5,
  laneCount: 3,
  laneSpacingRatio: 0.32,
  minLaneSpacing: 1.5,
  maxLaneSpacing: 3.0,
  backwardSegmentCount: 0,
  recycleThresholdOffset: 6.0,
  backgroundColor: 0xe8f2ff,
  fogColor: 0xd2e8ff,
  /** Linear THREE.Fog + mobile WebGL often causes a horizontal “dark strip” on flat roads; keep off for itch/mobile stability */
  sceneFogEnabled: false,
  fogNear: 24,
  fogFar: 90,
  cameraFar: 140,
  cameraFovLandscape: 55,
  /** Wider on portrait — narrow screens need extra horizontal field of view */
  cameraFovPortrait: 68,
  /** Smooth camera X toward player (same axis as lookAt) — avoids old 0.35 skew + keeps runner on-screen in side lanes */
  cameraFollowXLerpLandscape: 0.14,
  /** Snappier follow on mobile so lane changes stay framed */
  cameraFollowXLerpPortrait: 0.26,
  /** Portrait: higher rig like Subway Surfers — runner sits lower in frame, more road ahead */
  cameraPortraitExtraHeight: 1.15,
  /** Portrait: pull camera slightly further back (negative = more behind player) */
  cameraPortraitExtraZ: -1.35,
  /**
   * Portrait: extra look-ahead along -Z (same axis as current look target).
   * Larger = aim farther down the track → character drops toward bottom third of screen.
   */
  cameraPortraitLookAheadExtra: 11,
  /** Height added above player root for look-at (landscape) */
  cameraLookAtYOffset: 0.35,
  /** Portrait: look-at near road surface ahead (not chest height) */
  cameraPortraitLookAtYOffset: 0.04,
  skyTopColor: 0x6fb7ff,
  skyHorizonColor: 0xbfe5ff,
  skyBottomColor: 0xf1f6ff,
  skyline: {
    enabled: true,
    modelUrl: 'models/SkyLine.glb',
    scale: 0.5,
    y: -0.5,
    xOffset: 0,
    zOffset: -32,
    followCamera: true,
    followXFactor: 0.55,
    followZFactor: 0.7,
  },
  fallbackSegmentLength: 10,
  raycastOriginHeight: 50,
  seamSampleInset: 1.5,
  seamSearchStep: 0.5,
}
