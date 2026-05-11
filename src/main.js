import './style.css'
import { Game } from './game/Game.js'

const app = document.querySelector('#app')
if (!app) throw new Error('Missing #app element')

const overlay = document.querySelector('#loading-overlay')
const progressBar = document.querySelector('#loading-progress-bar')
const progressText = document.querySelector('#loading-progress-text')
const startButton = document.querySelector('#start-game-button')

if (!overlay || !progressBar || !progressText || !startButton) {
  throw new Error('Missing loading overlay UI')
}

const game = new Game(app)

function updateProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, progress))
  const percent = Math.round(safeProgress * 100)
  progressBar.style.width = `${percent}%`
  progressText.textContent = `${percent}%`
}

startButton.addEventListener('click', () => {
  game.startGame()
  overlay.classList.add('overlay--hidden')
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
