export const CONTROLS_CONFIG = {
  keys: {
    left: ['ArrowLeft', 'a', 'A'],
    right: ['ArrowRight', 'd', 'D'],
    jump: ['ArrowUp', 'w', 'W', ' '],
    roll: ['ArrowDown', 's', 'S'],
  },
  /** Lane-change swipe — horizontal movement must exceed this */
  swipeThreshold: 36,
  /** Upward swipe to jump */
  swipeJumpThreshold: 42,
  /**
   * Downward swipe to slide — higher than jump because lifting a finger often
   * drifts down 30–50px and was falsely triggering roll.
   */
  swipeRollThreshold: 62,
  /** Taps / tiny movements below this total distance are ignored */
  tapDeadZone: 50,
  /** Vertical swipe must be clearly more vertical than horizontal */
  swipeVerticalBias: 1.2,
  touchEnabled: true,
}
