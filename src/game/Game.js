import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { addSkyDome } from '../components/environment/addSkyDome.js'
import { addRunnerLights } from '../components/lights/addRunnerLights.js'
import { RENDER_CONFIG } from '../config/rendererConfig.js'
import { ROAD_CONFIG } from '../config/roadConfig.js'
import { PLAYER_CONFIG } from '../config/playerConfig.js'
import { CONTROLS_CONFIG } from '../config/controlsConfig.js'
import { AUDIO_CONFIG } from '../config/audioConfig.js'
import { PlayerController } from '../player/PlayerController.js'
import { RoadManager } from '../road/RoadManager.js'
import { PlayerControls } from '../input/PlayerControls.js'
import { ObstacleSystem } from '../world/ObstacleSystem.js'
import { AudioManager } from '../audio/AudioManager.js'

const COLOR_SPACE_MAP = {
  SRGBColorSpace: THREE.SRGBColorSpace,
}

const TONE_MAPPING_MAP = {
  ACESFilmicToneMapping: THREE.ACESFilmicToneMapping,
}

export class Game {
  constructor(app) {
    this.app = app
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(ROAD_CONFIG.backgroundColor ?? ROAD_CONFIG.fogColor ?? 0xbfd9ff)
    this.scene.fog = new THREE.Fog(
      ROAD_CONFIG.fogColor ?? 0xbfd9ff,
      ROAD_CONFIG.fogNear ?? 14,
      ROAD_CONFIG.fogFar ?? 52,
    )
    this.loadingManager = new THREE.LoadingManager()
    this.gltfLoader = new GLTFLoader(this.loadingManager)
    this.renderer = new THREE.WebGLRenderer({
      antialias: RENDER_CONFIG.antialias,
      alpha: RENDER_CONFIG.alpha,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.pixelRatioMax))
    this.renderer.outputColorSpace = COLOR_SPACE_MAP[RENDER_CONFIG.colorSpace] ?? THREE.SRGBColorSpace
    this.renderer.toneMapping = TONE_MAPPING_MAP[RENDER_CONFIG.toneMapping.type] ?? THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = RENDER_CONFIG.toneMapping.exposure
    this.renderer.useLegacyLights = RENDER_CONFIG.useLegacyLights
    this.app.appendChild(this.renderer.domElement)

    this.cameraFovLandscape = ROAD_CONFIG.cameraFovLandscape ?? 55
    this.cameraFovPortrait = ROAD_CONFIG.cameraFovPortrait ?? 68
    this.cameraPortrait = false
    this.camera = new THREE.PerspectiveCamera(
      this.cameraFovLandscape,
      1,
      0.1,
      ROAD_CONFIG.cameraFar ?? 90,
    )
    this.scene.add(this.camera)

    this.clock = new THREE.Clock()
    this.targetFrameTime = 1 / Math.max(10, RENDER_CONFIG.targetFPS ?? 45)
    this.timeAccumulator = 0
    this.lastFrameTime = performance.now()
    this.isPageVisible = document.visibilityState !== 'hidden'
    this.onVisibilityChange = this.onVisibilityChange.bind(this)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.skyDome = addSkyDome(this.scene, {
      topColor: ROAD_CONFIG.skyTopColor,
      horizonColor: ROAD_CONFIG.skyHorizonColor,
      bottomColor: ROAD_CONFIG.skyBottomColor,
    })
    this.skyline = null
    this.skylineBaseY = 0
    addRunnerLights(this.scene)

    this.player = new PlayerController(this.scene, PLAYER_CONFIG, this.loadingManager)
    this.road = new RoadManager(this.scene, ROAD_CONFIG, this.loadingManager)
    this.obstacles = new ObstacleSystem(this.scene, this.loadingManager)
    this.controls = new PlayerControls(CONTROLS_CONFIG, {
      left: () => this._playerAction(() => this.player.moveLeft()),
      right: () => this._playerAction(() => this.player.moveRight()),
      jump: () => this._playerAction(() => this.player.jump()),
      roll: () => this._playerAction(() => this.player.roll()),
    })
    this.isRunning = false
    this.isPaused = false
    this.resumeCountdownElapsed = null
    this.lastResumeCountdownShown = null
    this.runDistance = 0
    this.isLoopStarted = false
    this.coinCount = 0
    this.onCoinChange = null
    this.onGameOver = null
    this.onCoinPickup = null
    this.onHit = null
    this.onDistanceChange = null
    this.onResumeCountdown = null
    this.onPauseStateChange = null
    this.onMuteChange = null
    this.deathParticleSystem = null
    this.deathParticleLife = null
    this.deathParticleMaxLife = 1.1
    this.coinSparkles = []
    this.pendingGameOver = null
    this.gameOverDelay = 520
    this.cameraBaseY = 3.6
    this.cameraBaseZ = -4
    this.cameraShakeTime = 0
    this.cameraShakeDuration = 0
    this.cameraShakeMagnitude = 0
    this.audio = new AudioManager(AUDIO_CONFIG)

    window.addEventListener('resize', () => this.resize())
  }

