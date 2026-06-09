import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PLAYER_CONFIG } from "../config/playerConfig.js";
import { isMobileDevice, loadGltfWithTimeout } from "../utils/assetLoading.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function findClip(animations, clipName) {
  if (!animations || !clipName) return null;
  return (
    animations.find(
      (clip) => clip.name.toLowerCase() === clipName.toLowerCase(),
    ) || null
  );
}

export class PlayerController {
  constructor(scene, config = PLAYER_CONFIG, loadingManager) {
    this.scene = scene;
    this.config = config;
    this.loader = new GLTFLoader(loadingManager);
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.group = null;
    this.roadMeshes = [];
    this.lanePositions = [];
    this.targetLane = config.defaultLane;
    this.currentLane = config.defaultLane;
    this.currentSpeed = 0;
    this.isActive = false;
    this.modelScale = config.modelScale ?? 1;
    this.baseHeight = config.collision.halfHeight * this.modelScale;
    this.currentHeight = this.baseHeight;
    this.startZ = 0;
    this.velocityY = 0;
    this.positionY = this.baseHeight;
    this.groundY = 0;
    this.isJumping = false;
    this.jumpElapsed = 0;
    /** Quick descent from jump: boosted gravity + fall animation until ground */
    this.fastFallBoost = false;
    /** Slide pressed mid-air: slam down and roll once grounded */
    this.pendingRollAfterLanding = false;
    /** W during slide: seconds left before jump starts (after quick run snap) */
    this.jumpChainFromRollRemaining = null;
    this.isRolling = false;
    this.rollTimer = 0;
    this.raycaster = new THREE.Raycaster();
    this.rayDirection = new THREE.Vector3(0, -1, 0);
    this.tmpOrigin = new THREE.Vector3();
    this.raycastHits = [];
    this.tmpNormalMatrix = new THREE.Matrix3();
    this.tmpFaceNormal = new THREE.Vector3();
    /** First session: idle preview faces camera; tap rotates to gameplayYaw */
    this.menuFacingActive = true;
    this.rotateToGameplayTimer = null;
    /** Hood / platform tops from Rapier — player can stand and run on these */
    this.platformSurfaces = [];
    this._groundSampleFrame = -1;
    this._groundSampleY = null;
  }

  _groundDeadband() {
    const mobile = isMobileDevice();
    return mobile
      ? (this.config.collision.groundDeadbandMobile ?? 0.14)
      : (this.config.collision.groundDeadband ?? 0.08);
  }

  _groundLerp() {
    const mobile = isMobileDevice();
    return mobile
      ? (this.config.collision.groundLerpMobile ?? 0.14)
      : (this.config.collision.groundLerp ?? 0.22);
  }

  /** Lane-centre X for ground probes — avoids seam jitter from per-frame lane drift offset */
  _groundProbeX() {
    if (this.lanePositions.length) {
      return this.lanePositions[this.targetLane] ?? this.group.position.x;
    }
    return this.group.position.x;
  }

  setPlatformSurfaces(surfaces) {
    this.platformSurfaces = Array.isArray(surfaces) ? surfaces : [];
  }

