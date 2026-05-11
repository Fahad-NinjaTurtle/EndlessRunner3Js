import * as THREE from 'three'

export function addSkyDome(scene, options = {}) {
  const {
    radius = 380,
    topColor = 0x6fb7ff,
    horizonColor = 0xbfe5ff,
    bottomColor = 0xf1f6ff,
  } = options

  const geometry = new THREE.SphereGeometry(radius, 20, 14)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(topColor) },
      horizonColor: { value: new THREE.Color(horizonColor) },
      bottomColor: { value: new THREE.Color(bottomColor) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;

      void main() {
        float h = normalize(vWorldPos).y;
        float topMix = smoothstep(0.0, 0.9, h);
        float bottomMix = smoothstep(-0.9, 0.05, h);
        vec3 mid = mix(bottomColor, horizonColor, bottomMix);
        vec3 col = mix(mid, topColor, topMix);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })

  const dome = new THREE.Mesh(geometry, material)
  dome.name = 'SkyDome'
  scene.add(dome)
  return dome
}
