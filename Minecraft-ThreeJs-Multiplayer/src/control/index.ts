// control/index.ts
import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls'
import Player, { Mode } from '../player'
import Terrain, { BlockType } from '../terrain'

import Audio from '../audio'
import { isMobile } from '../utils'

export default class Control {
  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    player: Player,
    terrain: Terrain,
    audio: Audio
  ) {
    this.scene = scene
    this.camera = camera
    this.player = player
    this.terrain = terrain
    this.control = new PointerLockControls(camera, document.body)
    this.audio = audio

    this.raycaster = new THREE.Raycaster()
    this.raycaster.far = 8
    this.far = this.player.body.height

    this.initRayCaster()
    this.initEventListeners()
  }

  // core properties
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  player: Player
  terrain: Terrain
  control: PointerLockControls
  audio: Audio
  velocity = new THREE.Vector3(0, 0, 0)

  // collide and jump properties
  frontCollide = false
  backCollide = false
  leftCollide = false
  rightCollide = false
  downCollide = true
  upCollide = false
  isJumping = false

  raycasterDown = new THREE.Raycaster()
  raycasterUp = new THREE.Raycaster()
  raycasterFront = new THREE.Raycaster()
  raycasterBack = new THREE.Raycaster()
  raycasterRight = new THREE.Raycaster()
  raycasterLeft = new THREE.Raycaster()

  tempMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    100
  )
  tempMeshMatrix = new THREE.InstancedBufferAttribute(
    new Float32Array(100 * 16),
    16
  )

  // other properties
  p1 = performance.now()
  p2 = performance.now()
  raycaster: THREE.Raycaster
  far: number

  holdingBlock = BlockType.grass
  holdingBlocks = [
    BlockType.grass,
    BlockType.stone,
    BlockType.tree,
    BlockType.wood,
    BlockType.diamond,
    BlockType.quartz,
    BlockType.glass,
    BlockType.grass,
    BlockType.grass,
    BlockType.grass
  ]
  holdingIndex = 0
  wheelGap = false
  clickInterval?: ReturnType<typeof setInterval>
  jumpInterval?: ReturnType<typeof setInterval>
  mouseHolding = false
  spaceHolding = false
  collisionEpsilon = 0.001

  initRayCaster = () => {
    this.raycasterUp.ray.direction = new THREE.Vector3(0, 1, 0)
    this.raycasterDown.ray.direction = new THREE.Vector3(0, -1, 0)
    this.raycasterFront.ray.direction = new THREE.Vector3(1, 0, 0)
    this.raycasterBack.ray.direction = new THREE.Vector3(-1, 0, 0)
    this.raycasterLeft.ray.direction = new THREE.Vector3(0, 0, -1)
    this.raycasterRight.ray.direction = new THREE.Vector3(0, 0, 1)

    this.raycasterUp.far = 1.2
    this.raycasterDown.far = this.player.body.height
    this.raycasterFront.far = this.player.body.width
    this.raycasterBack.far = this.player.body.width
    this.raycasterLeft.far = this.player.body.width
    this.raycasterRight.far = this.player.body.width
  }

  downKeys = {
    a: false,
    d: false,
    w: false,
    s: false
  }
  
  setMovementHandler = (e: KeyboardEvent) => {
    if (e.repeat) {
      return
    }

    switch (e.key) {
      case 'q':
        if (this.player.mode === Mode.walking) {
          this.player.setMode(Mode.flying)
        } else {
          this.player.setMode(Mode.walking)
        }
        this.velocity.y = 0
        this.velocity.x = 0
        this.velocity.z = 0
        break
      case 'w':
      case 'W':
        this.downKeys.w = true
        this.velocity.x = this.player.speed
        break
      case 's':
      case 'S':
        this.downKeys.s = true
        this.velocity.x = -this.player.speed
        break
      case 'a':
      case 'A':
        this.downKeys.a = true
        this.velocity.z = -this.player.speed
        break
      case 'd':
      case 'D':
        this.downKeys.d = true
        this.velocity.z = this.player.speed
        break
      case ' ':
        if (this.player.mode === Mode.sneaking && !this.isJumping) {
          return
        }
        if (this.player.mode === Mode.walking) {
          if (!this.isJumping) {
            this.velocity.y = 8
            this.isJumping = true
            this.downCollide = false
            this.far = 0
            setTimeout(() => {
              this.far = this.player.body.height
            }, 300)
          }
        } else {
          this.velocity.y += this.player.speed
        }
        if (this.player.mode === Mode.walking && !this.spaceHolding) {
          this.spaceHolding = true
          this.jumpInterval = setInterval(() => {
            this.setMovementHandler(e)
          }, 10)
        }
        break
      case 'Shift':
        if (this.player.mode === Mode.walking) {
          if (!this.isJumping) {
            this.player.setMode(Mode.sneaking)
            if (this.downKeys.w) {
              this.velocity.x = this.player.speed
            }
            if (this.downKeys.s) {
              this.velocity.x = -this.player.speed
            }
            if (this.downKeys.a) {
              this.velocity.z = -this.player.speed
            }
            if (this.downKeys.d) {
              this.velocity.z = this.player.speed
            }
            this.camera.position.setY(this.camera.position.y - 0.2)
          }
        } else {
          this.velocity.y -= this.player.speed
        }
        break
      default:
        break
    }
  }

  resetMovementHandler = (e: KeyboardEvent) => {
    if (e.repeat) {
      return
    }

    switch (e.key) {
      case 'w':
      case 'W':
        this.downKeys.w = false
        this.velocity.x = 0
        break
      case 's':
      case 'S':
        this.downKeys.s = false
        this.velocity.x = 0
        break
      case 'a':
      case 'A':
        this.downKeys.a = false
        this.velocity.z = 0
        break
      case 'd':
      case 'D':
        this.downKeys.d = false
        this.velocity.z = 0
        break
      case ' ':
        if (this.player.mode === Mode.sneaking && !this.isJumping) {
          return
        }
        this.jumpInterval && clearInterval(this.jumpInterval)
        this.spaceHolding = false
        if (this.player.mode === Mode.walking) {
          return
        }
        this.velocity.y = 0
        break
      case 'Shift':
        if (this.player.mode === Mode.sneaking) {
          if (!this.isJumping) {
            this.player.setMode(Mode.walking)
            if (this.downKeys.w) {
              this.velocity.x = this.player.speed
            }
            if (this.downKeys.s) {
              this.velocity.x = -this.player.speed
            }
            if (this.downKeys.a) {
              this.velocity.z = -this.player.speed
            }
            if (this.downKeys.d) {
              this.velocity.z = this.player.speed
            }
            this.camera.position.setY(this.camera.position.y + 0.2)
          }
        }
        if (this.player.mode === Mode.walking) {
          return
        }
        this.velocity.y = 0
        break
      default:
        break
    }
  }

  mousedownHandler = (e: MouseEvent) => {
    e.preventDefault()
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const block = this.raycaster.intersectObjects(this.terrain.blocks)[0]
    const matrix = new THREE.Matrix4()

    switch (e.button) {
      // left click to remove block
      case 0:
        {
          if (block && block.object instanceof THREE.InstancedMesh) {
            block.object.getMatrixAt(block.instanceId!, matrix)
            const position = new THREE.Vector3().setFromMatrixPosition(matrix)

            // don't remove bedrock
            if (
              (BlockType[block.object.name as any] as unknown as BlockType) ===
              BlockType.bedrock
            ) {
              // Отправляем запрос на генерацию соседних блоков на сервер
              this.terrain.generateAdjacentBlocks(position)
              return
            }

            // Отправляем запрос на удаление блока на сервер
            this.terrain.networkManager?.send('blockBreak', {
              x: position.x,
              y: position.y,
              z: position.z
            })
            this.terrain.removeBlockAtPosition(position)

            // Визуальный эффект и звук (локально для отзывчивости)
            this.audio.playSound(
              BlockType[block.object.name as any] as unknown as BlockType
            )

            const mesh = new THREE.Mesh(
              new THREE.BoxGeometry(1, 1, 1),
              this.terrain.materials.get(
                this.terrain.materialType[
                  parseInt(BlockType[block.object.name as any])
                ]
              )
            )
            mesh.position.set(position.x, position.y, position.z)
            this.scene.add(mesh)
            const time = performance.now()
            let raf = 0
            const animate = () => {
              if (performance.now() - time > 250) {
                this.scene.remove(mesh)
                cancelAnimationFrame(raf)
                return
              }
              raf = requestAnimationFrame(animate)
              mesh.geometry.scale(0.85, 0.85, 0.85)
            }
            animate()
          }
        }
        break

      // right click to put block
      case 2:
        {
          if (block && block.object instanceof THREE.InstancedMesh) {
            const normal = block.face!.normal
            block.object.getMatrixAt(block.instanceId!, matrix)
            const position = new THREE.Vector3().setFromMatrixPosition(matrix)

            const newX = normal.x + position.x
            const newY = normal.y + position.y
            const newZ = normal.z + position.z

            // return when block overlaps with player
            if (!this.canPlaceBlockAt(newX, newY, newZ)) {
              return
            }

            // Отправляем запрос на установку блока на сервер
            this.terrain.buildBlock(new THREE.Vector3(newX, newY, newZ), this.holdingBlock)

            // Звук (локально)
            this.audio.playSound(this.holdingBlock)
          }
        }
        break
      default:
        break
    }

    if (!isMobile && !this.mouseHolding) {
      this.mouseHolding = true
      this.clickInterval = setInterval(() => {
        this.mousedownHandler(e)
      }, 333)
    }
  }
  
  mouseupHandler = () => {
    this.clickInterval && clearInterval(this.clickInterval)
    this.mouseHolding = false
  }

  changeHoldingBlockHandler = (e: KeyboardEvent) => {
    if (isNaN(parseInt(e.key)) || e.key === '0') {
      return
    }
    this.holdingIndex = parseInt(e.key) - 1
    this.holdingBlock = this.holdingBlocks[this.holdingIndex] ?? BlockType.grass
  }

  wheelHandler = (e: WheelEvent) => {
    if (!this.wheelGap) {
      this.wheelGap = true
      setTimeout(() => {
        this.wheelGap = false
      }, 100)
      if (e.deltaY > 0) {
        this.holdingIndex++
        this.holdingIndex > 9 && (this.holdingIndex = 0)
      } else if (e.deltaY < 0) {
        this.holdingIndex--
        this.holdingIndex < 0 && (this.holdingIndex = 9)
      }
      this.holdingBlock = this.holdingBlocks[this.holdingIndex] ?? BlockType.grass
    }
  }

  initEventListeners = () => {
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) {
        document.body.addEventListener('keydown', this.changeHoldingBlockHandler)
        document.body.addEventListener('wheel', this.wheelHandler)
        document.body.addEventListener('keydown', this.setMovementHandler)
        document.body.addEventListener('keyup', this.resetMovementHandler)
        document.body.addEventListener('mousedown', this.mousedownHandler)
        document.body.addEventListener('mouseup', this.mouseupHandler)
      } else {
        document.body.removeEventListener('keydown', this.changeHoldingBlockHandler)
        document.body.removeEventListener('wheel', this.wheelHandler)
        document.body.removeEventListener('keydown', this.setMovementHandler)
        document.body.removeEventListener('keyup', this.resetMovementHandler)
        document.body.removeEventListener('mousedown', this.mousedownHandler)
        document.body.removeEventListener('mouseup', this.mouseupHandler)
        this.velocity = new THREE.Vector3(0, 0, 0)
      }
    })
  }

  moveX(distance: number, delta: number) {
    this.camera.position.x += distance * (this.player.speed / Math.PI) * 2 * delta
  }

  moveZ = (distance: number, delta: number) => {
    this.camera.position.z += distance * (this.player.speed / Math.PI) * 2 * delta
  }

  private getHeadOffset = () =>
    this.player.body.height - this.player.body.eyeHeight

  private getPlayerBounds = (position: THREE.Vector3) => ({
    minX: position.x - this.player.body.width,
    maxX: position.x + this.player.body.width,
    minY: position.y - this.player.body.eyeHeight,
    maxY: position.y + this.getHeadOffset(),
    minZ: position.z - this.player.body.width,
    maxZ: position.z + this.player.body.width
  })

  private getBlockBounds = (block: { x: number; y: number; z: number }) => ({
    minX: block.x - 0.5,
    maxX: block.x + 0.5,
    minY: block.y - 0.5,
    maxY: block.y + 0.5,
    minZ: block.z - 0.5,
    maxZ: block.z + 0.5
  })

  private intersectsBlock = (
    position: THREE.Vector3,
    block: { x: number; y: number; z: number }
  ) => {
    const bounds = this.getPlayerBounds(position)
    const blockBounds = this.getBlockBounds(block)

    return (
      bounds.maxX > blockBounds.minX &&
      bounds.minX < blockBounds.maxX &&
      bounds.maxY > blockBounds.minY &&
      bounds.minY < blockBounds.maxY &&
      bounds.maxZ > blockBounds.minZ &&
      bounds.minZ < blockBounds.maxZ
    )
  }

  private canPlaceBlockAt = (x: number, y: number, z: number) => {
    const playerBounds = this.getPlayerBounds(this.camera.position)
    const blockBounds = this.getBlockBounds({ x, y, z })

    return !(
      playerBounds.maxX > blockBounds.minX &&
      playerBounds.minX < blockBounds.maxX &&
      playerBounds.maxY > blockBounds.minY &&
      playerBounds.minY < blockBounds.maxY &&
      playerBounds.maxZ > blockBounds.minZ &&
      playerBounds.minZ < blockBounds.maxZ
    )
  }

  private getMovementVector = (forward: number, strafe: number, delta: number) => {
    const forwardDirection = new THREE.Vector3()
    this.camera.getWorldDirection(forwardDirection)
    forwardDirection.y = 0

    if (forwardDirection.lengthSq() === 0) {
      forwardDirection.set(0, 0, -1)
    } else {
      forwardDirection.normalize()
    }

    const rightDirection = new THREE.Vector3()
      .crossVectors(forwardDirection, this.camera.up)
      .normalize()

    return forwardDirection.multiplyScalar(forward * delta).add(
      rightDirection.multiplyScalar(strafe * delta)
    )
  }

  private resolvePlayerPenetration = () => {
    const position = this.camera.position
    const overlappingBlocks = this.terrain
      .getNearbyBlocks(position, 2, 4)
      .filter(block => block.placed && this.intersectsBlock(position, block))

    for (const block of overlappingBlocks) {
      const bounds = this.getPlayerBounds(position)
      const blockBounds = this.getBlockBounds(block)
      const pushLeft = bounds.maxX - blockBounds.minX
      const pushRight = blockBounds.maxX - bounds.minX
      const pushBack = bounds.maxZ - blockBounds.minZ
      const pushFront = blockBounds.maxZ - bounds.minZ
      const pushUp = blockBounds.maxY - bounds.minY

      const corrections = [
        { axis: 'x', value: pushLeft, sign: -1 },
        { axis: 'x', value: pushRight, sign: 1 },
        { axis: 'z', value: pushBack, sign: -1 },
        { axis: 'z', value: pushFront, sign: 1 },
        { axis: 'y', value: pushUp, sign: 1 }
      ].filter(correction => correction.value > 0)

      corrections.sort((a, b) => a.value - b.value)
      const correction = corrections[0]

      if (!correction) {
        continue
      }

      if (correction.axis === 'x') {
        position.x += correction.value * correction.sign + this.collisionEpsilon * correction.sign
        this.velocity.x = 0
      } else if (correction.axis === 'z') {
        position.z += correction.value * correction.sign + this.collisionEpsilon * correction.sign
        this.velocity.z = 0
      } else {
        position.y += correction.value + this.collisionEpsilon
        this.velocity.y = Math.max(0, this.velocity.y)
        this.downCollide = true
        this.isJumping = false
      }
    }
  }

  private resolveHorizontalMovement = (delta: number) => {
    const movement = this.getMovementVector(this.velocity.x, this.velocity.z, delta)
    const position = this.camera.position
    const nearbyBlocks = this.terrain.getNearbyBlocks(position, 3, 4)

    this.frontCollide = false
    this.backCollide = false
    this.leftCollide = false
    this.rightCollide = false

    if (movement.x !== 0) {
      const nextPosition = position.clone()
      nextPosition.x += movement.x

      for (const block of nearbyBlocks) {
        if (!block.placed || !this.intersectsBlock(nextPosition, block)) continue

        if (movement.x > 0) {
          nextPosition.x = Math.min(
            nextPosition.x,
            this.getBlockBounds(block).minX - this.player.body.width - this.collisionEpsilon
          )
          this.frontCollide = true
        } else {
          nextPosition.x = Math.max(
            nextPosition.x,
            this.getBlockBounds(block).maxX + this.player.body.width + this.collisionEpsilon
          )
          this.backCollide = true
        }
      }

      position.x = nextPosition.x
    }

    if (movement.z !== 0) {
      const nextPosition = position.clone()
      nextPosition.z += movement.z

      for (const block of nearbyBlocks) {
        if (!block.placed || !this.intersectsBlock(nextPosition, block)) continue

        if (movement.z > 0) {
          nextPosition.z = Math.min(
            nextPosition.z,
            this.getBlockBounds(block).minZ - this.player.body.width - this.collisionEpsilon
          )
          this.rightCollide = true
        } else {
          nextPosition.z = Math.max(
            nextPosition.z,
            this.getBlockBounds(block).maxZ + this.player.body.width + this.collisionEpsilon
          )
          this.leftCollide = true
        }
      }

      position.z = nextPosition.z
    }
  }

  private resolveVerticalMovement = (delta: number) => {
    const position = this.camera.position
    const nextPosition = position.clone()
    nextPosition.y += this.velocity.y * delta

    this.downCollide = false
    this.upCollide = false

    for (const block of this.terrain.getNearbyBlocks(position, 2, 4)) {
      if (!block.placed || !this.intersectsBlock(nextPosition, block)) continue
      const blockBounds = this.getBlockBounds(block)

      if (this.velocity.y >= 0) {
        nextPosition.y = Math.min(
          nextPosition.y,
          blockBounds.minY - this.getHeadOffset() - this.collisionEpsilon
        )
        this.upCollide = true
      } else {
        nextPosition.y = Math.max(
          nextPosition.y,
          blockBounds.maxY + this.player.body.eyeHeight + this.collisionEpsilon
        )
        this.downCollide = true
      }
    }

    position.y = nextPosition.y
  }

  collideCheckAll = () => {
    const position = this.camera.position
    const bounds = this.getPlayerBounds(position)
    const contactEpsilon = 0.05
    
    this.frontCollide = false
    this.backCollide = false
    this.leftCollide = false
    this.rightCollide = false
    this.downCollide = false
    this.upCollide = false
    
    for (const block of this.terrain.getNearbyBlocks(position)) {
      if (!block.placed) continue

      const blockBounds = this.getBlockBounds(block)
      const overlapY = bounds.maxY > blockBounds.minY && bounds.minY < blockBounds.maxY
      const overlapZ = bounds.maxZ > blockBounds.minZ && bounds.minZ < blockBounds.maxZ
      const realOverlapX = bounds.maxX > blockBounds.minX && bounds.minX < blockBounds.maxX

      if (
        realOverlapX &&
        overlapZ &&
        Math.abs(bounds.minY - blockBounds.maxY) <= contactEpsilon
      ) {
        this.downCollide = true
      }

      if (
        realOverlapX &&
        overlapZ &&
        Math.abs(bounds.maxY - blockBounds.minY) <= contactEpsilon
      ) {
        this.upCollide = true
      }

      if (overlapY && overlapZ) {
        if (Math.abs(bounds.maxX - blockBounds.minX) <= contactEpsilon) {
          this.frontCollide = true
        }
        if (Math.abs(bounds.minX - blockBounds.maxX) <= contactEpsilon) {
          this.backCollide = true
        }
      }

      if (overlapY && realOverlapX) {
        if (Math.abs(bounds.maxZ - blockBounds.minZ) <= contactEpsilon) {
          this.rightCollide = true
        }
        if (Math.abs(bounds.minZ - blockBounds.maxZ) <= contactEpsilon) {
          this.leftCollide = true
        }
      }
    }
  }

  update = () => {
    this.p1 = performance.now()
    const delta = Math.min((this.p1 - this.p2) / 1000, 0.033) // Ограничиваем delta
    
    if (this.player.mode === Mode.flying) {
      // Режим полёта
      this.control.moveForward(this.velocity.x * delta)
      this.control.moveRight(this.velocity.z * delta)
      this.camera.position.y += this.velocity.y * delta
    } else {
      // Если игрок уже оказался в блоке, мягко выталкиваем его наружу
      this.resolvePlayerPenetration()

      // Гравитация
      if (Math.abs(this.velocity.y) < this.player.falling) {
        this.velocity.y -= 25 * delta
      }

      this.resolveHorizontalMovement(delta)
      this.resolveVerticalMovement(delta)
      this.collideCheckAll()

      if (this.upCollide && this.velocity.y > 0) {
        this.velocity.y = 0
      }

      if (this.downCollide && !this.isJumping) {
        this.velocity.y = 0
        this.isJumping = false
      } else if (this.downCollide && this.isJumping) {
        this.velocity.y = 0
        this.isJumping = false
      }

      // Защита от падения в бездну
      if (this.camera.position.y < -100) {
        this.camera.position.y = 60
      }
    }
    this.p2 = this.p1
  }
}
