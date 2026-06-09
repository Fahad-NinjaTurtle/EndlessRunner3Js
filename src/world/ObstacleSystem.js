import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { isMobileDevice, loadGltfWithTimeout } from '../utils/assetLoading.js'
import { buildBoxColliderParts, buildCarColliderParts } from '../physics/PhysicsWorld.js'

const DEFAULT_CONFIG = {
  spawnAheadMin: 40,
  spawnAheadMax: 82,
  despawnBehindOffset: 8,
  colliderPadding: 0.2,
  /** Extra space between car centers on the same lane (world units) — avoids nose-to-tail overlap */
  sameLaneCarGap: 5.5,
  obstacleSpawnInterval: { min: 0.38, max: 0.82 },
  coinSpawnInterval: { min: 0.2, max: 0.45 },
  obstacleFadeInDuration: 0.22,
  coinFadeInDuration: 0.16,
  difficulty: {
    rampDuration: 90,
    obstacleSpawnScaleMin: 0.42,
    carSpeedScaleMax: 2.1,
  },
  obstacleTypes: [
    {
      id: 'car',
      variantUrls: [
        'models/Obstacles/Car.glb',
        'models/Obstacles/Car 2.glb',
        'models/Obstacles/Car 3.glb',
        'models/Obstacles/Car 4.glb',
      ],
      lanes: [0, 2],
      scale: 1,
      yOffset: 0,
      movingTowardPlayerSpeed: 8.5,
      weight: 2.85,
      colliderScale: { x: 0.6, y: 0.5, z: 0.6 },
      colliderKind: 'carCompound',
    },
    {
      id: 'tree',
      url: 'models/Obstacles/Tree Obstacle.glb',
      lanes: [1],
      scale: 1,
      yOffset: 0,
      movingTowardPlayerSpeed: 0,
      weight: 0.9,
      colliderScale: { x: 0.2, y: 0.82, z: 0.1 },
    },
    {
      id: 'vlc',
      url: 'models/Obstacles/Vlc.glb',
      lanes: [0, 1, 2],
      /** Visual scale — collision half-extents and beam offset scale with this */
      scale: 1.12,
      yOffset: 0,
      movingTowardPlayerSpeed: 0,
      weight: 1,
      /**
       * One mesh-sized AABB would block the underpass. Use a thin "beam" slab near the top
       * (like Unity box colliders on the board only, not a single mesh collider on the whole GLB).
       */
      colliderKind: 'beam',
      beamCenterYRatio: 0.84,
      beamHalfHeightRatio: 0.085,
      colliderScale: { x: 0.58, y: 0.7, z: 0.68 },
    },
  ],
  coin: {
    id: 'carrot',
    url: 'models/Carrot.glb',
    scale: 1.2,
    yOffset: 0.8,
    lanes: [0, 1, 2],
    spinSpeed: 2.4,
    /** Spawn bias by lane index [left, center, right]: higher = more likely */
    laneWeights: [12, 1, 12],
  },
}

function randomRange(min, max) {
  return min + Math.random() * (max - min)
}

