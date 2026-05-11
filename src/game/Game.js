import * as THREE from 'three'
import { addSkyDome } from '../components/environment/addSkyDome.js'
import { addRunnerLights } from '../components/lights/addRunnerLights.js'
import { RENDER_CONFIG } from '../config/rendererConfig.js'
import { ROAD_CONFIG } from '../config/roadConfig.js'
import { PLAYER_CONFIG } from '../config/playerConfig.js'
import { CONTROLS_CONFIG } from '../config/controlsConfig.js'
import { PlayerController } from '../player/PlayerController.js'
import { RoadManager } from '../road/RoadManager.js'
import { PlayerControls } from '../input/PlayerControls.js'

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
    addRunnerLights(this.scene)

    this.player = new PlayerController(this.scene, PLAYER_CONFIG, this.loadingManager)
    this.road = new RoadManager(this.scene, ROAD_CONFIG, this.loadingManager)
    this.controls = new PlayerControls(CONTROLS_CONFIG, {
      left: () => this.player.moveLeft(),
      right: () => this.player.moveRight(),
      jump: () => this.player.jump(),
      roll: () => this.player.roll(),
    })
    this.isRunning = false
    this.isLoopStarted = false

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

    await Promise.all([this.road.load(), this.player.load()])
    this.player.setLanePositions(this.road.getLanePositions())
    this.player.setRoadMeshes(this.road.getRoadMeshes())
    this.player.setStartPositionZ(-this.road.getSegmentLength() * 0.35)
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

  startGame() {
    if (this.isRunning) return
    this.isRunning = true
    this.player.startRunning()
    this.controls.enable()
    this.clock.getDelta()
  }

  resetCamera() {
    const camY = 3.6
    const camZ = -4
    this.camera.position.set(0, camY, camZ)
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

    const playerPosition = this.player.getPosition()
    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position)
    }
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, playerPosition.x * 0.35, 0.08)
    const lookZ = playerPosition.z - Math.min(2.0, this.road.getSegmentLength() * 0.15)
    this.camera.lookAt(playerPosition.x, playerPosition.y + 0.35, lookZ)

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame((nextTime) => this.animate(nextTime))
  }
}
