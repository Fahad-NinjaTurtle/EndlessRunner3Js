import './style.css'
import { Game } from './game/Game.js'

const app = document.querySelector('#app')
if (!app) throw new Error('Missing #app element')

const overlay = document.querySelector('#loading-overlay')
const progressBar = document.querySelector('#loading-progress-bar')
const progressText = document.querySelector('#loading-progress-text')
const startButton = document.querySelector('#start-game-button')
const hud = document.querySelector('#hud')
const coinCount = document.querySelector('#coin-count')
const gameOverOverlay = document.querySelector('#game-over-overlay')
const finalCoinCount = document.querySelector('#final-coin-count')
const restartButton = document.querySelector('#restart-game-button')

if (
  !overlay ||
  !progressBar ||
  !progressText ||
  !startButton ||
  !hud ||
  !coinCount ||
  !gameOverOverlay ||
  !finalCoinCount ||
  !restartButton
) {
  throw new Error('Missing loading overlay UI')
}

const game = new Game(app)
game.setUIHandlers({
  onCoinChange: (value) => {
    coinCount.textContent = String(value)
  },
  onGameOver: ({ coins }) => {
    finalCoinCount.textContent = String(coins)
    gameOverOverlay.classList.remove('overlay--hidden')
    hud.classList.add('hud--hidden')
  },
})

function updateProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, progress))
  const percent = Math.round(safeProgress * 100)
  progressBar.style.width = `${percent}%`
  progressText.textContent = `${percent}%`
}

startButton.addEventListener('click', () => {
  coinCount.textContent = '0'
  game.startGame()
  overlay.classList.add('overlay--hidden')
  gameOverOverlay.classList.add('overlay--hidden')
  hud.classList.remove('hud--hidden')
})

restartButton.addEventListener('click', () => {
  window.location.reload()
})

game
  .load(({ progress }) => {
    updateProgress(progress)
  })
  .then(() => {
    updateProgress(1)
    progressText.textContent = '100% - Ready to start'
    startButton.hidden = false
  })
  .catch((error) => {
    console.error('Failed to start game:', error)
    progressText.textContent = 'Failed to load assets'
  })
