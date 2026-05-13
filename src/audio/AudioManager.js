export class AudioManager {
  constructor(config) {
    this.config = config
    this.enabled = Boolean(config?.enabled)
    this.cache = new Map()
    this.userUnlocked = false
    this.muted = false
  }

  setMuted(muted) {
    this.muted = Boolean(muted)
    this._applyMutedVolumes()
  }

  isMuted() {
    return this.muted
  }

  _effectiveVolume(definition) {
    const base = Math.max(0, Math.min(1, definition?.volume ?? 1))
    return this.muted ? 0 : base
  }

  _applyMutedVolumes() {
    const bg = this.cache.get('bg')
    if (bg && this.config?.bgMusic) {
      bg.volume = this._effectiveVolume(this.config.bgMusic)
    }
    const steps = this.cache.get('steps')
    if (steps && this.config?.footsteps) {
      steps.volume = this._effectiveVolume(this.config.footsteps)
    }
  }

  _createAudio(definition, key) {
    if (!this.enabled || !definition?.url) return null
    const audio = new Audio(definition.url)
    audio.preload = 'auto'
    audio.loop = Boolean(definition.loop)
    audio.volume =
      key === 'bg' || key === 'steps'
        ? this._effectiveVolume(definition)
        : Math.max(0, Math.min(1, definition.volume ?? 1))
    audio.crossOrigin = 'anonymous'
    return audio
  }

  _get(key, definition) {
    if (!this.enabled) return null
    if (this.cache.has(key)) return this.cache.get(key)
    const audio = this._createAudio(definition, key)
    if (!audio) return null
    this.cache.set(key, audio)
    return audio
  }

  unlockFromUserGesture() {
    this.userUnlocked = true
  }

  pauseLoopingTracks() {
    const bg = this.cache.get('bg')
    if (bg && !bg.paused) bg.pause()
    const steps = this.cache.get('steps')
    if (steps && !steps.paused) steps.pause()
  }

  resumeLoopingTracksIfRunning(running) {
    if (!running || !this.userUnlocked || this.muted) return
    const bg = this._get('bg', this.config?.bgMusic)
    if (bg && bg.paused) bg.play().catch(() => {})
    const steps = this._get('steps', this.config?.footsteps)
    if (steps && steps.paused) steps.play().catch(() => {})
  }

  playBgm() {
    const bg = this._get('bg', this.config?.bgMusic)
    if (!bg || !this.userUnlocked || this.muted) return
    if (!bg.paused) return
    bg.currentTime = 0
    bg.play().catch(() => {})
  }

  stopBgm() {
    const bg = this.cache.get('bg')
    if (!bg) return
    bg.pause()
  }

  playFootsteps() {
    const steps = this._get('steps', this.config?.footsteps)
    if (!steps || !this.userUnlocked || this.muted) return
    if (!steps.paused) return
    steps.currentTime = 0
    steps.play().catch(() => {})
  }

  stopFootsteps() {
    const steps = this.cache.get('steps')
    if (!steps) return
    steps.pause()
  }

  playCoin() {
    const src = this.config?.coinPickup
    if (!this.enabled || !this.userUnlocked || !src?.url || this.muted) return
    const oneShot = new Audio(src.url)
    oneShot.volume = Math.max(0, Math.min(1, src.volume ?? 1))
    oneShot.play().catch(() => {})
  }

  playHit() {
    const src = this.config?.hit
    if (!this.enabled || !this.userUnlocked || !src?.url || this.muted) return
    const oneShot = new Audio(src.url)
    oneShot.volume = Math.max(0, Math.min(1, src.volume ?? 1))
    oneShot.play().catch(() => {})
  }
}
