export const RENDER_CONFIG = {
  /** MSAA — dramatically reduces edge shimmer on diagonals (mobile + desktop) */
  antialias: true,
  /** Keep false unless needed — can interact badly with scene fog / some integrated GPUs (itch mobile). */
  logarithmicDepthBuffer: false,
  alpha: false,
  /**
   * Cap for `devicePixelRatio`. Values ~1.25 made phones render at sub-retina resolution → muddy textures & pixels.
   * 2 matches most phones; portrait often benefits from the slightly higher cap below.
   */
  pixelRatioMax: 2,
  /** Portrait / narrow view: allow a bit more sharpness when the GPU can handle it */
  pixelRatioMaxPortrait: 2.5,
  targetFPS: 45,
  pauseWhenHidden: true,
  toneMapping: {
    type: 'ACESFilmicToneMapping',
    exposure: 1.55,
  },
  colorSpace: 'SRGBColorSpace',
  useLegacyLights: false,
}
