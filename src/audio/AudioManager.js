export class AudioManager {
  constructor(config) {
    this.config = config
    this.enabled = Boolean(config?.enabled)
    this.cache = new Map()
    this.userUnlocked = false
  }

  _createAudio(definition) {
    if (!this.enabled || !definition?.url) return null
    const audio = new Audio(definition.url)
    audio.preload = 'auto'
    audio.loop = Boolean(definition.loop)
    audio.volume = Math.max(0, Math.min(1, definition.volume ?? 1))
    audio.crossOrigin = 'anonymous'
    return audio
  }

  _get(key, definition) {
    if (!this.enabled) return null
    if (this.cache.has(key)) return this.cache.get(key)
    const audio = this._createAudio(definition)
    if (!audio) return null
    this.cache.set(key, audio)
    return audio
  }

  unlockFromUserGesture() {
    this.userUnlocked = true
  }

  playBgm() {
    const bg = this._get('bg', this.config?.bgMusic)
    if (!bg || !this.userUnlocked) return
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
    if (!steps || !this.userUnlocked) return
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
    if (!this.enabled || !this.userUnlocked || !src?.url) return
    const oneShot = new Audio(src.url)
    oneShot.volume = Math.max(0, Math.min(1, src.volume ?? 1))
    oneShot.play().catch(() => {})
  }

  playHit() {
    const src = this.config?.hit
    if (!this.enabled || !this.userUnlocked || !src?.url) return
    const oneShot = new Audio(src.url)
    oneShot.volume = Math.max(0, Math.min(1, src.volume ?? 1))
    oneShot.play().catch(() => {})
  }
}
