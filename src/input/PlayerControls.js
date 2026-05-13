export class PlayerControls {
  constructor(config, callbacks) {
    this.config = config
    this.callbacks = callbacks
    this.surface = null
    this.touchStartX = 0
    this.touchStartY = 0
    this.pointerStartX = 0
    this.pointerStartY = 0
    this.ignoreSwipeSession = false
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onTouchStart = this.onTouchStart.bind(this)
    this.onTouchEnd = this.onTouchEnd.bind(this)
    this.onTouchMove = this.onTouchMove.bind(this)
    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    this.onPointerCancel = this.onPointerCancel.bind(this)
    this.hasPointerEvents = typeof window.PointerEvent !== 'undefined'
    this.preferCanvasTouch = this._preferCanvasTouch()
    this.touchOpts = { passive: false }
    this.pointerOpts = { passive: true }
  }

  /** Phone / tablet: real touch events on the canvas behave better than Pointer Events on iOS Safari. */
  _preferCanvasTouch() {
    if (!this.config.touchEnabled) return false
    if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      return true
    }
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    if (/iPhone|iPad|iPod/i.test(ua)) return true
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true
    return false
  }

  _isUiTarget(target) {
    if (!target?.closest) return false
    return Boolean(
      target.closest(
        '#hud button, .hud__actions, .overlay button, .tap-to-play-layer, #tap-to-play-layer, #paused-banner',
      ),
    )
  }

  _applySwipeFromDelta(dx, dy) {
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

  /**
   * @param {HTMLElement} surface — use the WebGL canvas (`renderer.domElement`), not `window`.
   */
  enable(surface) {
    this.dispose()
    if (!(surface instanceof HTMLElement)) return
    this.surface = surface

    window.addEventListener('keydown', this.onKeyDown)

    if (this.preferCanvasTouch) {
      surface.addEventListener('touchstart', this.onTouchStart, this.touchOpts)
      surface.addEventListener('touchend', this.onTouchEnd, this.touchOpts)
      surface.addEventListener('touchcancel', this.onTouchEnd, this.touchOpts)
      surface.addEventListener('touchmove', this.onTouchMove, this.touchOpts)
      return
    }

    if (this.hasPointerEvents) {
      surface.addEventListener('pointerdown', this.onPointerDown, this.pointerOpts)
      surface.addEventListener('pointerup', this.onPointerUp, this.pointerOpts)
      surface.addEventListener('pointercancel', this.onPointerCancel, this.pointerOpts)
      return
    }

    surface.addEventListener('touchstart', this.onTouchStart, this.touchOpts)
    surface.addEventListener('touchend', this.onTouchEnd, this.touchOpts)
    surface.addEventListener('touchcancel', this.onTouchEnd, this.touchOpts)
    surface.addEventListener('touchmove', this.onTouchMove, this.touchOpts)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    const surface = this.surface
    if (!surface) return

    surface.removeEventListener('touchstart', this.onTouchStart, this.touchOpts)
    surface.removeEventListener('touchend', this.onTouchEnd, this.touchOpts)
    surface.removeEventListener('touchcancel', this.onTouchEnd, this.touchOpts)
    surface.removeEventListener('touchmove', this.onTouchMove, this.touchOpts)

    if (this.hasPointerEvents) {
      surface.removeEventListener('pointerdown', this.onPointerDown, this.pointerOpts)
      surface.removeEventListener('pointerup', this.onPointerUp, this.pointerOpts)
      surface.removeEventListener('pointercancel', this.onPointerCancel, this.pointerOpts)
    }

    this.surface = null
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

  onTouchMove(event) {
    if (event.cancelable) event.preventDefault()
  }

  onPointerDown(event) {
    if (event.pointerType === 'mouse' && !event.isPrimary) return
    if (this._isUiTarget(event.target)) {
      this.ignoreSwipeSession = true
      return
    }
    this.ignoreSwipeSession = false
    this.pointerStartX = event.clientX
    this.pointerStartY = event.clientY
  }

  onPointerUp(event) {
    if (event.pointerType === 'mouse' && !event.isPrimary) return
    if (this.ignoreSwipeSession) {
      this.ignoreSwipeSession = false
      return
    }
    const dx = event.clientX - this.pointerStartX
    const dy = event.clientY - this.pointerStartY
    this._applySwipeFromDelta(dx, dy)
  }

  onPointerCancel(event) {
    this.ignoreSwipeSession = false
  }

  onTouchStart(event) {
    const touch = event.touches[0]
    if (!touch) return
    if (this._isUiTarget(event.target)) {
      this.ignoreSwipeSession = true
      return
    }
    this.ignoreSwipeSession = false
    this.touchStartX = touch.clientX
    this.touchStartY = touch.clientY
  }

  onTouchEnd(event) {
    if (this.ignoreSwipeSession) {
      this.ignoreSwipeSession = false
      return
    }
    const touch = event.changedTouches[0]
    if (!touch) return

    const dx = touch.clientX - this.touchStartX
    const dy = touch.clientY - this.touchStartY
    this._applySwipeFromDelta(dx, dy)
  }
}
