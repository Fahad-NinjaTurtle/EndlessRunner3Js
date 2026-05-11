export class PlayerControls {
  constructor(config, callbacks) {
    this.config = config
    this.callbacks = callbacks
    this.touchStartX = 0
    this.touchStartY = 0
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onTouchStart = this.onTouchStart.bind(this)
    this.onTouchEnd = this.onTouchEnd.bind(this)
  }

  enable() {
    window.addEventListener('keydown', this.onKeyDown)
    if (this.config.touchEnabled) {
      window.addEventListener('touchstart', this.onTouchStart, { passive: true })
      window.addEventListener('touchend', this.onTouchEnd, { passive: true })
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('touchstart', this.onTouchStart)
    window.removeEventListener('touchend', this.onTouchEnd)
  }

  onKeyDown(event) {
    if (event.repeat) return
    const key = event.key
    if (this.config.keys.left.includes(key)) {
      this.callbacks.left()
      return
    }
    if (this.config.keys.right.includes(key)) {
      this.callbacks.right()
      return
    }
    if (this.config.keys.jump.includes(key)) {
      this.callbacks.jump()
      return
    }
    if (this.config.keys.roll.includes(key)) {
      this.callbacks.roll()
    }
  }

  onTouchStart(event) {
    const touch = event.touches[0]
    if (!touch) return
    this.touchStartX = touch.clientX
    this.touchStartY = touch.clientY
  }

  onTouchEnd(event) {
    const touch = event.changedTouches[0]
    if (!touch) return

    const dx = touch.clientX - this.touchStartX
    const dy = touch.clientY - this.touchStartY
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > this.config.swipeThreshold) {
      if (dx > 0) this.callbacks.right()
      else this.callbacks.left()
      return
    }
    if (Math.abs(dy) > this.config.swipeVerticalThreshold) {
      if (dy < 0) this.callbacks.jump()
      else this.callbacks.roll()
    }
  }
}
