/** Coarse / touch-first devices — parallel GLTF loads often stall near the end on mobile Safari. */
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  if (navigator.userAgentData?.mobile) return true
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    return true
  }
  return false
}

export function loadGltfWithTimeout(loader, url, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`Timed out loading "${url}" after ${timeoutMs}ms`))
    }, timeoutMs)

    loader.load(
      url,
      (gltf) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(gltf)
      },
      undefined,
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error ?? new Error(`Failed to load "${url}"`))
      },
    )
  })
}

/** Load one URL at a time — avoids mobile connection / memory stalls at ~98%. */
export async function loadAllGltf(loader, urls, { sequential = false, timeoutMs = 45000 } = {}) {
  const uniqueUrls = [...new Set(urls.filter(Boolean))]
  if (!sequential) {
    return Promise.all(uniqueUrls.map((url) => loadGltfWithTimeout(loader, url, timeoutMs)))
  }

  const results = []
  for (const url of uniqueUrls) {
    results.push(await loadGltfWithTimeout(loader, url, timeoutMs))
  }
  return results
}
