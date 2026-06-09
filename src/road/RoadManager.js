import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { isMobileDevice, loadGltfWithTimeout } from '../utils/assetLoading.js'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function collectMeshes(root) {
  const meshes = []
  root.traverse((object) => {
    if (object && object.isMesh) meshes.push(object)
  })
  return meshes
}

function randomIndex(limit) {
  return Math.floor(Math.random() * limit)
}

export class RoadManager {
  constructor(scene, config, loadingManager) {
    this.scene = scene
    this.config = config
    this.loader = new GLTFLoader(loadingManager)
    this.chunkDefinitions = []
    this.segments = []
    this.roadMeshes = []
    this.segmentLength = config.fallbackSegmentLength
    this.roadHeight = 0
    this.spawnY = 0
    this.lanePositions = []
    this.definitionById = new Map()
    this.modelPools = new Map()
    this.surfaceRaycaster = new THREE.Raycaster()
    this.surfaceDirection = new THREE.Vector3(0, -1, 0)
    this.surfaceOrigin = new THREE.Vector3()
  }

  async load() {
    const chunkConfigs = this.config.chunks?.length
      ? this.config.chunks
      : this.config.modelUrls?.length
        ? this.config.modelUrls.map((url) => ({ url }))
        : [{ url: this.config.modelUrl }]
    const timeoutMs = isMobileDevice() ? 90000 : 45000
    const sequential = isMobileDevice()
    const gltfs = []
    if (sequential) {
      for (const chunk of chunkConfigs) {
        gltfs.push(await loadGltfWithTimeout(this.loader, chunk.url, timeoutMs))
      }
    } else {
      const loaded = await Promise.all(
        chunkConfigs.map((chunk) => loadGltfWithTimeout(this.loader, chunk.url, timeoutMs)),
      )
      gltfs.push(...loaded)
    }
    this.chunkDefinitions = gltfs.map((gltf, index) => this._preparePrototype(gltf.scene, index, chunkConfigs[index]))
    this._initializePools()
    this._createInitialSegments()
    this._refreshRoadMeshes()
  }

  _initializePools() {
    this.definitionById.clear()
    this.modelPools.clear()
    for (const definition of this.chunkDefinitions) {
      this.definitionById.set(definition.id, definition)
      this.modelPools.set(definition.id, [])
    }
  }

  async _loadModel(url) {
    const timeoutMs = isMobileDevice() ? 90000 : 45000
    return loadGltfWithTimeout(this.loader, url, timeoutMs)
  }

  _preparePrototype(root, index, chunkConfig = {}) {
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    root.position.x -= center.x
    root.position.y -= box.min.y
    root.position.z -= box.max.z
    root.updateMatrixWorld(true)

    const segmentLength = size.z || this.config.fallbackSegmentLength
    const connectLength = chunkConfig.connectLength ?? segmentLength
    const segmentWidth = size.x

    if (index === 0) {
      this.segmentLength = segmentLength
      this.roadHeight = size.y
      this.spawnY = Math.max(0, this.config.spawnY ?? 0)

      const laneSpacing = clamp(segmentWidth * this.config.laneSpacingRatio, this.config.minLaneSpacing, this.config.maxLaneSpacing)
      this.lanePositions = Array.from({ length: this.config.laneCount }, (_, laneIndex) => {
        return (laneIndex - (this.config.laneCount - 1) / 2) * laneSpacing
      })
    } else {
      this.roadHeight = Math.max(this.roadHeight, size.y)
    }

    const meshes = collectMeshes(root)
    const anchors = this._computeAnchors(meshes, segmentLength)

    return {
      id: `chunk-${index}`,
      url: chunkConfig.url,
      prototype: root,
      length: segmentLength,
      connectLength,
      offsetX: chunkConfig.offsetX ?? 0,
      frontAnchorZ: anchors.frontAnchorZ,
      backAnchorZ: anchors.backAnchorZ,
      frontSurfaceY: anchors.frontSurfaceY,
      backSurfaceY: anchors.backSurfaceY,
    }
  }

