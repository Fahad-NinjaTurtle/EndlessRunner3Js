import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const DEFAULT_CONFIG = {
  spawnAheadMin: 40,
  spawnAheadMax: 82,
  despawnBehindOffset: 8,
  colliderPadding: 0.2,
  obstacleSpawnInterval: { min: 0.55, max: 1.2 },
  coinSpawnInterval: { min: 0.2, max: 0.45 },
  difficulty: {
    rampDuration: 90,
    obstacleSpawnScaleMin: 0.42,
    carSpeedScaleMax: 2.1,
  },
  obstacleTypes: [
    {
      id: 'car',
      variantUrls: [
        '/models/Obstacles/Car.glb',
        '/models/Obstacles/Car 2.glb',
        '/models/Obstacles/Car 3.glb',
        '/models/Obstacles/Car 4.glb',
      ],
      lanes: [0, 2],
      scale: 1,
      yOffset: 0,
      movingTowardPlayerSpeed: 5.5,
      weight: 1.1,
      colliderScale: { x: 0.72, y: 0.72, z: 0.74 },
    },
    {
      id: 'tree',
      url: '/models/Obstacles/Tree Obstacle.glb',
      lanes: [1],
      scale: 1,
      yOffset: 0,
      movingTowardPlayerSpeed: 0,
      weight: 0.9,
      colliderScale: { x: 0.38, y: 0.82, z: 0.52 },
    },
    {
      id: 'vlc',
      url: '/models/Obstacles/Vlc.glb',
      lanes: [0, 1, 2],
      scale: 1,
      yOffset: 0,
      movingTowardPlayerSpeed: 0,
      weight: 1,
      colliderScale: { x: 0.66, y: 0.7, z: 0.66 },
    },
  ],
  coin: {
    id: 'carrot',
    url: '/models/Carrot.glb',
    scale: 1.2,
    yOffset: 0.8,
    lanes: [0, 1, 2],
    spinSpeed: 2.4,
  },
}

function randomRange(min, max) {
  return min + Math.random() * (max - min)
}

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= item.weight ?? 1
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

function collectMeshes(root) {
  const meshes = []
  root.traverse((obj) => {
    if (obj?.isMesh) meshes.push(obj)
  })
  return meshes
}

