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
// change your IP in cmd 'ipconfig'
// For example: 'ws://192.168.1.5:3000'
const SERVER_URL = 'ws://192.168.1.3:3000'


const networkManager = new NetworkManager(SERVER_URL)

networkManager.connect()
  .then(() => console.log('🌐 Сетевая игра активна'))
  .catch((error) => console.warn('⚠️ Сервер недоступен, играем офлайн:', error.message))


const core = new Core()
const camera = core.camera
const scene = core.scene
const renderer = core.renderer

const player = new Player()
const audio = new Audio(camera)

const terrain = new Terrain(scene, camera)
const control = new Control(scene, camera, player, terrain, audio)

const ui = new UI(terrain, control)


const otherPlayerMeshes = new Map<string, THREE.Mesh>()

function createPlayerMesh(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(0.6, 1.8, 0.6)
    const material = new THREE.MeshLambertMaterial({ color: 0xff0000 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = 0.9
    return mesh
}

function updateOtherPlayers() {
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
            otherPlayerMeshes.delete(playerId)
            console.log(`🗑️ Удалён визуал игрока ${playerId}`)
        }
    })
}

networkManager.on('playerJoined', (data: any) => {
    console.log(`➕ Игрок ${data.id} присоединился`)
})

networkManager.on('playerLeft', (data: any) => {
    console.log(`➖ Игрок ${data.id} покинул сервер`)
})


let lastSendTime = 0
const SEND_INTERVAL = 50

;(function animate() {
    requestAnimationFrame(animate)

    control.update()
    terrain.update()
    ui.update()

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
})()