import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PLAYER_CONFIG } from "../config/playerConfig.js";

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
    this.isRolling = false;
    this.rollTimer = 0;
    this.raycaster = new THREE.Raycaster();
    this.rayDirection = new THREE.Vector3(0, -1, 0);
    this.tmpOrigin = new THREE.Vector3();
    this.raycastHits = [];
    this.tmpNormalMatrix = new THREE.Matrix3();
    this.tmpFaceNormal = new THREE.Vector3();
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

    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      this.mixer.addEventListener("finished", (event) =>
        this._onActionFinished(event),
      );
      this._createActions(gltf.animations);
      this._setAction("idle");
    }
  }

  async _loadModel(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
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
      this.isRolling = false;
      this.currentHeight = this.baseHeight;
      const groundY = this._getGroundY();
      this.positionY = groundY;
      this.group.position.y = this.positionY;
      this._setAction("run", 0.08);
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
    if (!this.group || this.isJumping || this.isRolling) return;
    this.isJumping = true;
    this.groundY = this._getGroundY();
    this.velocityY = this.config.jump.velocity;
    this._setAction("jump");
  }

  roll() {
    if (!this.group || this.isJumping || this.isRolling) return;
    this.isRolling = true;
    const rollAction = this.actions.roll;
    this.rollTimer = rollAction
      ? rollAction.getClip().duration
      : this.config.roll.duration;
    this.currentHeight = this.baseHeight * this.config.roll.heightScale;
    this._setAction("roll");
  }

  update(deltaTime) {
    if (!this.group) return;
    if (!this.isActive) {
      if (this.mixer) this.mixer.update(deltaTime);
      return;
    }

    this._updateSpeed(deltaTime);
    this._updateLane(deltaTime);
    this._updateVertical(deltaTime);
    if (this.mixer) this.mixer.update(deltaTime);
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
    const currentX = this.group.position.x;
    this.group.position.x = THREE.MathUtils.lerp(
      currentX,
      targetX,
      this.config.laneLerpSpeed,
    );
  }

  _updateVertical(deltaTime) {
    const groundY = this._getGroundY();

    if (this.isJumping) {
      this.velocityY += this.config.jump.gravity * deltaTime;
      this.positionY += this.velocityY * deltaTime;
      if (this.positionY <= groundY) {
        this.positionY = groundY;
        this.velocityY = 0;
        this.isJumping = false;
        this.currentHeight = this.baseHeight;
        this._setAction("run", 0.08);
      }
    } else {
      this.positionY = THREE.MathUtils.lerp(this.positionY, groundY, 0.35);
      if (Math.abs(this.positionY - groundY) < 0.01) this.positionY = groundY;
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
        this.isRolling = false;
        this.currentHeight = this.baseHeight;
        this.positionY = groundY;
        this._setAction("run", 0.08);
      }
    }

    this.group.position.y = this.positionY;
  }

  _getGroundY() {
    if (!this.roadMeshes.length) return this.groundY || this.currentHeight;

    this.tmpOrigin.set(
      this.group.position.x,
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
      this.groundY = candidateGroundY;
      return this.groundY;
    }

    return this.groundY || this.currentHeight;
  }
  snapToGround() {
    if (!this.group) return;

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
      return { position: new THREE.Vector3(), radius: 0.6, laneIndex: this.targetLane };
    }

    const radius = Math.max(0.45, this.currentHeight * 0.62);
    return {
      position: this.group.position,
      radius,
      laneIndex: this.targetLane,
    };
  }
}
