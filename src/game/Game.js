import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { addSkyDome } from '../components/environment/addSkyDome.js'
import { addRunnerLights } from '../components/lights/addRunnerLights.js'
import { RENDER_CONFIG } from '../config/rendererConfig.js'
import { ROAD_CONFIG } from '../config/roadConfig.js'
import { PLAYER_CONFIG } from '../config/playerConfig.js'
import { CONTROLS_CONFIG } from '../config/controlsConfig.js'
import { PlayerController } from '../player/PlayerController.js'
import { RoadManager } from '../road/RoadManager.js'
import { PlayerControls } from '../input/PlayerControls.js'
import { ObstacleSystem } from '../world/ObstacleSystem.js'

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

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, ROAD_CONFIG.cameraFar ?? 90)
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
    this.deathParticleSystem = null
    this.deathParticleLife = null
    this.deathParticleMaxLife = 1.1
    this.pendingGameOver = null
    this.gameOverDelay = 520
    this.cameraBaseY = 3.6
    this.cameraBaseZ = -4
    this.cameraShakeTime = 0
    this.cameraShakeDuration = 0
    this.cameraShakeMagnitude = 0

    window.addEventListener('resize', () => this.resize())
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
    this.clearDeathParticles()
    this.pendingGameOver = null
    this.cameraShakeTime = 0
    this.cameraShakeDuration = 0
    this.cameraShakeMagnitude = 0
    this.coinCount = 0
    if (typeof this.onCoinChange === 'function') this.onCoinChange(this.coinCount)
    this.isRunning = true
    this.player.setVisible(true)
    this.player.startRunning()
    this.obstacles.reset()
    this.obstacles.setLanePositions(this.road.getLanePositions())
    this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
    this.obstacles.start()
    this.controls.enable()
    this.clock.getDelta()
  }

  setUIHandlers({ onCoinChange, onGameOver } = {}) {
    this.onCoinChange = typeof onCoinChange === 'function' ? onCoinChange : null
    this.onGameOver = typeof onGameOver === 'function' ? onGameOver : null
  }

  stopGame() {
    if (!this.isRunning) return
    this.isRunning = false
    this.player.stopRunning()
    this.obstacles.stop()
    this.controls.dispose()
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

    const speed = this.isRunning ? this.player.getCurrentSpeed() : 0
    this.road.update(dt, speed, this.camera.position.z)
    this.player.update(dt)
    this.obstacles.setRoadMeshes(this.road.getRoadMeshes())
    const collisionState = this.obstacles.update(dt, speed, this.player.getCollisionData())
    if (collisionState.collected > 0) {
      this.coinCount += collisionState.collected
      if (typeof this.onCoinChange === 'function') this.onCoinChange(this.coinCount)
    }
    if (collisionState.hit && this.isRunning) {
      this.pendingGameOver = { coins: this.coinCount, speed: this.player.getCurrentSpeed(), delay: this.gameOverDelay }
      this.createDeathBurst(this.player.getPosition())
      this.player.setVisible(false)
      this.triggerCameraShake()
      this.stopGame()
    }

    const playerPosition = this.player.getPosition()
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
    this.camera.position.x =
      THREE.MathUtils.lerp(this.camera.position.x, playerPosition.x * 0.35, 0.08) + shakeOffset.x
    this.camera.position.y = this.cameraBaseY + shakeOffset.y
    this.camera.position.z = this.cameraBaseZ + shakeOffset.z
    const lookZ = playerPosition.z - Math.min(2.0, this.road.getSegmentLength() * 0.15)
    this.camera.lookAt(playerPosition.x, playerPosition.y + 0.35, lookZ)
    this.updateDeathParticles(dt)
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
