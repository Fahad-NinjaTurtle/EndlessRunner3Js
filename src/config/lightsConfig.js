export const LIGHTS_CONFIG = {
  ambient: {
    color: 0xffffff,
    /** Base fill — avoids crushed blacks on vertical meshes + road strip */
    intensity: 0.42,
  },
  hemisphere: {
    skyColor: 0xbfd9ff,
    /** Was nearly black — steep vertical faces (player, props) picked up too much “ground” and went dark */
    groundColor: 0x3d4a5c,
    intensity: 1.05,
  },
  keyLight: {
    color: 0xffffff,
    intensity: 2.0,
    position: [7, 10, 6],
    target: [0, 0, 0],
  },
  rimLight: {
    color: 0x7fc8ff,
    intensity: 0.95,
    position: [-9, 4, 2],
    target: [0, 0, 0],
  },
  /** Soft light from camera side — lifts faces toward the viewer (center lane / runner read clearer) */
  forwardFill: {
    color: 0xf2f6ff,
    intensity: 0.65,
  },
}