  _computeAnchors(meshes, segmentLength) {
    const seamInset = Math.min(this.config.seamSampleInset ?? 1.5, Math.max(segmentLength * 0.25, 0.5))
    const frontFallbackZ = -seamInset
    const backFallbackZ = -segmentLength + seamInset

    const frontAnchorZ = this._findRoadAnchorZ(meshes, 0, -segmentLength, -1) ?? frontFallbackZ
    const backAnchorZ = this._findRoadAnchorZ(meshes, -segmentLength, 0, 1) ?? backFallbackZ

    const frontSurfaceY = this._sampleSurfaceY(meshes, frontAnchorZ) ?? 0
    const backSurfaceY = this._sampleSurfaceY(meshes, backAnchorZ) ?? frontSurfaceY

    return { frontAnchorZ, backAnchorZ, frontSurfaceY, backSurfaceY }
  }

  _findRoadAnchorZ(meshes, fromZ, toZ, direction) {
    const step = Math.abs(this.config.seamSearchStep ?? 0.5)
    let z = fromZ

    while ((direction < 0 && z >= toZ) || (direction > 0 && z <= toZ)) {
      if (this._sampleSurfaceY(meshes, z) !== null) return z
      z += direction * step
    }

    return null
  }

  _sampleSurfaceY(meshes, z) {
    const sampleXs = this.lanePositions.length ? [0, ...this.lanePositions] : [0]
    const hits = []

    for (const x of sampleXs) {
      this.surfaceOrigin.set(x, this.config.raycastOriginHeight, z)
      this.surfaceRaycaster.set(this.surfaceOrigin, this.surfaceDirection)
      const intersections = this.surfaceRaycaster.intersectObjects(meshes, true)
      if (intersections.length) {
        hits.push(intersections[0].point.y)
      }
    }

    if (!hits.length) return null
    hits.sort((a, b) => a - b)
    return hits[Math.floor(hits.length / 2)]
  }

  _createInitialSegments() {
    this.segments = []
    const firstDefinition = this.chunkDefinitions[0]
    if (!firstDefinition) return

    const firstSegment = this._createSegment(firstDefinition)
    firstSegment.position.x = firstSegment.userData.offsetX
    firstSegment.position.z = 0
    firstSegment.position.y = 0
    this.segments.push(firstSegment)
    this.scene.add(firstSegment)

    const backwardCount = this.config.backwardSegmentCount || 0
    let previousBackwardSegment = firstSegment
    for (let i = 1; i <= backwardCount; i += 1) {
      const segment = this._createSegment(this._pickRandomDefinition())
      this._placeSegmentBehind(previousBackwardSegment, segment)
      previousBackwardSegment = segment
      this.segments.push(segment)
      this.scene.add(segment)
    }

    let previousForwardSegment = firstSegment
    for (let i = 1; i < this.config.segmentCount; i += 1) {
      const segment = this._createSegment(this._pickRandomDefinition())
      this._placeSegmentAhead(previousForwardSegment, segment)
      previousForwardSegment = segment
      this.segments.push(segment)
      this.scene.add(segment)
    }
  }

  _pickRandomDefinition() {
    return this.chunkDefinitions[randomIndex(this.chunkDefinitions.length)]
  }

  _createSegment(definition) {
    const segment = new THREE.Group()
    segment.name = `RoadSegment:${definition.id}`
    segment.userData.segmentLength = definition.length
    segment.userData.connectLength = definition.connectLength
    segment.userData.definitionId = definition.id
    segment.userData.offsetX = definition.offsetX
    segment.userData.frontAnchorZ = definition.frontAnchorZ
    segment.userData.backAnchorZ = definition.backAnchorZ
    segment.userData.frontSurfaceY = definition.frontSurfaceY
    segment.userData.backSurfaceY = definition.backSurfaceY
    segment.userData.modelDefinitionId = definition.id
    segment.add(this._acquireModel(definition.id))
    return segment
  }