  _playerAction(fn) {
    if (!this.isRunning || this.isPaused || this.resumeCountdownElapsed !== null) return
    fn()
  }

  getSimulationActive() {
    return this.isRunning && !this.isPaused && this.resumeCountdownElapsed === null
  }

  getPauseButtonState() {
    if (!this.isRunning) {
      return { enabled: false, label: 'Pause' }
    }
    if (this.resumeCountdownElapsed !== null) {
      return { enabled: false, label: '…' }
    }
    if (this.isPaused) {
      return { enabled: true, label: 'Resume' }
    }
    return { enabled: true, label: 'Pause' }
  }

  isMuted() {
    return this.audio.isMuted()
  }

  toggleMute() {
    const next = !this.audio.isMuted()
    this.audio.setMuted(next)
    if (
      !next &&
      this.isRunning &&
      !this.isPaused &&
      this.resumeCountdownElapsed === null
    ) {
      this.audio.resumeLoopingTracksIfRunning(true)
    }
    if (typeof this.onMuteChange === 'function') this.onMuteChange(next)
  }

  togglePause() {
    if (!this.isRunning) return
    if (this.resumeCountdownElapsed !== null) return

    if (!this.isPaused) {
      this.isPaused = true
      this.audio.pauseLoopingTracks()
      if (typeof this.onPauseStateChange === 'function') {
        this.onPauseStateChange({ paused: true, countdown: false })
      }
      return
    }

    this.resumeCountdownElapsed = 0
    this.lastResumeCountdownShown = 3
    if (typeof this.onResumeCountdown === 'function') this.onResumeCountdown(3)
    if (typeof this.onPauseStateChange === 'function') {
      this.onPauseStateChange({ paused: true, countdown: true })
    }
  }

  async load(onProgress) {
    if (typeof onProgress === 'function') {
      this.loadingManager.onStart = (_, loaded, total) => {
        const progress = total > 0 ? loaded / total : 0
        onProgress({ loaded, total, progress })
      }

      this.loadingManager.onProgress = (_, loaded, total) => {
        const progress = total > 0 ? loaded / total : 0
        onProgress({ loaded, total, progress })
      }
    }

    await Promise.all([this.road.load(), this.player.load(), this.loadSkyline(), this.obstacles.load()])
    this.player.setLanePositions(this.road.getLanePositions())
    this.player.setRoadMeshes(this.road.getRoadMeshes())
    this.player.setStartPositionZ(-this.road.getSegmentLength() * 0.35)
    this.obstacles.setLanePositions(this.road.getLanePositions())
    this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
    this.resetCamera()
    this.resize()
    this.player.snapToGround()

    if (typeof onProgress === 'function') {
      onProgress({ loaded: 1, total: 1, progress: 1 })
    }

    if (!this.isLoopStarted) {
      this.isLoopStarted = true
      this.lastFrameTime = performance.now()
      requestAnimationFrame((time) => this.animate(time))
    }
  }

  onVisibilityChange() {
    this.isPageVisible = document.visibilityState !== 'hidden'
    this.clock.getDelta()
    this.timeAccumulator = 0
    this.lastFrameTime = performance.now()
  }

