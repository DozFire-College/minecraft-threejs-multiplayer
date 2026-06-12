// main.ts
import * as THREE from 'three'
import Core from './core'
import Control from './control'
import Player from './player'
import Terrain from './terrain'
import UI from './ui'
import Audio from './audio'
import { NetworkManager } from './network/NetworkManager'

import './style.css'

// ========== SETTING SERVER ==========
const SERVER_URL = 'ws://192.168.1.3:3000'

const networkManager = new NetworkManager(SERVER_URL)
let worldSeed = 12345

// Переменные для очистки ресурсов
let terrain: Terrain
let control: Control
let ui: UI
let audio: Audio
let animationId: number


networkManager.connect()
  .then(() => {
    console.log('🌐 Сетевая игра активна')
    
    // После успешного подключения создаём terrain
    terrain = new Terrain(scene, camera, networkManager)
    control = new Control(scene, camera, player, terrain, audio)
    ui = new UI(terrain, control)
    
    console.log('✅ Террейн инициализирован с серверными данными')
  })
  .catch((error) => {
    console.warn('⚠️ Сервер недоступен, игра не может работать без сервера:', error.message)
    
    // Показываем сообщение пользователю
    const errorDiv = document.createElement('div')
    errorDiv.style.position = 'fixed'
    errorDiv.style.top = '50%'
    errorDiv.style.left = '50%'
    errorDiv.style.transform = 'translate(-50%, -50%)'
    errorDiv.style.backgroundColor = 'rgba(0,0,0,0.9)'
    errorDiv.style.color = 'red'
    errorDiv.style.padding = '20px'
    errorDiv.style.borderRadius = '10px'
    errorDiv.style.fontFamily = 'monospace'
    errorDiv.style.fontSize = '18px'
    errorDiv.style.textAlign = 'center'
    errorDiv.style.zIndex = '1000'
    errorDiv.innerHTML = `
      <h2>❌ Ошибка подключения к серверу</h2>
      <p>${error.message}</p>
      <p>Проверьте что сервер запущен и IP адрес правильный</p>
      <button onclick="location.reload()">Перезагрузить</button>
    `
    document.body.appendChild(errorDiv)
  })

const core = new Core()
const camera = core.camera
const scene = core.scene
const renderer = core.renderer

const player = new Player()
audio = new Audio(camera)

// ⚠️ ВАЖНО: terrain, control, ui создаются ТОЛЬКО после подключения к серверу
// Поэтому animate должна ждать их инициализации

let isGameReady = false

function createPlayerMesh(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(0.6, 1.8, 0.6)
    const material = new THREE.MeshLambertMaterial({ color: 0xff0000 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = 0.9
    return mesh
}

const otherPlayerMeshes = new Map<string, THREE.Mesh>()

function updateOtherPlayers() {
    if (!networkManager.isConnected()) return
    
    const players = networkManager.getOtherPlayers()
    
    players.forEach((data, playerId) => {
        let mesh = otherPlayerMeshes.get(playerId)
        
        if (!mesh) {
            mesh = createPlayerMesh()
            scene.add(mesh)
            otherPlayerMeshes.set(playerId, mesh)
            console.log(`🎮 Создан визуал для игрока ${playerId}`)
        }
        
        if (data.position) {
            mesh.position.set(data.position.x, data.position.y - 1, data.position.z)
        }
    })
    
    otherPlayerMeshes.forEach((mesh, playerId) => {
        if (!players.has(playerId)) {
            scene.remove(mesh)
            mesh.geometry.dispose()
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose())
            } else {
                mesh.material.dispose()
            }
            otherPlayerMeshes.delete(playerId)
        }
    })
}

// Обработчики сетевых событий
networkManager.on('playerJoined', (data: any) => {
    console.log(`➕ Игрок ${data.id} присоединился`)
})

networkManager.on('worldSeed', (data: { seed: number }) => {
    console.log(`🌍 Получен seed мира от сервера: ${data.seed}`)
    worldSeed = data.seed
})

networkManager.on('welcome', (data: any) => {
    console.log(`👋 Добро пожаловать! Ваш ID: ${data.playerId}`)
    if (data.worldSeed) {
        worldSeed = data.worldSeed
        console.log(`🌍 Seed мира: ${worldSeed}`)
    }
    if (data.spawnPosition) {
        camera.position.set(data.spawnPosition.x, data.spawnPosition.y, data.spawnPosition.z)
    }
})

networkManager.on('playerLeft', (data: any) => {
    console.log(`➖ Игрок ${data.id} покинул сервер`)
})

let lastSendTime = 0
const SEND_INTERVAL = 50

function animate() {
    animationId = requestAnimationFrame(animate)

    // ⬇️⬇️⬇️ Обновляем только если игра готова ⬇️⬇️⬇️
    if (isGameReady && terrain && control) {
        control.update()
        terrain.update()
        ui.update()
    }

    const now = performance.now()
    if (networkManager.isConnected() && now - lastSendTime > SEND_INTERVAL) {
        lastSendTime = now
        const pos = camera.position
        const rot = camera.rotation
        networkManager.sendPosition(
            { x: pos.x, y: pos.y, z: pos.z },
            { yaw: rot.y, pitch: rot.x }
        )
    }

    updateOtherPlayers()
    renderer.render(scene, camera)
}

// Запускаем анимацию
animate()

// ⬇️⬇️⬇️ Ждём готовности terrain и остальных компонентов ⬇️⬇️⬇️
// Проверяем каждые 100мс не инициализировался ли terrain
const waitForGameReady = setInterval(() => {
    if (terrain && control && ui) {
        isGameReady = true
        clearInterval(waitForGameReady)
        console.log('🎮 Игра полностью готова!')
        
        // Запускаем генерацию мира после готовности
        terrain.generate()
    }
}, 100)

// Очистка ресурсов при закрытии страницы
window.addEventListener('beforeunload', () => {
    console.log('🧹 Очистка ресурсов...')
    
    if (animationId) {
        cancelAnimationFrame(animationId)
    }
    
    if (terrain && terrain.dispose) {
        terrain.dispose()
    }
    
    if (networkManager) {
        networkManager.disconnect()
    }
    
    otherPlayerMeshes.forEach((mesh) => {
        scene.remove(mesh)
        mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose())
        } else {
            mesh.material.dispose()
        }
    })
    otherPlayerMeshes.clear()
    
    if (audio && audio.dispose) {
        audio.dispose()
    }
    
    clearInterval(waitForGameReady)
    console.log('✅ Ресурсы очищены')
})

// Обработка ошибок
window.addEventListener('error', (event) => {
    console.error('❌ Глобальная ошибка:', event.error)
})

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (document.fullscreenElement) {
            document.exitFullscreen()
        }
    }
})