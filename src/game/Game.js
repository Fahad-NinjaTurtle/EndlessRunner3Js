import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { addSkyDome } from '../components/environment/addSkyDome.js'
import { addRunnerLights, updateRunnerLights } from '../components/lights/addRunnerLights.js'
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
    if (ROAD_CONFIG.sceneFogEnabled === true) {
      this.scene.fog = new THREE.Fog(
        ROAD_CONFIG.fogColor ?? 0xbfd9ff,
        ROAD_CONFIG.fogNear ?? 14,
        ROAD_CONFIG.fogFar ?? 52,
      )
    }
    this.loadingManager = new THREE.LoadingManager()
    this.gltfLoader = new GLTFLoader(this.loadingManager)
    this.renderer = new THREE.WebGLRenderer({
      antialias: RENDER_CONFIG.antialias,
      alpha: RENDER_CONFIG.alpha,
      powerPreference: 'high-performance',
      stencil: false,
      logarithmicDepthBuffer: RENDER_CONFIG.logarithmicDepthBuffer ?? false,
    })
    this._updateRendererPixelRatio()
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
      0.2,
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
    this.runnerLights = addRunnerLights(this.scene)

    this.player = new PlayerController(this.scene, PLAYER_CONFIG, this.loadingManager)
    this.road = new RoadManager(this.scene, ROAD_CONFIG, this.loadingManager)
    this.obstacles = new ObstacleSystem(this.scene, this.loadingManager)
    this.controls = new PlayerControls(CONTROLS_CONFIG, {
      left: () => this.player.moveLeft(),
      right: () => this.player.moveRight(),
      jump: () => this.player.jump(),
      roll: () => this.player.roll(),
    })
    this.isRunning = false
    this.isLoopStarted = false
    this.coinCount = 0
    this.onCoinChange = null
    this.onGameOver = null
    this.onCoinPickup = null
    this.onHit = null
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
    this._iblFallbackApplied = false

    window.addEventListener('resize', () => this.resize())
  }

  /**
   * PBR materials need scene.environment for specular. itch.io mobile iframes often report 0×0 canvas on first
   * layout — PMREM then fails or yields unusable env maps → black road/player band while obstacles look fine.
   */
  _setupSceneEnvironment() {
    const w = this.renderer.domElement.width
    const h = this.renderer.domElement.height
    if (w < 64 || h < 64) return false

    try {
      if (this.scene.environment) {
        this.scene.environment.dispose()
        this.scene.environment = null
      }

      const pmrem = new THREE.PMREMGenerator(this.renderer)
      pmrem.compileEquirectangularShader()
      const rt = pmrem.fromScene(new RoomEnvironment())
      const tex = rt.texture
      pmrem.dispose()
      if (!tex) throw new Error('PMREM texture missing')

      this.scene.environment = tex
      this._iblFallbackApplied = false
      return true
    } catch (err) {
      console.warn('[Game] IBL / PMREM failed (common on mobile if canvas was not sized yet):', err)
      if (!this._iblFallbackApplied) {
        this._iblFallbackApplied = true
        this._applyPBRDiffuseFallback()
      }
      return false
    }
  }

  /** Last resort when PMREM/env cannot be created — strips metallic reliance so diffuse reads correctly without env */
  _applyPBRDiffuseFallback() {
    const fixMat = (m) => {
      if (!m || (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial)) return
      m.metalness = 0
      if ('envMapIntensity' in m) m.envMapIntensity = 0
      if (m.roughness !== undefined) m.roughness = Math.min(1, Math.max(m.roughness, 0.82))
      m.needsUpdate = true
    }
    const walk = (root) => {
      root?.traverse?.((obj) => {
        if (!obj.isMesh) return
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach(fixMat)
      })
    }
    walk(this.player?.group)
    const meshes = this.road?.getRoadMeshes?.() ?? []
    for (const mesh of meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(fixMat)
    }
  }

  /**
   * Road + player GLBs often ship high metalness / env reliance; mobile GPUs + itch iframe can still yield bad IBL reads.
   * Obstacle assets are usually simpler — hence “only hero + road look black”. Clamp so diffuse always carries the look.
   */
  _safeguardRoadAndPlayerMaterials() {
    const hasEnv = !!this.scene.environment
    const fixMat = (m) => {
      if (!m || (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial)) return
      if (!hasEnv) {
        m.metalness = 0
        if ('envMapIntensity' in m) m.envMapIntensity = 0
      } else {
        m.metalness = THREE.MathUtils.clamp(m.metalness ?? 0, 0, 0.22)
        if ('envMapIntensity' in m) {
          m.envMapIntensity = THREE.MathUtils.clamp(m.envMapIntensity ?? 1, 0.45, 1.15)
        }
      }
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.42)
      m.needsUpdate = true
    }
    const walk = (root) => {
      root?.traverse?.((obj) => {
        if (!obj.isMesh) return
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach(fixMat)
      })
    }
    walk(this.player?.group)
    for (const mesh of this.road?.getRoadMeshes?.() ?? []) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(fixMat)
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
    if (!this._setupSceneEnvironment()) {
      /* itch/mobile: defer until iframe reports real size — see resize() */
    }
    this.player.snapToGround()
    this._safeguardRoadAndPlayerMaterials()

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
    this.clearDeathParticles()
    this.clearCoinSparkles()
    this.pendingGameOver = null
    this.cameraShakeTime = 0
    this.cameraShakeDuration = 0
    this.cameraShakeMagnitude = 0
    this.coinCount = 0
    if (typeof this.onCoinChange === 'function') this.onCoinChange(this.coinCount)
    this.isRunning = true
    this.audio.unlockFromUserGesture()
    this.audio.playBgm()
    this.audio.playFootsteps()
    this.player.setVisible(true)
    this.player.startRunning()
    this.obstacles.reset()
    this.obstacles.setLanePositions(this.road.getLanePositions())
    this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
    this.obstacles.start()
    this.controls.enable()
    this.clock.getDelta()
  }

  setUIHandlers({ onCoinChange, onGameOver, onCoinPickup, onHit } = {}) {
    this.onCoinChange = typeof onCoinChange === 'function' ? onCoinChange : null
    this.onGameOver = typeof onGameOver === 'function' ? onGameOver : null
    this.onCoinPickup = typeof onCoinPickup === 'function' ? onCoinPickup : null
    this.onHit = typeof onHit === 'function' ? onHit : null
  }

  stopGame() {
    if (!this.isRunning) return
    this.isRunning = false
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

  _updateRendererPixelRatio() {
    const height = this.app?.clientHeight || window.innerHeight
    const width = this.app?.clientWidth || window.innerWidth
    const portrait = height > width
    const cap = portrait
      ? (RENDER_CONFIG.pixelRatioMaxPortrait ?? RENDER_CONFIG.pixelRatioMax ?? 2)
      : (RENDER_CONFIG.pixelRatioMax ?? 2)
    const pr = Math.min(window.devicePixelRatio || 1, cap)
    this.renderer.setPixelRatio(pr)
  }

  resize() {
    const width = this.app.clientWidth || window.innerWidth
    const height = this.app.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this._updateRendererPixelRatio()
    this.camera.aspect = width / height
    // Wider vertical FOV on portrait/narrow screens so all lanes stay visible (no lateral camera pan)
    this.cameraPortrait = height > width
    this.camera.fov = this.cameraPortrait ? this.cameraFovPortrait : this.cameraFovLandscape
    this.camera.updateProjectionMatrix()

    // Mobile itch embeds: first layout pass may be 0×0 → retry PMREM once canvas is real dimensions
    if (!this.scene.environment && width >= 64 && height >= 64) {
      this._setupSceneEnvironment()
      if (this.scene.environment) this._safeguardRoadAndPlayerMaterials()
    }
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

    const speed = this.isRunning ? this.player.getCurrentSpeed() : 0
    this.road.update(dt, speed, this.camera.position.z)
    this.player.update(dt)
    this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
    const collisionState = this.obstacles.update(dt, speed, this.player.getCollisionData())
    if (collisionState.collected > 0) {
      this.coinCount += collisionState.collected
      if (typeof this.onCoinChange === 'function') this.onCoinChange(this.coinCount)
      for (const pickupPos of collisionState.pickupPositions ?? []) {
        this.createCoinSparkle(pickupPos)
      }
      this.audio.playCoin()
      if (typeof this.onCoinPickup === 'function') this.onCoinPickup({ count: collisionState.collected })
    }
    if (collisionState.hit && this.isRunning) {
      this.pendingGameOver = { coins: this.coinCount, speed: this.player.getCurrentSpeed(), delay: this.gameOverDelay }
      this.createDeathBurst(this.player.getPosition())
      this.player.setVisible(false)
      this.triggerCameraShake()
      this.audio.playHit()
      if (typeof this.onHit === 'function') this.onHit()
      this.stopGame()
    }

    const playerPosition = this.player.getPosition()
    updateRunnerLights(this.runnerLights, playerPosition)
    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position)
    }
    if (this.skyline && ROAD_CONFIG.skyline?.followCamera) {
      const followXFactor = ROAD_CONFIG.skyline.followXFactor ?? 0.35
      const followZFactor = ROAD_CONFIG.skyline.followZFactor ?? 0.18
      this.skyline.position.set(
        this.camera.position.x * followXFactor + (ROAD_CONFIG.skyline.xOffset ?? 0),
        this.skylineBaseY,
        this.camera.position.z * followZFactor + (ROAD_CONFIG.skyline.zOffset ?? 0),
      )
    }
    const shakeOffset = this.getCameraShakeOffset(dt)
    // Follow player on X (smooth) and look at the same X — stays behind the runner without the old 0.35× skew “tilt”
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
    this.updateDeathParticles(dt)
    this.updateCoinSparkles(dt)
    if (this.pendingGameOver) {
      this.pendingGameOver.delay -= dt * 1000
      if (this.pendingGameOver.delay <= 0) {
        const payload = { coins: this.pendingGameOver.coins, speed: this.pendingGameOver.speed }
        this.pendingGameOver = null
        if (typeof this.onGameOver === 'function') this.onGameOver(payload)
      }
    }

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame((nextTime) => this.animate(nextTime))
  }
}