  async loadSkyline() {
    const skylineConfig = ROAD_CONFIG.skyline
    if (!skylineConfig?.enabled || !skylineConfig.modelUrl) return

    const gltf = await new Promise((resolve, reject) => {
      this.gltfLoader.load(skylineConfig.modelUrl, resolve, undefined, reject)
    })

    this.skyline = gltf.scene
    this.skyline.name = 'SkylineRing'
    this.skyline.scale.setScalar(skylineConfig.scale ?? 1)
    this.skyline.position.set(
      skylineConfig.xOffset ?? 0,
      skylineConfig.y ?? 0,
      skylineConfig.zOffset ?? 0,
    )
    this.skylineBaseY = this.skyline.position.y
    this.skyline.traverse((obj) => {
      if (!obj?.isMesh) return
      obj.frustumCulled = true
      obj.renderOrder = -1
    })
    this.scene.add(this.skyline)
  }

  startGame() {
    if (this.isRunning) return
    if (typeof this.player.isRotatingToGameplay === 'function' && this.player.isRotatingToGameplay()) return

    if (
      typeof this.player.needsMenuToGameplayTurn === 'function' &&
      this.player.needsMenuToGameplayTurn()
    ) {
      this.player.rotateToGameplayThen(() => this.applyGameStart())
      return
    }

    this.applyGameStart()
  }

  applyGameStart() {
    if (this.isRunning) return
    this.clearDeathParticles()
    this.clearCoinSparkles()
    this.pendingGameOver = null
    this.cameraShakeTime = 0
    this.cameraShakeDuration = 0
    this.cameraShakeMagnitude = 0
    this.coinCount = 0
    this.runDistance = 0
    this.isPaused = false
    this.resumeCountdownElapsed = null
    this.lastResumeCountdownShown = null
    this.isRunning = true
    if (typeof this.onCoinChange === 'function') this.onCoinChange(this.coinCount)
    if (typeof this.onDistanceChange === 'function') this.onDistanceChange(this.runDistance)
    if (typeof this.onResumeCountdown === 'function') this.onResumeCountdown(null)
    if (typeof this.onPauseStateChange === 'function') {
      this.onPauseStateChange({ paused: false, countdown: false })
    }
    this.audio.unlockFromUserGesture()
    this.audio.playBgm()
    this.audio.playFootsteps()
    this.player.setVisible(true)
    this.player.startRunning()
    this.obstacles.reset()
    this.obstacles.setLanePositions(this.road.getLanePositions())
    this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
    this.obstacles.start()
    this.controls.enable(this.renderer.domElement)
    this.clock.getDelta()
  }

  setUIHandlers({
    onCoinChange,
    onGameOver,
    onCoinPickup,
    onHit,
    onDistanceChange,
    onResumeCountdown,
    onPauseStateChange,
    onMuteChange,
  } = {}) {
    this.onCoinChange = typeof onCoinChange === 'function' ? onCoinChange : null
    this.onGameOver = typeof onGameOver === 'function' ? onGameOver : null
    this.onCoinPickup = typeof onCoinPickup === 'function' ? onCoinPickup : null
    this.onHit = typeof onHit === 'function' ? onHit : null
    this.onDistanceChange = typeof onDistanceChange === 'function' ? onDistanceChange : null
    this.onResumeCountdown = typeof onResumeCountdown === 'function' ? onResumeCountdown : null
    this.onPauseStateChange = typeof onPauseStateChange === 'function' ? onPauseStateChange : null
    this.onMuteChange = typeof onMuteChange === 'function' ? onMuteChange : null
  }

  stopGame() {
    if (!this.isRunning) return
    this.isRunning = false
    this.isPaused = false
    this.resumeCountdownElapsed = null
    if (typeof this.onResumeCountdown === 'function') this.onResumeCountdown(null)
    if (typeof this.onPauseStateChange === 'function') {
      this.onPauseStateChange({ paused: false, countdown: false })
    }
    this.player.stopRunning()
    this.obstacles.stop()
    this.audio.stopFootsteps()
    this.controls.dispose()
  }

