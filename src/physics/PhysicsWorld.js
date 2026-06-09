import RAPIER from '@dimforge/rapier3d-compat'

const GROUP_PLAYER = 0x0001
const GROUP_LETHAL = 0x0002
const GROUP_PLATFORM = 0x0004
const GROUP_COIN = 0x0008

function collisionGroups(membership, filter) {
  return (membership << 16) | filter
}

const PLAYER_GROUPS = collisionGroups(GROUP_PLAYER, GROUP_LETHAL | GROUP_PLATFORM | GROUP_COIN)
const LETHAL_GROUPS = collisionGroups(GROUP_LETHAL, GROUP_PLAYER)
const PLATFORM_GROUPS = collisionGroups(GROUP_PLATFORM, GROUP_PLAYER)
const COIN_GROUPS = collisionGroups(GROUP_COIN, GROUP_PLAYER)

let rapierReady = null

export async function initRapier() {
  if (!rapierReady) {
    rapierReady = RAPIER.init().then(() => RAPIER)
  }
  return rapierReady
}

export class PhysicsWorld {
  constructor() {
    this.RAPIER = null
    this.world = null
    this.playerBody = null
    this.playerCollider = null
    this.obstacleHandles = new Map()
    this.coinHandles = new Map()
    /** Rapier 0.19 has no collider userData — metadata keyed by collider.handle */
    this.colliderMeta = new Map()
    this._tmpTranslation = { x: 0, y: 0, z: 0 }
    this._tmpRotation = { w: 1, x: 0, y: 0, z: 0 }
    this._queryShape = null
    this._queryShapeKey = ''
  }

  _getQueryShape(hx, hy, hz) {
    const key = `${hx.toFixed(3)}:${hy.toFixed(3)}:${hz.toFixed(3)}`
    if (!this._queryShape || this._queryShapeKey !== key) {
      this._queryShape = new this.RAPIER.Cuboid(hx, hy, hz)
      this._queryShapeKey = key
    }
    return this._queryShape
  }

  _setColliderMeta(collider, meta) {
    this.colliderMeta.set(collider.handle, meta)
  }

  _getColliderMeta(collider) {
    return this.colliderMeta.get(collider.handle) ?? null
  }

  _clearColliderMeta(colliders) {
    for (const collider of colliders) {
      this.colliderMeta.delete(collider.handle)
    }
  }

  async init() {
    this.RAPIER = await initRapier()
    this.world = new this.RAPIER.World({ x: 0, y: 0, z: 0 })
    this._createPlayerCollider()
  }