  _applyDefinition(segment, definition) {
    this._releaseSegmentModel(segment)
    while (segment.children.length) {
      segment.remove(segment.children[0])
    }
    segment.userData.segmentLength = definition.length
    segment.userData.connectLength = definition.connectLength
    segment.userData.definitionId = definition.id
    segment.userData.offsetX = definition.offsetX
    segment.userData.frontAnchorZ = definition.frontAnchorZ
    segment.userData.backAnchorZ = definition.backAnchorZ
    segment.userData.frontSurfaceY = definition.frontSurfaceY
    segment.userData.backSurfaceY = definition.backSurfaceY
    segment.userData.modelDefinitionId = definition.id
    segment.name = `RoadSegment:${definition.id}`
    segment.add(this._acquireModel(definition.id))
  }

  _acquireModel(definitionId) {
    const pool = this.modelPools.get(definitionId)
    if (pool && pool.length) {
      return pool.pop()
    }

    const definition = this.definitionById.get(definitionId)
    if (!definition) throw new Error(`Missing road definition ${definitionId}`)
    return definition.prototype.clone(true)
  }

  _releaseSegmentModel(segment) {
    if (!segment || !segment.children.length) return

    const model = segment.children[0]
    const definitionId = segment.userData.modelDefinitionId
    if (!definitionId) return

    const pool = this.modelPools.get(definitionId)
    if (!pool) return
    pool.push(model)
  }

  _placeSegmentAhead(anchorSegment, nextSegment) {
    const lengthOffset = this.config.segmentLengthOffset ?? 0
    nextSegment.position.x = nextSegment.userData.offsetX
    // Exact seam align: next front anchor sits on anchor back anchor.
    nextSegment.position.z =
      anchorSegment.position.z +
      anchorSegment.userData.backAnchorZ -
      nextSegment.userData.frontAnchorZ -
      lengthOffset
    nextSegment.position.y = anchorSegment.position.y + anchorSegment.userData.backSurfaceY - nextSegment.userData.frontSurfaceY
  }

  _placeSegmentBehind(anchorSegment, nextSegment) {
    const lengthOffset = this.config.segmentLengthOffset ?? 0
    nextSegment.position.x = nextSegment.userData.offsetX
    // Exact seam align (reverse direction): next back anchor sits on anchor front anchor.
    nextSegment.position.z =
      anchorSegment.position.z +
      anchorSegment.userData.frontAnchorZ -
      nextSegment.userData.backAnchorZ +
      lengthOffset
    nextSegment.position.y = anchorSegment.position.y + anchorSegment.userData.frontSurfaceY - nextSegment.userData.backSurfaceY
  }

  _refreshRoadMeshes() {
    this.roadMeshes.length = 0
    for (const segment of this.segments) {
      this.roadMeshes.push(...collectMeshes(segment))
    }
  }

  getLanePositions() {
    return this.lanePositions
  }

  getRoadMeshes() {
    return this.roadMeshes
  }

  getSegmentLength() {
    return this.segmentLength
  }

  getRoadHeight() {
    return this.roadHeight
  }

  getSpawnY() {
    return this.spawnY
  }

  update(deltaTime, speed, cameraZ) {
    if (!this.segments.length || speed <= 0) return

    const offset = speed * deltaTime
    for (const segment of this.segments) {
      segment.position.z += offset
    }

    this.segments.sort((a, b) => a.position.z - b.position.z)
    const farSegment = this.segments[0]
    const nearSegment = this.segments[this.segments.length - 1]

    const nearBackEdge = nearSegment.position.z + nearSegment.userData.backAnchorZ
    const recycleThreshold = cameraZ + this.config.recycleThresholdOffset

    if (nearBackEdge > recycleThreshold) {
      const nextDefinition = this._pickRandomDefinition()
      this._applyDefinition(nearSegment, nextDefinition)
      this._placeSegmentAhead(farSegment, nearSegment)
      this._refreshRoadMeshes()
    }
  }
}
