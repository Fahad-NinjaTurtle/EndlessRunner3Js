export const RENDER_CONFIG = {
  antialias: false,
  /** MSAA on touch devices — helps edges without the cost of full desktop AA */
  antialiasMobile: true,
  alpha: false,
  pixelRatioMax: 1.25,
  /** Phones are often 2–3× DPR; capping at 1 made the canvas look very blocky */
  pixelRatioMaxMobile: 2,
  targetFPS: 60,
  pauseWhenHidden: true,
  toneMapping: {
    type: 'ACESFilmicToneMapping',
    exposure: 1.55,
  },
  colorSpace: 'SRGBColorSpace',
  useLegacyLights: false,
}