/** Pick a lane index from `allowedLanes` using per-lane weights (by global lane index). */
function pickWeightedLaneIndex(allowedLanes, weightsByLaneIndex) {
  if (!allowedLanes?.length) return 0
  const weights = allowedLanes.map((laneIdx) => {
    const w = weightsByLaneIndex?.[laneIdx]
    return typeof w === 'number' && w > 0 ? w : 1
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < allowedLanes.length; i++) {
    r -= weights[i]
    if (r <= 0) return allowedLanes[i]
  }
  return allowedLanes[allowedLanes.length - 1]
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

function withMaterials(object, callback) {
  object.traverse((node) => {
    if (!node?.isMesh || !node.material) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    materials.forEach((material) => callback(material, node))
  })
}

let nextPhysicsItemId = 1

export class ObstacleSystem {
  constructor(scene, loadingManager, config = DEFAULT_CONFIG, physicsWorld = null) {
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
    this.physics = physicsWorld
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
    const sequential = isMobileDevice()
    const loaded = []
    if (sequential) {
      for (const def of defs) {
        loaded.push(await this._loadDefinition(def))
      }
    } else {
      loaded.push(...(await Promise.all(defs.map((def) => this._loadDefinition(def)))))
    }
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
    const timeoutMs = isMobileDevice() ? 90000 : 45000
    return loadGltfWithTimeout(this.loader, url, timeoutMs)
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
    const colliderCenterOffset = new THREE.Vector3(0, 0, 0)
    let colliderHalfExtents
    if (def.colliderKind === 'beam') {
      const halfY = Math.max(
        0.06,
        measured.y * (def.beamHalfHeightRatio ?? 0.08),
      )
      colliderHalfExtents = new THREE.Vector3(
        Math.max(0.15, measured.x * (colliderScale.x ?? 0.5)),
        halfY,
        Math.max(0.15, measured.z * (colliderScale.z ?? 0.5)),
      )
      colliderCenterOffset.y = measured.y * (def.beamCenterYRatio ?? 0.85)
    } else {
      colliderHalfExtents = new THREE.Vector3(
        Math.max(0.15, measured.x * (colliderScale.x ?? 0.5)),
        Math.max(0.15, measured.y * (colliderScale.y ?? 0.5)),
        Math.max(0.15, measured.z * (colliderScale.z ?? 0.5)),
      )
    }
    let physicsParts = null
    if (def.colliderKind === 'carCompound') {
      physicsParts = buildCarColliderParts(measured, def.scale ?? 1)
    } else if (def.colliderKind === 'beam') {
      physicsParts = buildBoxColliderParts(
        {
          x: colliderHalfExtents.x,
          y: colliderHalfExtents.y,
          z: colliderHalfExtents.z,
        },
        {
          x: colliderCenterOffset.x,
          y: colliderCenterOffset.y,
          z: colliderCenterOffset.z,
        },
      )
    } else {
      physicsParts = buildBoxColliderParts(
        {
          x: colliderHalfExtents.x,
          y: colliderHalfExtents.y,
          z: colliderHalfExtents.z,
        },
        { x: 0, y: colliderHalfExtents.y, z: 0 },
      )
    }

    return {
      ...def,
      prototype: root,
      measuredSize: measured,
      baseRadius: Math.max(measured.x, measured.y, measured.z) * 0.5,
      colliderHalfExtents,
      colliderCenterOffset,
      physicsParts,
    }
  }

  setPhysicsWorld(physicsWorld) {
    this.physics = physicsWorld
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
    if (this.physics) this.physics.clear()
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
    this._prepareFadeMaterials(model)
    this._setOpacity(model, 0)
    this.scene.add(model)
    return model
  }

  _release(item) {
    const def = this.modelDefs.get(item.typeId)
    if (!def) return
    this.scene.remove(item.model)
    item.model.visible = false
    this._setOpacity(item.model, 1)
    const pool = this.pools.get(def.id)
    if (!pool) return
    pool.push(item.model)
  }

  _prepareFadeMaterials(model) {
    withMaterials(model, (material, node) => {
      if (!node.userData.__runtimeMaterialCloned) {
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => m.clone())
          : node.material.clone()
        node.userData.__runtimeMaterialCloned = true
      }
      if (Array.isArray(node.material)) {
        node.material.forEach((m) => {
          m.transparent = true
          m.depthWrite = true
        })
      } else {
        node.material.transparent = true
        node.material.depthWrite = true
      }
    })
  }

  _setOpacity(model, opacity) {
    const clamped = THREE.MathUtils.clamp(opacity, 0, 1)
    withMaterials(model, (material) => {
      material.opacity = clamped
      material.needsUpdate = true
    })
  }

  /** Cars only: ensure spawn Z is far enough from other cars in that lane (axis = track depth). */
  _pickCarLaneAndZ(playerZ, loadedDef) {
    const spawnScale = loadedDef.scale ?? 1
    const hzNew = Math.max(
      0.15,
      (loadedDef.colliderHalfExtents?.z ?? loadedDef.baseRadius * 0.5) * spawnScale,
    )
    const gap = this.config.sameLaneCarGap ?? 5.5
    const spawnMin = Math.max(this.config.spawnAheadMin, this.config.spawnAheadMax * 0.55)
    const zMin = playerZ - this.config.spawnAheadMax
    const zMax = playerZ - spawnMin
    const lanes = [...(loadedDef.lanes ?? [])].sort(() => Math.random() - 0.5)

    for (const laneIndex of lanes) {
      let z = playerZ - randomRange(spawnMin, this.config.spawnAheadMax)
      for (let pass = 0; pass < 36; pass++) {
        let adjusted = false
        for (const obs of this.activeObstacles) {
          if (obs.groupId !== 'car' || obs.laneIndex !== laneIndex) continue
          const hzObs = obs.halfExtents?.z ?? obs.radius * 0.65
          const need = hzNew + hzObs + gap
          if (Math.abs(z - obs.model.position.z) >= need) continue
          const zFurther = obs.model.position.z - need
          const zCloser = obs.model.position.z + need
          let nextZ = zFurther
          if (zFurther < zMin || zFurther > zMax) {
            if (zCloser >= zMin && zCloser <= zMax) nextZ = zCloser
            else {
              nextZ = Number.NaN
            }
          }
          if (!Number.isFinite(nextZ)) {
            z = Number.NaN
            break
          }
          z = nextZ
          adjusted = true
        }
        if (!Number.isFinite(z)) break
        if (!adjusted) {
          if (z >= zMin && z <= zMax) return { laneIndex, z }
          break
        }
      }
    }
    return null
  }

  _spawnFromDefinition(def, isCoin, playerZ) {
    if (!this.lanePositions.length) return
    const loadedDef = this.modelDefs.get(def.id)
    if (!loadedDef) return

    const allowedLanes = isCoin ? this.config.coin.lanes : loadedDef.lanes
    if (!allowedLanes?.length) return

    let laneIndex
    let z
    if (isCoin) {
      laneIndex = pickWeightedLaneIndex(allowedLanes, this.config.coin.laneWeights)
      const spawnMin = Math.max(this.config.spawnAheadMin, this.config.spawnAheadMax * 0.55)
      z = playerZ - randomRange(spawnMin, this.config.spawnAheadMax)
    } else if (loadedDef.obstacleGroupId === 'car') {
      const picked = this._pickCarLaneAndZ(playerZ, loadedDef)
      if (!picked) return
      laneIndex = picked.laneIndex
      z = picked.z
    } else {
      laneIndex = allowedLanes[Math.floor(Math.random() * allowedLanes.length)]
      const spawnMin = Math.max(this.config.spawnAheadMin, this.config.spawnAheadMax * 0.55)
      z = playerZ - randomRange(spawnMin, this.config.spawnAheadMax)
    }

    const x = this.lanePositions[laneIndex] ?? 0
    const y = this._sampleGroundY(x, z) + (loadedDef.yOffset ?? 0)
    const model = this._acquire(loadedDef)
    model.position.set(x, y, z)
    // All carrots share the same spin phase (world time), so they rotate in sync
    if (isCoin) {
      const spinY = this.runTime * (this.config.coin.spinSpeed ?? 0)
      model.rotation.set(0, spinY, 0)
    }

    this.box.setFromObject(model)
    const radius =
      Math.max(this.box.getSize(this.tmpSize).length() * 0.3, loadedDef.baseRadius * 0.4) +
      this.config.colliderPadding
    const spawnScale = loadedDef.scale ?? 1
    const halfExtents = loadedDef.colliderHalfExtents?.clone()
    if (halfExtents) halfExtents.multiplyScalar(spawnScale)
    const collisionOffset = loadedDef.colliderCenterOffset
      ? loadedDef.colliderCenterOffset.clone().multiplyScalar(spawnScale)
      : new THREE.Vector3()
    const physicsId = `obs_${nextPhysicsItemId++}`
    const item = {
      typeId: loadedDef.id,
      groupId: loadedDef.obstacleGroupId ?? loadedDef.id,
      laneIndex,
      model,
      radius,
      halfExtents,
      collisionOffset,
      baseMoveSpeed: loadedDef.movingTowardPlayerSpeed ?? 0,
      fadeDuration: isCoin ? this.config.coinFadeInDuration : this.config.obstacleFadeInDuration,
      fadeElapsed: 0,
      isCoin,
      physicsId,
    }

    if (this.physics) {
      const pos = { x, y, z }
      if (isCoin) {
        this.physics.createCoinCollider(physicsId, pos, radius)
      } else if (loadedDef.physicsParts?.length) {
        this.physics.createObstacleColliders(physicsId, pos, loadedDef.physicsParts)
      }
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
    if (!playerData) return { hit: false, collected: 0, pickupPositions: [] }

    const playerPosition = playerData.position
    this.setPlayerLane(playerData.laneIndex ?? this.playerLaneIndex)
    if (this.enabled) this.runTime += deltaTime

    const worldScrollSpeed = Math.max(0, gameSpeed)
    const carSpeedScale = this._getDynamicCarSpeedScale()
    for (const obstacle of this.activeObstacles) {
      const towardPlayerSpeed =
        obstacle.groupId === 'car' ? obstacle.baseMoveSpeed * carSpeedScale : obstacle.baseMoveSpeed
      obstacle.model.position.z += (worldScrollSpeed + towardPlayerSpeed) * deltaTime
      obstacle.fadeElapsed += deltaTime
      this._setOpacity(obstacle.model, obstacle.fadeElapsed / Math.max(0.01, obstacle.fadeDuration))
    }
    const spinY = this.runTime * (this.config.coin.spinSpeed ?? 0)
    for (const coin of this.activeCoins) {
      coin.model.position.z += worldScrollSpeed * deltaTime
      coin.model.rotation.set(0, spinY, 0)
      coin.fadeElapsed += deltaTime
      this._setOpacity(coin.model, coin.fadeElapsed / Math.max(0.01, coin.fadeDuration))
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

    for (const obstacle of this.activeObstacles) {
      if (!this.physics || !obstacle.physicsId) continue
      const p = obstacle.model.position
      this.physics.syncObstacle(obstacle.physicsId, { x: p.x, y: p.y, z: p.z })
    }
    for (const coin of this.activeCoins) {
      if (!this.physics || !coin.physicsId) continue
      const p = coin.model.position
      this.physics.syncCoin(coin.physicsId, { x: p.x, y: p.y, z: p.z })
    }

    let hit = false
    let collected = 0
    const pickupPositions = []
    let platformSurfaces = []

    if (this.physics) {
      const physicsResult = this.physics.detectCollisions(playerData)
      hit = physicsResult.hit
      platformSurfaces = physicsResult.platformSurfaces ?? []

      if (physicsResult.collectedCoinIds?.length) {
        const collectedSet = new Set(physicsResult.collectedCoinIds)
        this.activeCoins = this.activeCoins.filter((coin) => {
          if (!collectedSet.has(coin.physicsId)) return true
          collected += 1
          pickupPositions.push(coin.model.position.clone())
          this._despawn(coin, true)
          return false
        })
      }
    } else {
      const playerRadius = playerData.radius
      const playerHalfExtents = new THREE.Vector3(
        playerRadius * 0.45,
        playerRadius * 0.95,
        playerRadius * 0.62,
      )
      for (const obstacle of this.activeObstacles) {
        const off = obstacle.collisionOffset
        const ox = obstacle.model.position.x + (off?.x ?? 0)
        const oy = obstacle.model.position.y + (off?.y ?? 0)
        const oz = obstacle.model.position.z + (off?.z ?? 0)
        const dx = Math.abs(ox - playerPosition.x)
        const dy = Math.abs(oy - playerPosition.y)
        const dz = Math.abs(oz - playerPosition.z)
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
        pickupPositions.push(coin.model.position.clone())
        this._despawn(coin, true)
        return false
      })
    }

    return { hit, collected, pickupPositions, platformSurfaces }
  }

  _despawn(item) {
    if (this.physics && item.physicsId) {
      if (item.isCoin) this.physics.removeCoin(item.physicsId)
      else this.physics.removeObstacle(item.physicsId)
    }
    this._release(item)
  }
}
