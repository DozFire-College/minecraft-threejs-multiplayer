// terrain/index.ts
import * as THREE from 'three'
import Materials, { MaterialType } from './mesh/materials'
import Block from './mesh/block'
import Highlight from './highlight'
import { NetworkManager } from '../network/NetworkManager'

export enum BlockType {
  grass = 0,
  sand = 1,
  tree = 2,
  leaf = 3,
  dirt = 4,
  stone = 5,
  coal = 6,
  wood = 7,
  diamond = 8,
  quartz = 9,
  glass = 10,
  bedrock = 11
}

export default class Terrain {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  distance = 1
  chunkSize = 24

  maxCount: number
  chunk = new THREE.Vector2(0, 0)
  previousChunk = new THREE.Vector2(0, 0)

  materials = new Materials()
  materialType = [
    MaterialType.grass, MaterialType.sand, MaterialType.tree,
    MaterialType.leaf, MaterialType.dirt, MaterialType.stone,
    MaterialType.coal, MaterialType.wood, MaterialType.diamond,
    MaterialType.quartz, MaterialType.glass, MaterialType.bedrock
  ]

  blocks: THREE.InstancedMesh[] = []
  blocksCount: number[] = []
  blocksFactor = [1, 0.2, 0.1, 0.7, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]

  customBlocks: Block[] = [] // Только для коллизий
  highlight: Highlight
  private blockMap = new Map<string, Block>()
  private chunkBlocks = new Map<string, Set<string>>()
  private instanceKeysByType: Map<number, string>[] = []

  cloud = new THREE.InstancedMesh(
    new THREE.BoxGeometry(20, 5, 14),
    new THREE.MeshStandardMaterial({ transparent: true, color: 0xffffff, opacity: 0.4 }),
    1000
  )
  cloudCount = 0
  cloudGap = 5

  public networkManager: NetworkManager
  private chunksLoaded = new Set<string>()
  private requestedChunks = new Set<string>()
  
 
  private pendingChunks: { chunkX: number; chunkZ: number }[] = []
  private isProcessing = false
  
  private animationId: number | null = null
  private lastSyncTime = 0
  private syncInterval = 5000
  