export class ObstacleSystem {
  constructor(scene, loadingManager, config = DEFAULT_CONFIG) {
    this.scene = scene
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      obstacleSpawnInterval: {
        ...DEFAULT_CONFIG.obstacleSpawnInterval,
        ...(config?.obstacleSpawnInterval ?? {}),
      },
      coinSpawnInterval: {
        ...DEFAULT_CONFIG.coinSpawnInterval,
        ...(config?.coinSpawnInterval ?? {}),
      },
      coin: {
        ...DEFAULT_CONFIG.coin,
        ...(config?.coin ?? {}),
      },
      difficulty: {
        ...DEFAULT_CONFIG.difficulty,
        ...(config?.difficulty ?? {}),
      },
      obstacleTypes: config?.obstacleTypes ?? DEFAULT_CONFIG.obstacleTypes,
    }
    this.loader = new GLTFLoader(loadingManager)
    this.enabled = false
    this.lanePositions = []
    this.roadMeshes = []
    this.playerLaneIndex = 1
    this.activeObstacles = []
    this.activeCoins = []
    this.modelDefs = new Map()
    this.pools = new Map()
    this.box = new THREE.Box3()
    this.tmpSize = new THREE.Vector3()
    this.raycaster = new THREE.Raycaster()
    this.rayOrigin = new THREE.Vector3()
    this.rayDirection = new THREE.Vector3(0, -1, 0)
    this.obstacleSpawnTimer = 0
    this.coinSpawnTimer = 0
    this.spawnableObstacleDefs = []
    this.runTime = 0
    this.resetSpawnTimers()
  }

  async load() {
    this.spawnableObstacleDefs = this._expandObstacleDefinitions(this.config.obstacleTypes)
    const defs = [...this.spawnableObstacleDefs, this.config.coin]
    const loaded = await Promise.all(defs.map((def) => this._loadDefinition(def)))
    for (const def of loaded) {
      this.modelDefs.set(def.id, def)
      this.pools.set(def.id, [])
    }
  }

  _expandObstacleDefinitions(definitions) {
    const expanded = []
    for (const definition of definitions) {
      const variants = Array.isArray(definition.variantUrls)
        ? definition.variantUrls.filter(Boolean)
        : definition.url
          ? [definition.url]
          : []
      if (!variants.length) continue

      const variantWeight = (definition.weight ?? 1) / variants.length
      variants.forEach((url, index) => {
        expanded.push({
          ...definition,
          id: variants.length > 1 ? `${definition.id}__${index + 1}` : definition.id,
          obstacleGroupId: definition.id,
          url,
          weight: variantWeight,
        })
      })
    }
    return expanded
  }

  _loadModel(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject)
    })
  }

  async _loadDefinition(def) {
    const gltf = await this._loadModel(def.url)
    const root = gltf.scene
    const box = new THREE.Box3().setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())
    const bottom = box.min.y
    root.position.x -= center.x
    root.position.z -= center.z
    root.position.y -= bottom
    root.updateMatrixWorld(true)
    const measured = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
    const colliderScale = def.colliderScale ?? {}
    const colliderHalfExtents = new THREE.Vector3(
      Math.max(0.15, measured.x * (colliderScale.x ?? 0.5)),
      Math.max(0.15, measured.y * (colliderScale.y ?? 0.5)),
      Math.max(0.15, measured.z * (colliderScale.z ?? 0.5)),
    )
    return {
      ...def,
      prototype: root,
      baseRadius: Math.max(measured.x, measured.y, measured.z) * 0.5,
      colliderHalfExtents,
    }
  }

  setLanePositions(lanes) {
    this.lanePositions = Array.isArray(lanes) ? [...lanes] : []
  }

  setRoadMeshes(meshes) {
    this.roadMeshes = Array.isArray(meshes) ? meshes : []
  }

  setPlayerLane(laneIndex) {
    this.playerLaneIndex = laneIndex
  }

  start() {
    this.enabled = true
    this.runTime = 0
    this.resetSpawnTimers()
  }

  stop() {
    this.enabled = false
  }

  reset() {
    this.enabled = false
    for (const obj of this.activeObstacles) {
      this._despawn(obj, false)
    }
    for (const coin of this.activeCoins) {
      this._despawn(coin, true)
    }
    this.activeObstacles.length = 0
    this.activeCoins.length = 0
    this.runTime = 0
    this.resetSpawnTimers()
  }

  resetSpawnTimers() {
    const { obstacleMin, obstacleMax, coinMin, coinMax } = this._getDynamicSpawnIntervals()
    this.obstacleSpawnTimer = randomRange(
      obstacleMin,
      obstacleMax,
    )
    this.coinSpawnTimer = randomRange(coinMin, coinMax)
  }

  _getDifficultyProgress() {
    const rampDuration = Math.max(15, this.config.difficulty.rampDuration ?? 90)
    return THREE.MathUtils.clamp(this.runTime / rampDuration, 0, 1)
  }

  _getDynamicSpawnIntervals() {
    const t = this._getDifficultyProgress()
    const obstacleScale = THREE.MathUtils.lerp(1, this.config.difficulty.obstacleSpawnScaleMin, t)
    const coinScale = THREE.MathUtils.lerp(1, 0.85, t)
    return {
      obstacleMin: this.config.obstacleSpawnInterval.min * obstacleScale,
      obstacleMax: this.config.obstacleSpawnInterval.max * obstacleScale,
      coinMin: this.config.coinSpawnInterval.min * coinScale,
      coinMax: this.config.coinSpawnInterval.max * coinScale,
    }
  }

  _getDynamicCarSpeedScale() {
    const t = this._getDifficultyProgress()
    return THREE.MathUtils.lerp(1, this.config.difficulty.carSpeedScaleMax, t)
  }

  _acquire(def) {
    if (!def?.prototype) {
      throw new Error(`Obstacle definition "${def?.id ?? 'unknown'}" is not loaded.`)
    }
    const pool = this.pools.get(def.id)
    const model = pool?.length ? pool.pop() : def.prototype.clone(true)
    model.scale.setScalar(def.scale ?? 1)
    model.visible = true
    this.scene.add(model)
    return model
  }

  _release(item) {
    const def = this.modelDefs.get(item.typeId)
    if (!def) return
    this.scene.remove(item.model)
    item.model.visible = false
    const pool = this.pools.get(def.id)
    if (!pool) return
    pool.push(item.model)
  }

  _spawnFromDefinition(def, isCoin, playerZ) {
    if (!this.lanePositions.length) return
    const loadedDef = this.modelDefs.get(def.id)
    if (!loadedDef) return

    const allowedLanes = isCoin ? this.config.coin.lanes : loadedDef.lanes
    if (!allowedLanes?.length) return
    const laneIndex = allowedLanes[Math.floor(Math.random() * allowedLanes.length)]
    const x = this.lanePositions[laneIndex] ?? 0
    const spawnMin = Math.max(this.config.spawnAheadMin, this.config.spawnAheadMax * 0.55)
    const z = playerZ - randomRange(spawnMin, this.config.spawnAheadMax)
    const y = this._sampleGroundY(x, z) + (loadedDef.yOffset ?? 0)
    const model = this._acquire(loadedDef)
    model.position.set(x, y, z)

    this.box.setFromObject(model)
    const radius =
      Math.max(this.box.getSize(this.tmpSize).length() * 0.3, loadedDef.baseRadius * 0.4) +
      this.config.colliderPadding
    const item = {
      typeId: loadedDef.id,
      groupId: loadedDef.obstacleGroupId ?? loadedDef.id,
      laneIndex,
      model,
      radius,
      halfExtents: loadedDef.colliderHalfExtents?.clone(),
      baseMoveSpeed: loadedDef.movingTowardPlayerSpeed ?? 0,
      isCoin,
    }

    if (isCoin) {
      this.activeCoins.push(item)
    } else {
      this.activeObstacles.push(item)
    }
  }

  _sampleGroundY(x, z) {
    if (!this.roadMeshes.length) return 0
    this.rayOrigin.set(x, 60, z)
    this.raycaster.set(this.rayOrigin, this.rayDirection)
    const hits = this.raycaster.intersectObjects(this.roadMeshes, false)
    if (!hits.length) return 0
    return hits[0].point.y
  }

  update(deltaTime, gameSpeed, playerData) {
    if (!playerData) return { hit: false, collected: 0 }

    const playerPosition = playerData.position
    this.setPlayerLane(playerData.laneIndex ?? this.playerLaneIndex)
    if (this.enabled) this.runTime += deltaTime

    const worldScrollSpeed = Math.max(0, gameSpeed)
    const carSpeedScale = this._getDynamicCarSpeedScale()
    for (const obstacle of this.activeObstacles) {
      const towardPlayerSpeed =
        obstacle.groupId === 'car' ? obstacle.baseMoveSpeed * carSpeedScale : obstacle.baseMoveSpeed
      obstacle.model.position.z += (worldScrollSpeed + towardPlayerSpeed) * deltaTime
    }
    for (const coin of this.activeCoins) {
      coin.model.position.z += worldScrollSpeed * deltaTime
      coin.model.rotation.y += this.config.coin.spinSpeed * deltaTime
    }

    const despawnZ = playerPosition.z + this.config.despawnBehindOffset
    this.activeObstacles = this.activeObstacles.filter((item) => {
      if (item.model.position.z <= despawnZ) return true
      this._despawn(item, false)
      return false
    })
    this.activeCoins = this.activeCoins.filter((item) => {
      if (item.model.position.z <= despawnZ) return true
      this._despawn(item, true)
      return false
    })

    if (this.enabled) {
      this.obstacleSpawnTimer -= deltaTime
      this.coinSpawnTimer -= deltaTime

      if (this.obstacleSpawnTimer <= 0) {
        const choice = pickWeighted(this.spawnableObstacleDefs)
        this._spawnFromDefinition(choice, false, playerPosition.z)
        const { obstacleMin, obstacleMax } = this._getDynamicSpawnIntervals()
        this.obstacleSpawnTimer = randomRange(
          obstacleMin,
          obstacleMax,
        )
      }

      if (this.coinSpawnTimer <= 0) {
        this._spawnFromDefinition(this.config.coin, true, playerPosition.z)
        const { coinMin, coinMax } = this._getDynamicSpawnIntervals()
        this.coinSpawnTimer = randomRange(coinMin, coinMax)
      }
    }

    const playerRadius = playerData.radius
    const playerHalfExtents = new THREE.Vector3(playerRadius * 0.45, playerRadius * 0.95, playerRadius * 0.62)
    let hit = false
    let collected = 0
    for (const obstacle of this.activeObstacles) {
      const dx = Math.abs(obstacle.model.position.x - playerPosition.x)
      const dy = Math.abs(obstacle.model.position.y - playerPosition.y)
      const dz = Math.abs(obstacle.model.position.z - playerPosition.z)
      const obstacleHalf = obstacle.halfExtents
      const overlapsX = dx <= playerHalfExtents.x + (obstacleHalf?.x ?? obstacle.radius)
      const overlapsY = dy <= playerHalfExtents.y + (obstacleHalf?.y ?? obstacle.radius)
      const overlapsZ = dz <= playerHalfExtents.z + (obstacleHalf?.z ?? obstacle.radius)
      if (overlapsX && overlapsY && overlapsZ) {
        hit = true
        break
      }
    }

    this.activeCoins = this.activeCoins.filter((coin) => {
      const distance = coin.model.position.distanceTo(playerPosition)
      if (distance >= playerRadius + coin.radius) return true
      collected += 1
      this._despawn(coin, true)
      return false
    })

    return { hit, collected }
  }

  _despawn(item) {
    this._release(item)
  }
}
