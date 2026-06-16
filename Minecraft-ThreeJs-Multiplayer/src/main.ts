import Core from './core'
import Control from './control'
import Player from './player'
import PlayerAvatar from './player/PlayerAvatar'
import Terrain from './terrain'
import UI from './ui'
import Audio from './audio'
import { NetworkManager } from './network/NetworkManager'

import './style.css'

// ========== SETTING SERVER ==========
// change your IP in cmd 'ipconfig'
// For example: 'ws://192.168.1.5:3000'
const SERVER_URL = `wss://minecraft-multiplayer-dozfire.onrender.com`

const networkManager = new NetworkManager(SERVER_URL)
let worldSeed = 12345
let localNickname = ''

let terrain: Terrain
let control: Control
let ui: UI
let audio: Audio
let animationId: number



const core = new Core()
const camera = core.camera
const scene = core.scene
const renderer = core.renderer

const player = new Player()
audio = new Audio(camera)

terrain = new Terrain(scene, camera, networkManager)
control = new Control(scene, camera, player, terrain, audio)

const localPlayerAvatar = new PlayerAvatar(scene, {
    isLocal: true,
    eyeHeight: player.body.eyeHeight
})
const otherPlayerAvatars = new Map<string, PlayerAvatar>()

function setLocalNickname(nickname: string) {
    localNickname = nickname.trim().slice(0, 16)
    localPlayerAvatar.setNickname(localNickname)
    if (networkManager.isConnected()) {
        networkManager.setNickname(localNickname)
    }
}

ui = new UI(terrain, control, networkManager, setLocalNickname)

networkManager.connect().catch(error => {
    console.error('❌ Не удалось подключиться к серверу:', error)
})

function updateLocalPlayerAvatar() {
    localPlayerAvatar.setViewMode(control.getViewMode())
    localPlayerAvatar.setNickname(localNickname)
    localPlayerAvatar.setTransform(
        { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        control.getAvatarYaw(),
        control.isMoving(),
        { yaw: camera.rotation.y, pitch: camera.rotation.x }
    )
}

function updateOtherPlayers() {
    const players = networkManager.getOtherPlayers()
    
    players.forEach((data, playerId) => {
        let avatar = otherPlayerAvatars.get(playerId)
        
        if (!avatar) {
            avatar = new PlayerAvatar(scene, {
                eyeHeight: player.body.eyeHeight
            })
            otherPlayerAvatars.set(playerId, avatar)
            console.log(`🎮 Создан визуал для игрока ${playerId}`)
        }
        
        if (data.position) {
            avatar.setNickname(data.nickname ?? playerId)
            avatar.setTransform(
                data.position,
                data.avatarYaw ?? data.rotation.yaw + Math.PI,
                data.isMoving ?? false,
                data.rotation
            )
        }
    })
    
    otherPlayerAvatars.forEach((avatar, playerId) => {
        if (!players.has(playerId)) {
            avatar.dispose()
            otherPlayerAvatars.delete(playerId)
            console.log(`🗑️ Удалён визуал игрока ${playerId}`)
        }
    })
}

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

    const storedNickname = localStorage.getItem('nickname') || ''
    if (storedNickname) {
        setLocalNickname(storedNickname)
        networkManager.setNickname(storedNickname)
    } else if (typeof data.nickname === 'string') {
        setLocalNickname(data.nickname)
    } else if (typeof data.playerId === 'string') {
        setLocalNickname(data.playerId)
    }
})

networkManager.on('playerLeft', (data: any) => {
    console.log(`➖ Игрок ${data.id} покинул сервер`)
})

let lastSendTime = 0
const SEND_INTERVAL = 50

function animate() {
    animationId = requestAnimationFrame(animate)

    control.update()
    terrain.update()
    ui.update()
    updateLocalPlayerAvatar()

    const now = performance.now()
    if (networkManager.isConnected() && now - lastSendTime > SEND_INTERVAL) {
        lastSendTime = now
        const pos = camera.position
        const rot = camera.rotation
        networkManager.sendPosition(
            { x: pos.x, y: pos.y, z: pos.z },
            { yaw: rot.y, pitch: rot.x },
            { isMoving: control.isMoving(), avatarYaw: control.getAvatarYaw() }
        )
    }

    updateOtherPlayers()

    control.prepareCameraForRender()
    renderer.render(scene, camera)
    control.restoreCameraAfterRender()
}

animate()

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

    localPlayerAvatar.dispose()

    otherPlayerAvatars.forEach((avatar) => {
        avatar.dispose()
    })
    otherPlayerAvatars.clear()

    if (audio && audio.dispose) {
        audio.dispose()
    }
    
    console.log('✅ Ресурсы очищены')
})

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
