export const RENDER_CONFIG = {
  antialias: false,
  /** MSAA + high DPR exhausts mobile GPU memory and causes context loss (B/W flash) */
  antialiasMobile: false,
  alpha: false,
  pixelRatioMax: 1.25,
  /** Balance sharpness vs GPU memory on phones */
  pixelRatioMaxMobile: 1.5,
  targetFPS: 60,
  targetFPSMobile: 45,
  pauseWhenHidden: true,
  toneMapping: {
    type: 'ACESFilmicToneMapping',
    exposure: 1.55,
  },
  colorSpace: 'SRGBColorSpace',
  useLegacyLights: false,
}