  createCoinSparkle(origin) {
    const count = 18
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const idx = i * 3
      positions[idx] = origin.x
      positions[idx + 1] = origin.y + 0.2
      positions[idx + 2] = origin.z
      const theta = Math.random() * Math.PI * 2
      const speed = 0.5 + Math.random() * 1.5
      velocities[idx] = Math.cos(theta) * speed
      velocities[idx + 1] = 0.9 + Math.random() * 1.6
      velocities[idx + 2] = Math.sin(theta) * speed
      colors[idx] = 1
      colors[idx + 1] = 0.88
      colors[idx + 2] = 0.26
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.userData.velocities = velocities
    const material = new THREE.PointsMaterial({
      size: 0.08,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.coinSparkles.push({ points, life: 0.35, maxLife: 0.35 })
  }

  updateCoinSparkles(deltaTime) {
    if (!this.coinSparkles.length) return
    this.coinSparkles = this.coinSparkles.filter((sparkle) => {
      sparkle.life -= deltaTime
      const geometry = sparkle.points.geometry
      const positionAttr = geometry.getAttribute('position')
      const velocities = geometry.userData.velocities
      if (positionAttr && velocities) {
        for (let i = 0; i < positionAttr.count; i += 1) {
          const idx = i * 3
          velocities[idx + 1] -= 5.6 * deltaTime
          positionAttr.array[idx] += velocities[idx] * deltaTime
          positionAttr.array[idx + 1] += velocities[idx + 1] * deltaTime
          positionAttr.array[idx + 2] += velocities[idx + 2] * deltaTime
        }
        positionAttr.needsUpdate = true
      }
      sparkle.points.material.opacity = THREE.MathUtils.clamp(sparkle.life / sparkle.maxLife, 0, 1)
      if (sparkle.life > 0) return true
      this.scene.remove(sparkle.points)
      sparkle.points.geometry.dispose()
      sparkle.points.material.dispose()
      return false
    })
  }

  clearCoinSparkles() {
    for (const sparkle of this.coinSparkles) {
      this.scene.remove(sparkle.points)
      sparkle.points.geometry.dispose()
      sparkle.points.material.dispose()
    }
    this.coinSparkles.length = 0
  }

  createDeathBurst(origin) {
    this.clearDeathParticles()
    const count = 64
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3
      positions[idx] = origin.x
      positions[idx + 1] = origin.y + 0.35
      positions[idx + 2] = origin.z

      const theta = Math.random() * Math.PI * 2
      const spread = 0.9 + Math.random() * 1.7
      velocities[idx] = Math.cos(theta) * spread
      velocities[idx + 1] = 1.6 + Math.random() * 3.1
      velocities[idx + 2] = Math.sin(theta) * spread

      colors[idx] = 1
      colors[idx + 1] = 0.42 + Math.random() * 0.18
      colors[idx + 2] = 0.15
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.userData.velocities = velocities

    const material = new THREE.PointsMaterial({
      size: 0.2,
      transparent: true,
      opacity: 1,
      vertexColors: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })

    this.deathParticleSystem = new THREE.Points(geometry, material)
    this.deathParticleLife = new Float32Array(count).fill(this.deathParticleMaxLife)
    this.scene.add(this.deathParticleSystem)
  }

  updateDeathParticles(deltaTime) {
    if (!this.deathParticleSystem || !this.deathParticleLife) return
    const geometry = this.deathParticleSystem.geometry
    const positionAttr = geometry.getAttribute('position')
    const velocities = geometry.userData.velocities
    if (!positionAttr || !velocities) return

    let aliveCount = 0
    for (let i = 0; i < this.deathParticleLife.length; i += 1) {
      const life = Math.max(0, this.deathParticleLife[i] - deltaTime)
      this.deathParticleLife[i] = life
      if (life <= 0) continue
      aliveCount += 1
      const idx = i * 3
      velocities[idx + 1] -= 4.2 * deltaTime
      positionAttr.array[idx] += velocities[idx] * deltaTime
      positionAttr.array[idx + 1] += velocities[idx + 1] * deltaTime
      positionAttr.array[idx + 2] += velocities[idx + 2] * deltaTime
    }

    positionAttr.needsUpdate = true
    this.deathParticleSystem.material.opacity = THREE.MathUtils.clamp(
      aliveCount / this.deathParticleLife.length,
      0,
      1,
    )

    if (aliveCount === 0) {
      this.clearDeathParticles()
    }
  }

  clearDeathParticles() {
    if (!this.deathParticleSystem) return
    this.scene.remove(this.deathParticleSystem)
    this.deathParticleSystem.geometry.dispose()
    this.deathParticleSystem.material.dispose()
    this.deathParticleSystem = null
    this.deathParticleLife = null
  }

  triggerCameraShake(duration = 0.34, magnitude = 0.14) {
    this.cameraShakeTime = duration
    this.cameraShakeDuration = duration
    this.cameraShakeMagnitude = magnitude
  }

  getCameraShakeOffset(deltaTime) {
    if (this.cameraShakeTime <= 0 || this.cameraShakeDuration <= 0) {
      return { x: 0, y: 0, z: 0 }
    }
    this.cameraShakeTime = Math.max(0, this.cameraShakeTime - deltaTime)
    const progress = this.cameraShakeTime / this.cameraShakeDuration
    const strength = this.cameraShakeMagnitude * progress
    return {
      x: (Math.random() * 2 - 1) * strength,
      y: (Math.random() * 2 - 1) * strength * 0.55,
      z: (Math.random() * 2 - 1) * strength * 0.35,
    }
  }

  resetCamera() {
    this.camera.position.set(0, this.cameraBaseY, this.cameraBaseZ)
  }

  resize() {
    const width = this.app.clientWidth || window.innerWidth
    const height = this.app.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    // Wider vertical FOV on portrait/narrow screens so all lanes stay visible (no lateral camera pan)
    this.cameraPortrait = height > width
    this.camera.fov = this.cameraPortrait ? this.cameraFovPortrait : this.cameraFovLandscape
    this.camera.updateProjectionMatrix()
  }

  animate(time) {
    const now = typeof time === 'number' ? time : performance.now()
    const elapsed = Math.min((now - this.lastFrameTime) / 1000, 0.1)
    this.lastFrameTime = now

    if (RENDER_CONFIG.pauseWhenHidden && !this.isPageVisible) {
      requestAnimationFrame((nextTime) => this.animate(nextTime))
      return
    }

    this.timeAccumulator += elapsed
    if (this.timeAccumulator < this.targetFrameTime) {
      requestAnimationFrame((nextTime) => this.animate(nextTime))
      return
    }

    const dt = Math.min(this.timeAccumulator, 0.05)
    this.timeAccumulator = 0

    if (this.resumeCountdownElapsed !== null) {
      this.resumeCountdownElapsed += dt
      const idx = Math.floor(this.resumeCountdownElapsed)
      if (idx >= 3) {
        this.resumeCountdownElapsed = null
        this.lastResumeCountdownShown = null
        this.isPaused = false
        if (typeof this.onResumeCountdown === 'function') this.onResumeCountdown(null)
        if (typeof this.onPauseStateChange === 'function') {
          this.onPauseStateChange({ paused: false, countdown: false })
        }
        this.audio.resumeLoopingTracksIfRunning(this.isRunning)
      } else {
        const displayNum = Math.max(1, 3 - idx)
        if (displayNum !== this.lastResumeCountdownShown) {
          this.lastResumeCountdownShown = displayNum
          if (typeof this.onResumeCountdown === 'function') this.onResumeCountdown(displayNum)
        }
      }
    }

    const simulationActive = this.getSimulationActive()

    let speed = 0
    let collisionState = { hit: false, collected: 0, pickupPositions: [] }

    if (simulationActive) {
      speed = this.player.getCurrentSpeed()
      this.road.update(dt, speed, this.camera.position.z)
      this.player.update(dt)
      this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
      collisionState = this.obstacles.update(dt, speed, this.player.getCollisionData())
      this.runDistance += speed * dt
      if (typeof this.onDistanceChange === 'function') this.onDistanceChange(this.runDistance)
    } else if (!this.isRunning) {
      this.road.update(dt, 0, this.camera.position.z)
      this.player.update(dt)
      this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
      collisionState = this.obstacles.update(dt, 0, this.player.getCollisionData())
    } else {
      this.road.update(dt, 0, this.camera.position.z)
    }

    if (collisionState.collected > 0 && simulationActive) {
      this.coinCount += collisionState.collected
      if (typeof this.onCoinChange === 'function') this.onCoinChange(this.coinCount)
      for (const pickupPos of collisionState.pickupPositions ?? []) {
        this.createCoinSparkle(pickupPos)
      }
      this.audio.playCoin()
      if (typeof this.onCoinPickup === 'function') this.onCoinPickup({ count: collisionState.collected })
    }
    if (collisionState.hit && this.isRunning) {
      this.pendingGameOver = {
        coins: this.coinCount,
        distance: this.runDistance,
        speed: this.player.getCurrentSpeed(),
        delay: this.gameOverDelay,
      }
      this.createDeathBurst(this.player.getPosition())
      this.player.setVisible(false)
      this.triggerCameraShake()
      this.audio.playHit()
      if (typeof this.onHit === 'function') this.onHit()
      this.stopGame()
    }

    const playerPosition = this.player.getPosition()
    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position)
    }

    const updateCamera = simulationActive || !this.isRunning
    if (this.skyline && ROAD_CONFIG.skyline?.followCamera && updateCamera) {
      const followXFactor = ROAD_CONFIG.skyline.followXFactor ?? 0.35
      const followZFactor = ROAD_CONFIG.skyline.followZFactor ?? 0.18
      this.skyline.position.set(
        this.camera.position.x * followXFactor + (ROAD_CONFIG.skyline.xOffset ?? 0),
        this.skylineBaseY,
        this.camera.position.z * followZFactor + (ROAD_CONFIG.skyline.zOffset ?? 0),
      )
    }

    const shakeOffset = updateCamera ? this.getCameraShakeOffset(dt) : { x: 0, y: 0, z: 0 }
    if (updateCamera) {
      const followX = this.cameraPortrait
        ? (ROAD_CONFIG.cameraFollowXLerpPortrait ?? 0.26)
        : (ROAD_CONFIG.cameraFollowXLerpLandscape ?? 0.14)
      this.camera.position.x =
        THREE.MathUtils.lerp(this.camera.position.x, playerPosition.x, followX) + shakeOffset.x
      const portraitLift = this.cameraPortrait ? (ROAD_CONFIG.cameraPortraitExtraHeight ?? 0) : 0
      const portraitZ = this.cameraPortrait ? (ROAD_CONFIG.cameraPortraitExtraZ ?? 0) : 0
      this.camera.position.y = this.cameraBaseY + portraitLift + shakeOffset.y
      this.camera.position.z = this.cameraBaseZ + portraitZ + shakeOffset.z
      const baseLookAhead = Math.min(2.0, this.road.getSegmentLength() * 0.15)
      const portraitLookAhead = this.cameraPortrait ? (ROAD_CONFIG.cameraPortraitLookAheadExtra ?? 0) : 0
      const lookZ = playerPosition.z - baseLookAhead - portraitLookAhead
      const lookYOffset = this.cameraPortrait
        ? (ROAD_CONFIG.cameraPortraitLookAtYOffset ?? ROAD_CONFIG.cameraLookAtYOffset ?? 0.35)
        : (ROAD_CONFIG.cameraLookAtYOffset ?? 0.35)
      this.camera.lookAt(playerPosition.x, playerPosition.y + lookYOffset, lookZ)
    }

    if (simulationActive || !this.isRunning) {
      this.updateDeathParticles(dt)
      this.updateCoinSparkles(dt)
    }

    if (this.pendingGameOver && (!this.isRunning || !this.isPaused)) {
      this.pendingGameOver.delay -= dt * 1000
      if (this.pendingGameOver.delay <= 0) {
        const payload = {
          coins: this.pendingGameOver.coins,
          distance: this.pendingGameOver.distance,
          speed: this.pendingGameOver.speed,
        }
        this.pendingGameOver = null
        if (typeof this.onGameOver === 'function') this.onGameOver(payload)
      }
    }

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame((nextTime) => this.animate(nextTime))
  }
}