  private pendingChunkData: Map<string, Map<string, number>> = new Map()
  private isProcessingChunks = false

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, networkManager: NetworkManager) {
    this.scene = scene
    this.camera = camera
    this.networkManager = networkManager
    this.maxCount = this.getMaxCount()
    this.instanceKeysByType = this.createInstanceKeyMaps()

    this.highlight = new Highlight(scene, camera, this)
    this.scene.add(this.cloud)
    this.initBlocks()
    this.updateFog()
    
    this.setupNetworkHandlers()
    this.startProcessingLoop()
    this.startOptimizedLoader()
  }

  private createInstanceKeyMaps = () =>
    Array.from({ length: this.materialType.length }, () => new Map<number, string>())

  private getMaxCount = () =>
    (this.distance * this.chunkSize * 2 + this.chunkSize) ** 2 + 500

  private getBlockKey = (x: number, y: number, z: number) => `${x}_${y}_${z}`

  private getChunkKeyFromCoords = (x: number, z: number) =>
    `${Math.floor(x / this.chunkSize)}_${Math.floor(z / this.chunkSize)}`

  private markBlockTypeDirty = (type: number) => {
    this.blocks[type].count = this.blocksCount[type]
    this.blocks[type].instanceMatrix.needsUpdate = true
  }

  public updateFog = () => {
    const far = this.distance * this.chunkSize + this.chunkSize
    this.scene.fog = new THREE.Fog(0x87ceeb, 1, far)
    this.camera.far = Math.max(96, far + this.chunkSize * 2)
    this.camera.updateProjectionMatrix()
  }

  initBlocks = () => {
    for (const block of this.blocks) {
      this.scene.remove(block)
    }
    this.blocks = []
    this.instanceKeysByType = this.createInstanceKeyMaps()

    const geometry = new THREE.BoxGeometry()
    for (let i = 0; i < this.materialType.length; i++) {
      let block = new THREE.InstancedMesh(
        geometry,
        this.materials.get(this.materialType[i]),
        this.maxCount * this.blocksFactor[i]
      )
      block.name = BlockType[i]
      block.count = 0
      this.blocks.push(block)
      this.scene.add(block)
    }
    this.blocksCount = new Array(this.materialType.length).fill(0)
  }

  resetBlocks = () => {
    for (let i = 0; i < this.blocks.length; i++) {
      const newMatrixArray = new Float32Array(this.maxCount * this.blocksFactor[i] * 16)
      this.blocks[i].instanceMatrix = new THREE.InstancedBufferAttribute(newMatrixArray, 16)
      this.blocks[i].count = 0
      this.blocks[i].instanceMatrix.needsUpdate = true
    }
    this.blocksCount = new Array(this.materialType.length).fill(0)
    this.customBlocks = []
    this.blockMap.clear()
    this.chunkBlocks.clear()
    this.requestedChunks.clear()
    this.chunksLoaded.clear()
    this.pendingChunks = []
    this.pendingChunkData.clear()
    this.instanceKeysByType = this.createInstanceKeyMaps()
  }

  private setupNetworkHandlers = () => {
    this.networkManager.on('chunkData', (data: any) => {
      this.handleChunkData(data)
    })

    this.networkManager.on('blockUpdate', (data: any) => {
      this.handleBlockUpdate(data)
    })
  }

  private startOptimizedLoader = () => {
    const loadLoop = () => {
      this.processPendingChunks()
      requestAnimationFrame(loadLoop)
    }
    requestAnimationFrame(loadLoop)
  }

  private processPendingChunks = () => {
    if (this.isProcessingChunks) return
    if (this.pendingChunkData.size === 0) return
    
    this.isProcessingChunks = true
    

    const firstChunk = this.pendingChunkData.entries().next()
    if (!firstChunk.done) {
      const [chunkKey, blocksMap] = firstChunk.value
      const [chunkX, chunkZ] = chunkKey.split('_').map(Number)
      
      this.loadChunkFromCache(chunkX, chunkZ, blocksMap)
      this.pendingChunkData.delete(chunkKey)
    }
    
    this.isProcessingChunks = false
  }
  
  private handleChunkData = (data: any) => {
    const { chunkX, chunkZ, blocks, isLastPart } = data
    const chunkKey = `${chunkX}_${chunkZ}`

    if (!this.pendingChunkData.has(chunkKey)) {
      this.pendingChunkData.set(chunkKey, new Map())
    }

    const chunkCache = this.pendingChunkData.get(chunkKey)!
    
    for (const [posKey, type] of blocks) {
      chunkCache.set(posKey, type)
    }

    if (isLastPart) {
      console.log(`✅ Чанк ${chunkKey} получен, блоков: ${chunkCache.size}`)
    }
  }

  private insertBlock = (x: number, y: number, z: number, type: BlockType) => {
    const key = this.getBlockKey(x, y, z)
    if (this.blockMap.has(key)) {
      return false
    }

    const block = new Block(x, y, z, type, true)
    block.listIndex = this.customBlocks.length
    block.instanceIndex = this.blocksCount[type]
    block.chunkKey = this.getChunkKeyFromCoords(x, z)

    this.customBlocks.push(block)
    this.blockMap.set(key, block)

    if (!this.chunkBlocks.has(block.chunkKey)) {
      this.chunkBlocks.set(block.chunkKey, new Set())
    }
    this.chunkBlocks.get(block.chunkKey)!.add(key)

    if (block.instanceIndex < this.maxCount * this.blocksFactor[type]) {
      const matrix = new THREE.Matrix4()
      matrix.setPosition(x, y, z)
      this.blocks[type].setMatrixAt(block.instanceIndex, matrix)
      this.instanceKeysByType[type].set(block.instanceIndex, key)
      this.blocksCount[type]++
      return true
    }

    this.blockMap.delete(key)
    this.chunkBlocks.get(block.chunkKey)?.delete(key)
    if (this.chunkBlocks.get(block.chunkKey)?.size === 0) {
      this.chunkBlocks.delete(block.chunkKey)
    }
    this.customBlocks.pop()
    return false
  }

  private removeBlockByKey = (key: string) => {
    const block = this.blockMap.get(key)
    if (!block) {
      return null
    }

    const type = block.type
    const mesh = this.blocks[type]
    const lastInstanceIndex = this.blocksCount[type] - 1
    const movedKey = this.instanceKeysByType[type].get(lastInstanceIndex)

    if (lastInstanceIndex >= 0 && block.instanceIndex !== lastInstanceIndex && movedKey) {
      const movedBlock = this.blockMap.get(movedKey)
      if (movedBlock) {
        const matrix = new THREE.Matrix4()
        mesh.getMatrixAt(lastInstanceIndex, matrix)
        mesh.setMatrixAt(block.instanceIndex, matrix)
        movedBlock.instanceIndex = block.instanceIndex
        this.instanceKeysByType[type].set(block.instanceIndex, movedKey)
      }
    }

    if (lastInstanceIndex >= 0) {
      this.instanceKeysByType[type].delete(lastInstanceIndex)
      this.blocksCount[type] = lastInstanceIndex
    }

    const lastBlock = this.customBlocks[this.customBlocks.length - 1]
    if (lastBlock && lastBlock.listIndex !== block.listIndex) {
      this.customBlocks[block.listIndex] = lastBlock
      lastBlock.listIndex = block.listIndex
    }
    this.customBlocks.pop()

    this.chunkBlocks.get(block.chunkKey)?.delete(key)
    if (this.chunkBlocks.get(block.chunkKey)?.size === 0) {
      this.chunkBlocks.delete(block.chunkKey)
    }

    this.blockMap.delete(key)
    return type
  }

  private loadChunkFromCache = (chunkX: number, chunkZ: number, blocksMap: Map<string, number>) => {
    const chunkKey = `${chunkX}_${chunkZ}`
    if (this.chunksLoaded.has(chunkKey)) {
      this.requestedChunks.delete(chunkKey)
      return
    }
    
    const startTime = performance.now()
    const blocksArray = Array.from(blocksMap.entries())
    const affectedTypes = new Set<number>()
    const BATCH_SIZE = 400
    
    let processed = 0
    
    const processBatch = () => {
      const batch = blocksArray.slice(processed, processed + BATCH_SIZE)
      
      for (const [posKey, type] of batch) {
        const [x, y, z] = posKey.split('_').map(Number)
        if (this.insertBlock(x, y, z, type as BlockType)) {
          affectedTypes.add(type)
        }
      }
      
      processed += batch.length
      
      if (processed < blocksArray.length) {
        setTimeout(() => processBatch(), 0)
      } else {
        for (const type of affectedTypes) {
          this.markBlockTypeDirty(type)
        }
        
        this.chunksLoaded.add(chunkKey)
        this.requestedChunks.delete(chunkKey)
        this.pendingChunkData.delete(chunkKey)
        console.log(`✅ Чанк ${chunkKey} загружен за ${(performance.now() - startTime).toFixed(0)}мс, блоков: ${blocksArray.length}`)
      }
    }
    
    processBatch()
  }

  private handleBlockUpdate = (data: { position: { x: number; y: number; z: number }; type: number | null }) => {
    const { x, y, z } = data.position
    const pos = new THREE.Vector3(x, y, z)

    if (data.type === null) {
      this.removeBlockAtPosition(pos)
    } else {
      this.addBlockAtPosition(pos, data.type as BlockType)
    }
  }

  public addBlockAtPosition = (position: THREE.Vector3, type: BlockType) => {
    const { x, y, z } = position
    if (!this.insertBlock(x, y, z, type)) {
      return
    }

    this.markBlockTypeDirty(type)
    console.log(`🧱 Блок ${x},${y},${z} типа ${BlockType[type]} установлен`)
  }

  public removeBlockAtPosition = (position: THREE.Vector3) => {
    const { x, y, z } = position
    const type = this.removeBlockByKey(this.getBlockKey(x, y, z))
    if (type === null) {
      return
    }

    this.markBlockTypeDirty(type)
    console.log(`🗑️ Блок ${x},${y},${z} удалён`)
  }
  
  private requestVisibleChunks = () => {
    const centerX = this.chunk.x
    const centerZ = this.chunk.y
    
    this.pendingChunks = []
    
    for (let dx = -this.distance; dx <= this.distance; dx++) {
      for (let dz = -this.distance; dz <= this.distance; dz++) {
        const chunkX = centerX + dx
        const chunkZ = centerZ + dz
        const chunkKey = `${chunkX}_${chunkZ}`
        
        if (!this.chunksLoaded.has(chunkKey) && !this.requestedChunks.has(chunkKey) && !this.pendingChunkData.has(chunkKey)) {
          this.pendingChunks.push({ chunkX, chunkZ })
        }
      }
    }

    this.pendingChunks.sort((a, b) => {
      const distanceA = Math.abs(a.chunkX - centerX) + Math.abs(a.chunkZ - centerZ)
      const distanceB = Math.abs(b.chunkX - centerX) + Math.abs(b.chunkZ - centerZ)
      return distanceA - distanceB
    })
  }

  private processQueue = () => {
    if (this.isProcessing || this.pendingChunks.length === 0) return
    this.isProcessing = true

    const chunk = this.pendingChunks.shift()
    if (chunk) {
      const chunkKey = `${chunk.chunkX}_${chunk.chunkZ}`
      this.requestedChunks.add(chunkKey)
      this.networkManager.requestChunk(chunk.chunkX, chunk.chunkZ)
    }

    this.isProcessing = false
  }

  private startProcessingLoop = () => {
    const loop = () => {
      this.processQueue()
      this.animationId = requestAnimationFrame(loop)
    }
    this.animationId = requestAnimationFrame(loop)
  }

  private unloadFarChunks = () => {
    const currentChunkX = this.chunk.x
    const currentChunkZ = this.chunk.y
    
    const toUnload: string[] = []
    
    this.chunksLoaded.forEach(chunkKey => {
      const [chunkX, chunkZ] = chunkKey.split('_').map(Number)
      if (Math.abs(chunkX - currentChunkX) > this.distance + 1 ||
          Math.abs(chunkZ - currentChunkZ) > this.distance + 1) {
        toUnload.push(chunkKey)
      }
    })
    
    for (const chunkKey of toUnload) {
      this.unloadChunk(chunkKey)
    }
  }

  private unloadChunk = (chunkKey: string) => {
    const chunkEntries = this.chunkBlocks.get(chunkKey)
    if (!chunkEntries || chunkEntries.size === 0) {
      this.chunksLoaded.delete(chunkKey)
      return
    }

    const affectedTypes = new Set<number>()
    for (const key of Array.from(chunkEntries)) {
      const type = this.removeBlockByKey(key)
      if (type !== null) {
        affectedTypes.add(type)
      }
    }

    for (const type of affectedTypes) {
      this.markBlockTypeDirty(type)
    }
    
    this.chunksLoaded.delete(chunkKey)
    console.log(`🗑️ Выгружен чанк ${chunkKey}, удалено ${chunkEntries.size} блоков`)
  }

  private generateClouds = () => {
    if (this.cloudGap++ > 5) {
      this.cloudGap = 0
      this.cloud.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(1000 * 16), 16)
      this.cloudCount = 0
      
      const range = this.chunkSize * this.distance * 3
      const centerX = this.chunkSize * this.chunk.x
      const centerZ = this.chunkSize * this.chunk.y
      
      for (let x = -range + centerX; x < range + this.chunkSize + centerX; x += 20) {
        for (let z = -range + centerZ; z < range + this.chunkSize + centerZ; z += 20) {
          if (Math.random() > 0.8) {
            const matrix = new THREE.Matrix4()
            matrix.setPosition(x, 80 + (Math.random() - 0.5) * 30, z)
            this.cloud.setMatrixAt(this.cloudCount++, matrix)
          }
        }
      }
      this.cloud.instanceMatrix.needsUpdate = true
    }
  }

  public syncCollisions = () => {
   
  }

  public getNearbyBlocks = (
    position: THREE.Vector3,
    horizontalRange = 2,
    verticalRange = 3
  ) => {
    const nearbyBlocks: Block[] = []
    const minX = Math.floor(position.x - horizontalRange)
    const maxX = Math.floor(position.x + horizontalRange)
    const minY = Math.floor(position.y - verticalRange)
    const maxY = Math.floor(position.y + verticalRange)
    const minZ = Math.floor(position.z - horizontalRange)
    const maxZ = Math.floor(position.z + horizontalRange)

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = this.blockMap.get(this.getBlockKey(x, y, z))
          if (block) {
            nearbyBlocks.push(block)
          }
        }
      }
    }

    return nearbyBlocks
  }

  update = () => {
    const newChunkX = Math.floor(this.camera.position.x / this.chunkSize)
    const newChunkZ = Math.floor(this.camera.position.z / this.chunkSize)
    
    this.chunk.set(newChunkX, newChunkZ)

    if (this.chunk.x !== this.previousChunk.x || this.chunk.y !== this.previousChunk.y) {
      this.requestVisibleChunks()
      this.generateClouds()
      
      setTimeout(() => this.unloadFarChunks(), 100)
    }

    this.previousChunk.copy(this.chunk)
    this.highlight.update()
    

    const now = Date.now()
    if (now - this.lastSyncTime > this.syncInterval) {
      this.lastSyncTime = now
      this.syncCollisions()
    }
  }

  buildBlock = (position: THREE.Vector3, type: BlockType) => {
    this.addBlockAtPosition(position, type)
    this.networkManager.send('blockPlace', {
      position: { x: position.x, y: position.y, z: position.z },
      type
    })
  }

  generate = () => {
    this.requestVisibleChunks()
    this.generateClouds()
  }

  generateAdjacentBlocks = (position: THREE.Vector3) => {
    this.networkManager.send('generateAdjacent', {
      position: { x: position.x, y: position.y, z: position.z }
    })
  }

  getCount = (type: BlockType) => this.blocksCount[type]
  setCount = (type: BlockType) => { this.blocksCount[type]++ }

  public dispose = () => {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }
  }
}
