import * as THREE from 'three'
import { LIGHTS_CONFIG } from '../../config/lightsConfig.js'

/**
 * Adds a 4-point lighting setup (Ambient + Hemisphere + Key + Rim)
 * matching the approach used in your downloaded `main 1.js`.
 */
export function addRunnerLights(scene, config = LIGHTS_CONFIG) {
  const ambient = new THREE.AmbientLight(config.ambient.color, config.ambient.intensity)
  scene.add(ambient)

  const hemi = new THREE.HemisphereLight(
    config.hemisphere.skyColor,
    config.hemisphere.groundColor,
    config.hemisphere.intensity
  )
  scene.add(hemi)

  const keyLight = new THREE.DirectionalLight(config.keyLight.color, config.keyLight.intensity)
  keyLight.position.set(...config.keyLight.position)
  keyLight.target.position.set(...config.keyLight.target)
  scene.add(keyLight)
  scene.add(keyLight.target)

  const rimLight = new THREE.DirectionalLight(config.rimLight.color, config.rimLight.intensity)
  rimLight.position.set(...config.rimLight.position)
  rimLight.target.position.set(...config.rimLight.target)
  scene.add(rimLight)
  scene.add(rimLight.target)

  let forwardFill = null
  if (config.forwardFill) {
    forwardFill = new THREE.DirectionalLight(config.forwardFill.color, config.forwardFill.intensity)
    forwardFill.position.set(0, 14, 8)
    forwardFill.target.position.set(0, 0, 0)
    scene.add(forwardFill)
    scene.add(forwardFill.target)
  }

  return { ambient, hemi, keyLight, rimLight, forwardFill }
}

/**
 * Keeps directional lights aimed at the play area (not world origin).
 * Prevents a dark “stripe” / incorrect shading on the road & player as they move along Z.
 */
export function updateRunnerLights(lights, playerPosition) {
  if (!lights || !playerPosition) return
  const { x, y, z } = playerPosition

  lights.keyLight.target.position.set(x, y, z)
  lights.rimLight.target.position.set(x, y, z)

  if (lights.forwardFill) {
    // Behind-toward-camera side (+Z world): fills normals that face the camera
    lights.forwardFill.position.set(x + 1.2, y + 14, z + 12)
    lights.forwardFill.target.position.set(x, y + 0.35, z - 5)
    lights.forwardFill.target.updateMatrixWorld()
  }

  lights.keyLight.target.updateMatrixWorld()
  lights.rimLight.target.updateMatrixWorld()
}