  async load() {
    const gltf = await this._loadModel(this.config.modelUrl);
    this.group = new THREE.Group();
    this.group.name = "PlayerRoot";
    this.group.add(gltf.scene);

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    const bottom = box.min.y;

    gltf.scene.position.x -= center.x;
    gltf.scene.position.z -= center.z;
    gltf.scene.position.y -= bottom;

    this.group.scale.setScalar(this.modelScale);
    this.scene.add(this.group);

    const scaledBox = new THREE.Box3().setFromObject(this.group);
    const halfHeight = scaledBox.getSize(new THREE.Vector3()).y * 0.5;
    this.baseHeight = Math.max(halfHeight, this.baseHeight);
    this.currentHeight = this.baseHeight;
    this.positionY = this.baseHeight;
    this.group.position.set(0, this.positionY, this.startZ);

    const menuYaw = this.config.menuFacingYaw ?? Math.PI;
    const playYaw = this.config.gameplayYaw ?? 0;
    this.group.rotation.y = menuYaw;
    this.menuFacingActive = Math.abs(menuYaw - playYaw) > 0.001;

    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      this.mixer.addEventListener("finished", (event) =>
        this._onActionFinished(event),
      );
      this._createActions(gltf.animations);
      this._setAction("idle");
    }
  }

  needsMenuToGameplayTurn() {
    return Boolean(this.menuFacingActive);
  }

  isRotatingToGameplay() {
    return this.rotateToGameplayTimer != null;
  }

  rotateToGameplayThen(onComplete) {
    if (!this.group || !this.menuFacingActive) {
      if (typeof onComplete === "function") onComplete();
      return;
    }
    if (this.rotateToGameplayTimer) return;

    const targetY = this.config.gameplayYaw ?? 0;
    const startY = this.group.rotation.y;
    const duration = Math.max(
      0.05,
      this.config.menuToGameplayRotateDuration ?? 0.42,
    );

    this.rotateToGameplayTimer = {
      startY,
      targetY,
      elapsed: 0,
      duration,
      onDone: () => {
        this.menuFacingActive = false;
        if (this.group) this.group.rotation.y = targetY;
        if (typeof onComplete === "function") onComplete();
      },
    };
  }

  _updateRotateToGameplay(deltaTime) {
    if (!this.rotateToGameplayTimer || !this.group) return;
    const t = this.rotateToGameplayTimer;
    t.elapsed += deltaTime;
    const k = Math.min(1, t.elapsed / t.duration);
    const s = k * k * (3 - 2 * k);
    this.group.rotation.y = THREE.MathUtils.lerp(t.startY, t.targetY, s);
    if (k >= 1) {
      const done = t.onDone;
      this.rotateToGameplayTimer = null;
      done();
    }
  }

  async _loadModel(url) {
    const timeoutMs = isMobileDevice() ? 90000 : 45000;
    return loadGltfWithTimeout(this.loader, url, timeoutMs);
  }

  _createActions(animations) {
    const names = this.config.animations;
    const animationKeys = Object.keys(names);

    for (const key of animationKeys) {
      const clipName = names[key];
      const clip = findClip(animations, clipName) || animations[0];
      if (!clip) continue;

      const action = this.mixer.clipAction(clip);
      if (key === "run" || key === "idle") {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
    }
  }

  _setAction(actionKey, fadeDuration = 0.12) {
    const nextAction =
      this.actions[actionKey] || this.actions.run || this.actions.idle;
    if (!nextAction) return;
    if (this.currentAction === nextAction) return;

    nextAction.reset().play();
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);

    if (this.currentAction) {
      this.currentAction.crossFadeTo(nextAction, fadeDuration, false);
    }
    this.currentAction = nextAction;
  }

  _onActionFinished(event) {
    if (!event || !event.action) return;
    if (event.action === this.actions.roll) {
      this._endGroundRoll();
      return;
    }

    if (
      event.action === this.actions.jump ||
      event.action === this.actions.land
    ) {
      if (!this.isJumping && !this.isRolling) {
        this._setAction("run", 0.08);
      }
    }
  }

  setLanePositions(lanePositions) {
    if (!Array.isArray(lanePositions) || lanePositions.length === 0) return;
    this.lanePositions = lanePositions;
    this.targetLane = clamp(this.targetLane, 0, this.lanePositions.length - 1);
    this.currentLane = this.targetLane;
    if (this.group) {
      this.group.position.x = this.lanePositions[this.targetLane];
    }
  }

  setRoadMeshes(meshes) {
    this.roadMeshes = meshes;
  }

  setStartPositionZ(value) {
    this.startZ = value;
    if (this.group) {
      this.group.position.z = value;
    }
  }

  startRunning() {
    if (this.isActive) return;
    this.isActive = true;
    this.currentSpeed = this.config.speed.initial;
    this._setAction("run", 0.18);
  }

  stopRunning() {
    this.isActive = false;
    this.currentSpeed = 0;
    this.fastFallBoost = false;
    this.pendingRollAfterLanding = false;
    this.jumpChainFromRollRemaining = null;
    this._restoreLandActionLoop();
    if (!this.isJumping && !this.isRolling) {
      this._setAction("idle", 0.12);
    }
  }

  moveLeft() {
    this.targetLane = clamp(
      this.targetLane - 1,
      0,
      this.lanePositions.length - 1,
    );
  }

  moveRight() {
    this.targetLane = clamp(
      this.targetLane + 1,
      0,
      this.lanePositions.length - 1,
    );
  }

  jump() {
    if (!this.group || this.isJumping) return;
    if (this.jumpChainFromRollRemaining != null) return;
    if (this.isRolling) {
      this._interruptRollForJump();
      return;
    }
    this.pendingRollAfterLanding = false;
    this._beginJumpFromGround();
  }

  _beginJumpFromGround(jumpFade = 0.12) {
    this.isJumping = true;
    this.jumpElapsed = 0;
    this.fastFallBoost = false;
    this._restoreLandActionLoop();
    this.groundY = this._getGroundY();
    this.velocityY = this.config.jump.velocity;
    this._setAction("jump", jumpFade);
  }

  /** W while sliding: end roll immediately, brief run, then jump (mirrors snappy jump→S) */
  _interruptRollForJump() {
    if (!this.group || !this.isRolling) return;
    const chain = this.config.roll?.interruptToJumpChain ?? 0.055;
    this.isRolling = false;
    this.rollTimer = 0;
    this.currentHeight = this.baseHeight;
    const groundY = this._getGroundY();
    this.positionY = groundY;
    this.group.position.y = this.positionY;
    this._setAction("run", chain);
    this.jumpChainFromRollRemaining = chain;
  }

  roll() {
    if (!this.group || this.isRolling) return;
    if (this.isJumping) {
      const minAirTime = this.config.roll?.minJumpTimeBeforeSlide ?? 0.14;
      if (this.jumpElapsed < minAirTime && this.velocityY > 0) return;
      this.pendingRollAfterLanding = true;
      this._startFastFallFromJump();
      return;
    }
    this._beginGroundRoll();
  }

  _beginGroundRoll() {
    this.isRolling = true;
    const rollAction = this.actions.roll;
    this.rollTimer = rollAction
      ? rollAction.getClip().duration
      : this.config.roll.duration;
    this.currentHeight = this.baseHeight * this.config.roll.heightScale;
    this._setAction("roll");
  }

  /** Roll animation finished or timer ended */
  _endGroundRoll() {
    if (!this.isRolling) return;
    this.isRolling = false;
    this.currentHeight = this.baseHeight;
    const groundY = this._getGroundY();
    this.positionY = groundY;
    this.group.position.y = this.positionY;
    this._setAction("run", 0.08);
  }

  _restoreLandActionLoop() {
    const land = this.actions.land;
    if (!land) return;
    land.setLoop(THREE.LoopOnce, 1);
    land.clampWhenFinished = true;
  }

  /** Fast smooth slam: fall anim + high gravity until ground (no position snap) */
  _startFastFallFromJump() {
    if (!this.group || !this.isJumping || this.fastFallBoost) return;
    this.fastFallBoost = true;
    const boost = this.config.jump.fastFallVelocityBoost ?? -9;
    const minDown = this.config.jump.fastFallMinDownVelocity ?? -6;
    this.velocityY = Math.min(this.velocityY + boost, minDown);
    const land = this.actions.land;
    if (land) {
      land.setLoop(THREE.LoopRepeat, Infinity);
      land.clampWhenFinished = false;
      this._setAction("land", 0.12);
    }
  }

  _finishJumpLanding() {
    this.fastFallBoost = false;
    this._restoreLandActionLoop();
    this.isJumping = false;
    this.velocityY = 0;
    if (this.pendingRollAfterLanding) {
      this.pendingRollAfterLanding = false;
      this._beginGroundRoll();
      return;
    }
    this.currentHeight = this.baseHeight;
    this._setAction("run", 0.1);
  }

  update(deltaTime, frameId = 0) {
    if (!this.group) return;

    this._updateRotateToGameplay(deltaTime);

    if (!this.isActive) {
      if (!this.isJumping && !this.isRolling) {
        const groundY = this._getGroundY();
        this.positionY = groundY;
        const idleDy = this.config.idle?.standingYOffset ?? 0;
        const idleDx = this.config.idle?.standingXOffset ?? 0;
        this.group.position.y = groundY + idleDy;
        if (this.lanePositions.length) {
          const laneX = this.lanePositions[this.targetLane] ?? 0;
          this.group.position.x = laneX + idleDx;
        }
      }
      if (this.mixer) this.mixer.update(deltaTime);
      return;
    }

    this._updateSpeed(deltaTime);
    this._updateLane(deltaTime);
    this._updateVertical(deltaTime, frameId);
    this._updateJumpChainFromRoll(deltaTime);
    if (this.mixer) this.mixer.update(deltaTime);
  }

  _updateJumpChainFromRoll(deltaTime) {
    if (this.jumpChainFromRollRemaining == null) return;
    if (!this.isActive || this.isJumping) {
      this.jumpChainFromRollRemaining = null;
      return;
    }
    this.jumpChainFromRollRemaining -= deltaTime;
    if (this.jumpChainFromRollRemaining > 0) return;
    this.jumpChainFromRollRemaining = null;
    const jumpFade = this.config.roll?.interruptJumpFade ?? 0.09;
    this.pendingRollAfterLanding = false;
    this._beginJumpFromGround(jumpFade);
  }

  _updateSpeed(deltaTime) {
    if (!this.isActive) return;
    if (this.currentSpeed >= this.config.speed.max) return;
    this.currentSpeed = clamp(
      this.currentSpeed + this.config.speed.acceleration * deltaTime,
      this.config.speed.initial,
      this.config.speed.max,
    );
  }

  _updateLane(deltaTime) {
    if (!this.lanePositions.length) return;
    const targetX = this.lanePositions[this.targetLane];
    const currentX = this.group.position.x + 0.03;
    this.group.position.x = THREE.MathUtils.lerp(
      currentX,
      targetX,
      this.config.laneLerpSpeed,
    );
  }

  _stabilizeGroundY(candidate) {
    if (candidate == null) return this.groundY || this.positionY;
    const deadband = this._groundDeadband();
    const reference = this.groundY || this.positionY;
    if (Math.abs(candidate - reference) < deadband) return reference;
    return candidate;
  }

  _sampleGroundY(frameId) {
    if (this._groundSampleFrame === frameId && this._groundSampleY != null) {
      return this._groundSampleY;
    }
    this._groundSampleFrame = frameId;
    this._groundSampleY = this._getGroundY();
    return this._groundSampleY;
  }

  /** Same vertical settle as when running on flat ground — keeps menu/idle Y aligned with gameplay. */
  _syncGroundHeightWhileGrounded(frameId) {
    const groundY = this._sampleGroundY(frameId);
    const delta = Math.abs(this.positionY - groundY);
    const deadband = this._groundDeadband();
    if (delta < deadband * 0.35) return;
    const lerp = this._groundLerp();
    this.positionY = THREE.MathUtils.lerp(this.positionY, groundY, lerp);
    if (delta < 0.01) this.positionY = groundY;
  }

  _updateVertical(deltaTime, frameId = 0) {
    const groundY = this._sampleGroundY(frameId);

    if (this.isJumping) {
      this.jumpElapsed += deltaTime;
      const gravMult = this.fastFallBoost
        ? (this.config.jump.fastFallGravityMultiplier ?? 3)
        : 1;
      this.velocityY += this.config.jump.gravity * gravMult * deltaTime;
      this.positionY += this.velocityY * deltaTime;
      if (this.velocityY <= 0 && this.positionY <= groundY) {
        this.positionY = groundY;
        this._finishJumpLanding();
      }
    } else {
      this._syncGroundHeightWhileGrounded(frameId);
    }

    if (this.isRolling) {
      this.rollTimer -= deltaTime;
      const blendAhead = this.config.roll.blendAhead ?? 0.12;
      if (
        this.rollTimer <= blendAhead &&
        this.currentAction === this.actions.roll
      ) {
        this._setAction("run", 0.08);
      }
      if (this.rollTimer <= 0) {
        this._endGroundRoll();
      }
    }

    this.group.position.y = this.positionY;
  }

  _getGroundY() {
    if (!this.roadMeshes.length) return this.groundY || this.currentHeight;

    this.tmpOrigin.set(
      this._groundProbeX(),
      this.config.collision.castDistance,
      this.group.position.z,
    );
    this.raycaster.set(this.tmpOrigin, this.rayDirection);
    this.raycastHits.length = 0;
    this.raycaster.intersectObjects(this.roadMeshes, false, this.raycastHits);
    const referenceGroundY = this.groundY || this.positionY || this.currentHeight;
    const minGroundY = referenceGroundY - this.config.collision.maxGroundDrop;
    const maxGroundY = referenceGroundY + this.config.collision.maxGroundStepUp;
    const minWalkableNormalY = 0.45;

    let bestGroundY = null;
    let bestGroundDelta = Infinity;

    for (const hit of this.raycastHits) {
      if (hit.face) {
        this.tmpNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
        this.tmpFaceNormal.copy(hit.face.normal).applyMatrix3(this.tmpNormalMatrix).normalize();
        if (this.tmpFaceNormal.y < minWalkableNormalY) continue;
      }

      const candidateGroundY = hit.point.y + this.currentHeight;
      if (candidateGroundY < minGroundY || candidateGroundY > maxGroundY) {
        continue;
      }
      const delta = Math.abs(candidateGroundY - referenceGroundY);
      if (delta < bestGroundDelta) {
        bestGroundDelta = delta;
        bestGroundY = candidateGroundY;
      }
    }

    const playerHalfX = this.currentHeight * 0.45;
    const playerHalfZ = this.currentHeight * 0.62;
    const surfaceUnderFeet = this.positionY - this.currentHeight;

    for (const platform of this.platformSurfaces) {
      const overlapX =
        platform.halfX == null ||
        Math.abs(this.group.position.x - platform.x) <= platform.halfX + playerHalfX;
      const overlapZ =
        platform.halfZ == null ||
        Math.abs(this.group.position.z - platform.z) <= platform.halfZ + playerHalfZ;
      if (!overlapX || !overlapZ) continue;

      const onHood = surfaceUnderFeet >= platform.topY - 0.24;
      const landingOnHood =
        this.isJumping &&
        this.velocityY <= 0 &&
        surfaceUnderFeet >= platform.topY - 0.3;
      if (!onHood && !landingOnHood) continue;

      const platformGroundY = platform.topY + this.currentHeight;
      if (platformGroundY < minGroundY || platformGroundY > maxGroundY) continue;

      if (bestGroundY == null || platformGroundY > bestGroundY) {
        bestGroundY = platformGroundY;
      }
    }

    if (bestGroundY != null) {
      this.groundY = this._stabilizeGroundY(bestGroundY);
      return this.groundY;
    }

    return this.groundY || this.currentHeight;
  }
  snapToGround() {
    if (!this.group) return;

    this.fastFallBoost = false;
    this.pendingRollAfterLanding = false;
    this.jumpChainFromRollRemaining = null;
    this._restoreLandActionLoop();
    const groundY = this._getGroundY();
    this.groundY = groundY;
    this.positionY = groundY;
    this.velocityY = 0;
    this.isJumping = false;
    this.group.position.y = groundY;
  }
  getCurrentSpeed() {
    return this.currentSpeed;
  }

  getPosition() {
    return this.group ? this.group.position : new THREE.Vector3();
  }

  getCurrentLaneIndex() {
    return this.targetLane;
  }

  setVisible(isVisible) {
    if (!this.group) return;
    this.group.visible = Boolean(isVisible);
  }

  getCollisionData() {
    if (!this.group) {
      return {
        position: new THREE.Vector3(),
        radius: 0.6,
        laneIndex: this.targetLane,
        velocityY: 0,
        isJumping: false,
        currentHeight: this.currentHeight,
      };
    }

    const radius = Math.max(0.45, this.currentHeight * 0.62);
    return {
      position: this.group.position,
      radius,
      laneIndex: this.targetLane,
      velocityY: this.velocityY,
      isJumping: this.isJumping,
      currentHeight: this.currentHeight,
    };
  }
}
