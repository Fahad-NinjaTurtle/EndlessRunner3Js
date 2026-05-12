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

  return { ambient, hemi, keyLight, rimLight }
}

