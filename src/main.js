import './style.css'
import { Game } from './game/Game.js'

const app = document.querySelector('#app')
if (!app) throw new Error('Missing #app element')

const overlay = document.querySelector('#loading-overlay')
const loadingAssetsPanel = document.querySelector('#loading-assets-panel')
const progressBar = document.querySelector('#loading-progress-bar')
const progressText = document.querySelector('#loading-progress-text')
const tapToPlayLayer = document.querySelector('#tap-to-play-layer')
const hud = document.querySelector('#hud')
const coinCount = document.querySelector('#coin-count')
const distanceScore = document.querySelector('#distance-score')
const pauseButton = document.querySelector('#pause-toggle-button')
const pauseToggleLabel = document.querySelector('#pause-toggle-label')
const muteButton = document.querySelector('#mute-toggle-button')
const muteToggleLabel = document.querySelector('#mute-toggle-label')
const pausedBanner = document.querySelector('#paused-banner')
const resumeCountdownOverlay = document.querySelector('#resume-countdown-overlay')
const resumeCountdownText = document.querySelector('#resume-countdown-text')
const gameOverOverlay = document.querySelector('#game-over-overlay')
const finalCoinCount = document.querySelector('#final-coin-count')
const finalDistanceScore = document.querySelector('#final-distance-score')
const restartButton = document.querySelector('#restart-game-button')

if (
  !overlay ||
  !loadingAssetsPanel ||
  !progressBar ||
  !progressText ||
  !tapToPlayLayer ||
  !hud ||
  !coinCount ||
  !distanceScore ||
  !pauseButton ||
  !pauseToggleLabel ||
  !muteButton ||
  !muteToggleLabel ||
  !pausedBanner ||
  !resumeCountdownOverlay ||
  !resumeCountdownText ||
  !gameOverOverlay ||
  !finalCoinCount ||
  !finalDistanceScore ||
  !restartButton
) {
  throw new Error('Missing game UI elements')
}

function formatDistanceLabel(meters) {
  return Math.round(Number(meters) || 0).toLocaleString()
}

const game = new Game(app)

function syncPauseButton() {
  const state = game.getPauseButtonState()
  pauseButton.disabled = !state.enabled
  pauseToggleLabel.textContent = state.label
}

function syncMuteButton(muted) {
  muteToggleLabel.textContent = muted ? 'Unmute' : 'Mute'
  muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false')
}

function setPausedBannerVisible(visible) {
  pausedBanner.classList.toggle('paused-banner--hidden', !visible)
}

game.setUIHandlers({
  onCoinChange: (value) => {
    coinCount.textContent = String(value)
  },
  onDistanceChange: (meters) => {
    distanceScore.textContent = formatDistanceLabel(meters)
  },
  onResumeCountdown: (value) => {
    if (value == null) {
      resumeCountdownOverlay.classList.add('countdown-overlay--hidden')
      resumeCountdownOverlay.setAttribute('aria-hidden', 'true')
      return
    }
    resumeCountdownOverlay.classList.remove('countdown-overlay--hidden')
    resumeCountdownOverlay.setAttribute('aria-hidden', 'false')
    resumeCountdownText.textContent = String(value)
  },
  onPauseStateChange: ({ paused, countdown }) => {
    syncPauseButton()
    setPausedBannerVisible(Boolean(paused && !countdown))
  },
  onMuteChange: (muted) => {
    syncMuteButton(muted)
  },
  onGameOver: ({ coins, distance }) => {
    finalCoinCount.textContent = String(coins)
    finalDistanceScore.textContent = formatDistanceLabel(distance ?? 0)
    gameOverOverlay.classList.remove('overlay--hidden')
    hud.classList.add('hud--hidden')
    setPausedBannerVisible(false)
  },
})

syncMuteButton(game.isMuted())
syncPauseButton()

pauseButton.addEventListener('click', () => {
  game.togglePause()
  syncPauseButton()
})

muteButton.addEventListener('click', () => {
  game.toggleMute()
})

function updateProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, progress))
  const percent = Math.round(safeProgress * 100)
  progressBar.style.width = `${percent}%`
  progressText.textContent = `${percent}%`
}

function beginPlayFromTap() {
  coinCount.textContent = '0'
  distanceScore.textContent = '0'
  game.startGame()
  overlay.classList.add('overlay--hidden')
  overlay.classList.remove('overlay--tap-mode')
  tapToPlayLayer.classList.add('tap-to-play-layer--hidden')
  gameOverOverlay.classList.add('overlay--hidden')
  hud.classList.remove('hud--hidden')
  syncPauseButton()
  setPausedBannerVisible(false)
}

tapToPlayLayer.addEventListener('click', beginPlayFromTap)

restartButton.addEventListener('click', () => {
  window.location.reload()
})

game
  .load(({ progress }) => {
    updateProgress(progress)
  })
  .then(() => {
    updateProgress(1)
    loadingAssetsPanel.classList.add('overlay__panel--hidden')
    overlay.classList.add('overlay--tap-mode')
    tapToPlayLayer.classList.remove('tap-to-play-layer--hidden')
  })
  .catch((error) => {
    console.error('Failed to start game:', error)
    progressText.textContent = 'Failed to load assets'
  })
