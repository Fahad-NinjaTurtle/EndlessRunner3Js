export class PlayerControls {
  constructor(config, callbacks) {
    this.config = config
    this.callbacks = callbacks
    this.surface = null
    this.touchStartX = 0
    this.touchStartY = 0
    this.touchStartTime = 0
    this.activeTouchId = null
    this.pointerId = null
    this.pointerStartX = 0
    this.pointerStartY = 0
    this.pointerStartTime = 0
    this.ignoreSwipeSession = false
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onTouchStart = this.onTouchStart.bind(this)
    this.onTouchEnd = this.onTouchEnd.bind(this)
    this.onTouchCancel = this.onTouchCancel.bind(this)
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

  _tapDeadZone() {
    return this.config.tapDeadZone ?? 50
  }

  _applySwipeFromDelta(dx, dy, { allowRoll = true } = {}) {
    const totalDist = Math.hypot(dx, dy)
    if (totalDist < this._tapDeadZone()) return

    const hThreshold = this.config.swipeThreshold ?? 36
    const jumpThreshold = this.config.swipeJumpThreshold ?? 42
    const rollThreshold = this.config.swipeRollThreshold ?? 62
    const verticalBias = this.config.swipeVerticalBias ?? 1.2

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > hThreshold) {
      if (dx > 0) this.callbacks.right()
      else this.callbacks.left()
      return
    }

    if (Math.abs(dy) < Math.abs(dx) * verticalBias) return

    if (dy < -jumpThreshold) {
      this.callbacks.jump()
      return
    }

    if (allowRoll && dy > rollThreshold) {
      this.callbacks.roll()
    }
  }

  _beginSwipeSession(x, y, id = null) {
    this.ignoreSwipeSession = false
    this.touchStartX = x
    this.touchStartY = y
    this.touchStartTime = performance.now()
    this.activeTouchId = id
  }

  _resetSwipeSession() {
    this.ignoreSwipeSession = false
    this.activeTouchId = null
    this.pointerId = null
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
      surface.addEventListener('touchcancel', this.onTouchCancel, this.touchOpts)
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
    surface.addEventListener('touchcancel', this.onTouchCancel, this.touchOpts)
    surface.addEventListener('touchmove', this.onTouchMove, this.touchOpts)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    const surface = this.surface
    if (!surface) return

    surface.removeEventListener('touchstart', this.onTouchStart, this.touchOpts)
    surface.removeEventListener('touchend', this.onTouchEnd, this.touchOpts)
    surface.removeEventListener('touchcancel', this.onTouchCancel, this.touchOpts)
    surface.removeEventListener('touchmove', this.onTouchMove, this.touchOpts)

    if (this.hasPointerEvents) {
      surface.removeEventListener('pointerdown', this.onPointerDown, this.pointerOpts)
      surface.removeEventListener('pointerup', this.onPointerUp, this.pointerOpts)
      surface.removeEventListener('pointercancel', this.onPointerCancel, this.pointerOpts)
    }

    this.surface = null
    this._resetSwipeSession()
  }

  onKeyDown(event) {
    if (event.repeat) return
    if (event.target?.closest?.('input, textarea, select, button')) return
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
    this.pointerId = event.pointerId
    this.pointerStartX = event.clientX
    this.pointerStartY = event.clientY
    this.pointerStartTime = performance.now()
    this._beginSwipeSession(event.clientX, event.clientY, event.pointerId)
  }

  onPointerUp(event) {
    if (event.pointerType === 'mouse' && !event.isPrimary) return
    if (this.ignoreSwipeSession) {
      this._resetSwipeSession()
      return
    }
    if (this.pointerId != null && event.pointerId !== this.pointerId) return

    const dx = event.clientX - this.pointerStartX
    const dy = event.clientY - this.pointerStartY
    this._applySwipeFromDelta(dx, dy)
    this._resetSwipeSession()
  }

  onPointerCancel() {
    this._resetSwipeSession()
  }

  onTouchStart(event) {
    if (this._isUiTarget(event.target)) {
      this.ignoreSwipeSession = true
      return
    }

    const touch = event.changedTouches[0] ?? event.touches[0]
    if (!touch) return

    this._beginSwipeSession(touch.clientX, touch.clientY, touch.identifier)
  }

  onTouchEnd(event) {
    if (this.ignoreSwipeSession) {
      this._resetSwipeSession()
      return
    }

    const touch =
      this.activeTouchId == null
        ? event.changedTouches[0]
        : [...event.changedTouches].find((t) => t.identifier === this.activeTouchId)

    if (!touch) {
      this._resetSwipeSession()
      return
    }

    const dx = touch.clientX - this.touchStartX
    const dy = touch.clientY - this.touchStartY
    this._applySwipeFromDelta(dx, dy)
    this._resetSwipeSession()
  }

  onTouchCancel() {
    // System-cancelled touches (notifications, gestures) must not trigger slide.
    this._resetSwipeSession()
  }
}