  _createPlayerCollider() {
    if (!this.world) return
    const bodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased().setCanSleep(false)
    this.playerBody = this.world.createRigidBody(bodyDesc)
    const colliderDesc = this.RAPIER.ColliderDesc.cuboid(0.35, 0.55, 0.4)
      .setCollisionGroups(PLAYER_GROUPS)
      .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS)
    this.playerCollider = this.world.createCollider(colliderDesc, this.playerBody)
  }

  syncPlayer(playerData) {
    if (!this.playerBody || !playerData?.position) return

    const radius = playerData.radius ?? 0.55
    const hx = radius * 0.45
    const hy = radius * 0.95
    const hz = radius * 0.62
    const pos = playerData.position

    this._tmpTranslation.x = pos.x
    this._tmpTranslation.y = pos.y
    this._tmpTranslation.z = pos.z
    this.playerBody.setNextKinematicTranslation(this._tmpTranslation)

    this.playerBody.setNextKinematicRotation(this._tmpRotation)
    this.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }

  /**
   * @param {string} itemId
   * @param {{ x: number, y: number, z: number }} position
   * @param {Array<{ kind: 'lethal'|'platform', halfExtents: {x,y,z}, offset: {x,y,z} }>} parts
   */
  createObstacleColliders(itemId, position, parts) {
    if (!this.world || this.obstacleHandles.has(itemId)) return

    const bodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased().setCanSleep(false)
    const body = this.world.createRigidBody(bodyDesc)
    const colliders = []

    for (const part of parts) {
      const he = part.halfExtents
      const off = part.offset ?? { x: 0, y: 0, z: 0 }
      const desc = this.RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
        .setTranslation(off.x, off.y, off.z)
        .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS)

      if (part.kind === 'platform') {
        desc.setCollisionGroups(PLATFORM_GROUPS)
      } else {
        desc.setCollisionGroups(LETHAL_GROUPS)
      }

      const collider = this.world.createCollider(desc, body)
      this._setColliderMeta(collider, {
        kind: part.kind,
        itemId,
        halfExtents: { ...he },
        offset: { ...off },
      })
      colliders.push(collider)
    }

    this._setBodyTranslation(body, position)
    this.obstacleHandles.set(itemId, { body, colliders, itemId })
  }

  createCoinCollider(itemId, position, radius) {
    if (!this.world || this.coinHandles.has(itemId)) return

    const bodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased().setCanSleep(false)
    const body = this.world.createRigidBody(bodyDesc)
    const desc = this.RAPIER.ColliderDesc.ball(radius)
      .setCollisionGroups(COIN_GROUPS)
      .setSensor(true)
      .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS)

    const collider = this.world.createCollider(desc, body)
    this._setColliderMeta(collider, { kind: 'coin', itemId })
    this._setBodyTranslation(body, position)
    this.coinHandles.set(itemId, { body, collider, itemId })
  }

  syncObstacle(itemId, position) {
    const handle = this.obstacleHandles.get(itemId)
    if (!handle) return
    this._setBodyTranslation(handle.body, position)
  }

  syncCoin(itemId, position) {
    const handle = this.coinHandles.get(itemId)
    if (!handle) return
    this._setBodyTranslation(handle.body, position)
  }

  removeObstacle(itemId) {
    const handle = this.obstacleHandles.get(itemId)
    if (!handle || !this.world) return
    this._clearColliderMeta(handle.colliders)
    this.world.removeRigidBody(handle.body)
    this.obstacleHandles.delete(itemId)
  }

  removeCoin(itemId) {
    const handle = this.coinHandles.get(itemId)
    if (!handle || !this.world) return
    this._clearColliderMeta([handle.collider])
    this.world.removeRigidBody(handle.body)
    this.coinHandles.delete(itemId)
  }

  clear() {
    if (!this.world) return
    for (const id of [...this.obstacleHandles.keys()]) {
      this.removeObstacle(id)
    }
    for (const id of [...this.coinHandles.keys()]) {
      this.removeCoin(id)
    }
    this.colliderMeta.clear()
  }

  _setBodyTranslation(body, position) {
    this._tmpTranslation.x = position.x
    this._tmpTranslation.y = position.y
    this._tmpTranslation.z = position.z
    body.setNextKinematicTranslation(this._tmpTranslation)
    body.setNextKinematicRotation(this._tmpRotation)
  }

  step() {
    if (!this.world) return
    this.world.step()
  }

  /**
   * @param {object} playerData
   * @returns {{ hit: boolean, collectedCoinIds: string[], platformSurfaces: Array<{ topY: number, itemId: string }> }}
   */
  detectCollisions(playerData) {
    const result = {
      hit: false,
      collectedCoinIds: [],
      platformSurfaces: [],
    }

    if (!this.world || !playerData?.position) return result

    this.syncPlayer(playerData)
    this.step()

    const pos = playerData.position
    const radius = playerData.radius ?? 0.55
    const hx = radius * 0.45
    const hy = radius * 0.95
    const hz = radius * 0.62
    const velocityY = playerData.velocityY ?? 0
    const isJumping = Boolean(playerData.isJumping)
    const characterHeight = playerData.currentHeight ?? 0.55
    const surfaceUnderFeet = pos.y - characterHeight
    const playerBottomY = pos.y - hy
    const playerTopY = pos.y + hy

    const shape = this._getQueryShape(hx, hy, hz)
    const shapePos = { x: pos.x, y: pos.y, z: pos.z }
    const shapeRot = { w: 1, x: 0, y: 0, z: 0 }

    const intersections = []
    this.world.intersectionsWithShape(
      shapePos,
      shapeRot,
      shape,
      (collider) => {
        const userData = this._getColliderMeta(collider)
        if (userData) intersections.push({ collider, userData })
        return true
      },
      undefined,
      undefined,
      this.playerCollider ?? undefined,
    )

    const onPlatformItems = new Set()

    for (const { collider, userData } of intersections) {
      if (userData.kind === 'coin') {
        result.collectedCoinIds.push(userData.itemId)
        continue
      }

      const body = collider.parent()
      if (!body) continue
      const bodyPos = body.translation()
      const off = userData.offset ?? { x: 0, y: 0, z: 0 }
      const he = userData.halfExtents ?? { x: 0.3, y: 0.3, z: 0.3 }
      const centerY = bodyPos.y + off.y
      const topY = centerY + he.y
      const bottomY = centerY - he.y

      if (userData.kind === 'platform') {
        const playerHalfX = hx
        const playerHalfZ = hz
        const platformX = bodyPos.x + off.x
        const platformZ = bodyPos.z + off.z
        const overlapX = Math.abs(pos.x - platformX) <= he.x + playerHalfX
        const overlapZ = Math.abs(pos.z - platformZ) <= he.z + playerHalfZ
        if (!overlapX || !overlapZ) continue

        const standingOnHood = surfaceUnderFeet >= topY - 0.26
        const landingOnHood =
          isJumping &&
          velocityY <= 0 &&
          surfaceUnderFeet >= topY - 0.28 &&
          surfaceUnderFeet <= topY + 0.12

        if (standingOnHood || landingOnHood) {
          onPlatformItems.add(userData.itemId)
          result.platformSurfaces.push({
            topY,
            itemId: userData.itemId,
            x: platformX,
            z: platformZ,
            halfX: he.x,
            halfZ: he.z,
          })
        }
        continue
      }

      if (userData.kind === 'lethal') {
        const hitFromFront = playerTopY > bottomY + 0.08 && playerBottomY < topY - 0.05
        if (!onPlatformItems.has(userData.itemId) && hitFromFront) {
          result.hit = true
        }
      }
    }

    return result
  }
}

/**
 * Build compound car colliders: hood = platform, front bumper = lethal only.
 * Cars move toward +Z; the front faces the approaching player.
 */
export function buildCarColliderParts(measured, scale = 1) {
  const mx = measured.x * scale
  const my = measured.y * scale
  const mz = measured.z * scale

  return [
    {
      kind: 'platform',
      halfExtents: {
        x: Math.max(0.35, mx * 0.46),
        y: Math.max(0.05, my * 0.06),
        z: Math.max(0.25, mz * 0.38),
      },
      offset: {
        x: 0,
        y: my * 0.82,
        z: 0,
      },
    },
    {
      kind: 'lethal',
      halfExtents: {
        x: Math.max(0.35, mx * 0.44),
        y: Math.max(0.2, my * 0.3),
        z: Math.max(0.08, mz * 0.14),
      },
      offset: {
        x: 0,
        y: my * 0.38,
        z: mz * 0.38,
      },
    },
  ]
}

/**
 * Standard lethal box for trees and similar obstacles.
 */
export function buildBoxColliderParts(halfExtents, offset = { x: 0, y: 0, z: 0 }) {
  return [
    {
      kind: 'lethal',
      halfExtents: { ...halfExtents },
      offset: { ...offset },
    },
  ]
}
