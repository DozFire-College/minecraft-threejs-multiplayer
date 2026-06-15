import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import * as SkeletonUtilsModule from 'three/examples/jsm/utils/SkeletonUtils'

const SkeletonUtils = SkeletonUtilsModule as unknown as {
  clone: (source: THREE.Object3D) => THREE.Object3D
}

type AvatarTemplates = {
  idle: THREE.Group
  moving: THREE.Group
}

const AVATAR_HEIGHT = 1.8
const DEFAULT_EYE_HEIGHT = 1.62

export default class PlayerAvatar {
  private static templatesPromise: Promise<AvatarTemplates> | null = null

  private root = new THREE.Group()
  private idleModel: THREE.Group | null = null
  private movingModel: THREE.Group | null = null
  private nickname = ''
  private nicknameSprite: THREE.Sprite | null = null
  private nicknameTexture: THREE.CanvasTexture | null = null
  private headIdle: THREE.Object3D | null = null
  private headMoving: THREE.Object3D | null = null
  private headIdleBaseQuaternion = new THREE.Quaternion()
  private headMovingBaseQuaternion = new THREE.Quaternion()
  private readonly isLocal: boolean
  private readonly eyeHeight: number
  private viewMode: 'first' | 'third' = 'first'
  private lookYaw = 0
  private lookPitch = 0
  private bodyYaw = 0
  readonly ready: Promise<void>

  constructor(
    scene: THREE.Scene,
    options: {
      isLocal?: boolean
      eyeHeight?: number
    } = {}
  ) {
    this.isLocal = options.isLocal ?? false
    this.eyeHeight = options.eyeHeight ?? DEFAULT_EYE_HEIGHT
    this.root.visible = !this.isLocal
    scene.add(this.root)
    this.ready = this.init()
  }

  private static getTemplates = async (): Promise<AvatarTemplates> => {
    if (!PlayerAvatar.templatesPromise) {
      PlayerAvatar.templatesPromise = Promise.all([
        PlayerAvatar.loadTemplate(
          '/assets/player/stay-steve.glb',
          '/assets/player/stay-steve.png'
        ),
        PlayerAvatar.loadTemplate(
          '/assets/player/move-steve.fbx',
          '/assets/player/move-steve.png'
        )
      ]).then(([idle, moving]) => ({ idle, moving }))
    }

    return PlayerAvatar.templatesPromise
  }

  private static loadTemplate = async (
    modelUrl: string,
    textureUrl: string
  ): Promise<THREE.Group> => {
    const textureLoader = new THREE.TextureLoader()

    const [model, texture] = await Promise.all([
      PlayerAvatar.loadModel(modelUrl),
      textureLoader.loadAsync(textureUrl)
    ])

    texture.encoding = THREE.sRGBEncoding
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter

    model.traverse(child => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) {
        return
      }

      mesh.castShadow = true
      mesh.receiveShadow = true

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(material =>
          PlayerAvatar.applyTextureToMaterial(material, texture)
        )
      } else if (mesh.material) {
        mesh.material = PlayerAvatar.applyTextureToMaterial(mesh.material, texture)
      }
    })

    return PlayerAvatar.normalizeModel(model)
  }

  private static loadModel = async (modelUrl: string): Promise<THREE.Group> => {
    if (/\.fbx$/i.test(modelUrl)) {
      const loader = new FBXLoader()
      return (await loader.loadAsync(modelUrl)) as THREE.Group
    }

    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(modelUrl)
    return gltf.scene as unknown as THREE.Group
  }

  private static applyTextureToMaterial = (
    material: THREE.Material,
    texture: THREE.Texture
  ) => {
    const nextMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      color: new THREE.Color(1, 1, 1),
      transparent: true,
      alphaTest: 0.05
    }) as THREE.MeshStandardMaterial & { skinning?: boolean }

    nextMaterial.skinning = (material as unknown as { skinning?: boolean }).skinning ?? true
    nextMaterial.roughness = 1
    nextMaterial.metalness = 0
    nextMaterial.emissive = new THREE.Color(0, 0, 0)
    nextMaterial.emissiveIntensity = 0
    nextMaterial.needsUpdate = true

    return nextMaterial
  }

  private static normalizeModel = (model: THREE.Group) => {
    const container = new THREE.Group()
    container.add(model)

    const initialBox = new THREE.Box3().setFromObject(container)
    const size = new THREE.Vector3()
    initialBox.getSize(size)

    const safeHeight = size.y || 1
    const scale = AVATAR_HEIGHT / safeHeight
    model.scale.setScalar(scale)

    const normalizedBox = new THREE.Box3().setFromObject(container)
    const center = new THREE.Vector3()
    normalizedBox.getCenter(center)

    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y -= normalizedBox.min.y

    return container
  }

  private init = async () => {
    const templates = await PlayerAvatar.getTemplates()

    this.idleModel = SkeletonUtils.clone(templates.idle) as THREE.Group
    this.movingModel = SkeletonUtils.clone(templates.moving) as THREE.Group

    const headIdle = PlayerAvatar.findHeadNode(this.idleModel)
    const headMoving = PlayerAvatar.findHeadNode(this.movingModel)
    this.headIdle = headIdle
    this.headMoving = headMoving
    if (headIdle) {
      this.headIdleBaseQuaternion.copy(headIdle.quaternion)
    }
    if (headMoving) {
      this.headMovingBaseQuaternion.copy(headMoving.quaternion)
    }

    this.root.add(this.idleModel)
    this.root.add(this.movingModel)

    this.nicknameSprite = this.createNicknameSprite()
    this.root.add(this.nicknameSprite)

    this.setMoving(false)
    this.applyLook()
    this.applyVisibility()
  }

  setViewMode = (mode: 'first' | 'third') => {
    this.viewMode = mode
    this.applyVisibility()
  }

  setMoving = (moving: boolean) => {
    if (this.idleModel) {
      this.idleModel.visible = !moving
    }

    if (this.movingModel) {
      this.movingModel.visible = moving
    }
  }

  setNickname = (nickname: string) => {
    const nextNickname = nickname.trim().slice(0, 16)
    if (nextNickname === this.nickname) {
      return
    }
    this.nickname = nextNickname
    this.updateNicknameTexture()
  }

  setTransform = (
    position: { x: number; y: number; z: number },
    avatarYaw: number,
    moving: boolean,
    look?: { yaw: number; pitch: number }
  ) => {
    this.root.position.set(position.x, position.y - this.eyeHeight, position.z)
    this.root.rotation.set(0, avatarYaw, 0)
    this.bodyYaw = avatarYaw
    if (look) {
      this.lookYaw = look.yaw
      this.lookPitch = look.pitch
    }
    this.applyLook()
    this.setMoving(moving)
  }

  dispose = () => {
    this.root.removeFromParent()

    if (this.nicknameTexture) {
      this.nicknameTexture.dispose()
      this.nicknameTexture = null
    }

    this.root.traverse(child => {
      const mesh = child as THREE.Mesh
      const sprite = child as unknown as THREE.Sprite
      if (!mesh.isMesh) {
        if (sprite.isSprite) {
          const material = sprite.material as THREE.SpriteMaterial
          material.dispose()
        }
        return
      }

      mesh.geometry.dispose()

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(material => material.dispose())
      } else if (mesh.material) {
        mesh.material.dispose()
      }
    })
  }

  private applyVisibility = () => {
    this.root.visible = !this.isLocal || this.viewMode === 'third'
  }

  private createNicknameSprite = () => {
    const texture = new THREE.CanvasTexture(document.createElement('canvas'))
    texture.needsUpdate = true
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    })
    const sprite = new THREE.Sprite(material)
    sprite.position.set(0, AVATAR_HEIGHT + 0.25, 0)
    this.nicknameTexture = texture
    this.updateNicknameTexture()
    return sprite
  }

  private updateNicknameTexture = () => {
    if (!this.nicknameTexture || !this.nicknameSprite) {
      return
    }

    const canvas = this.nicknameTexture.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const text = this.nickname || ''
    if (!text) {
      canvas.width = 1
      canvas.height = 1
      this.nicknameTexture.needsUpdate = true
      this.nicknameSprite.visible = false
      return
    }

    this.nicknameSprite.visible = true

    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const fontSize = 26 * dpr
    const paddingX = 14 * dpr
    const paddingY = 8 * dpr

    ctx.font = `${fontSize}px Minecraft, sans-serif`
    const metrics = ctx.measureText(text)
    const textWidth = Math.ceil(metrics.width)
    const width = textWidth + paddingX * 2
    const height = fontSize + paddingY * 2

    canvas.width = width
    canvas.height = height

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 0, width, height)

    ctx.font = `${fontSize}px Minecraft, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.fillText(text, width / 2, height / 2 + 1 * dpr)

    this.nicknameTexture.needsUpdate = true

    const worldHeight = 0.35
    const aspect = width / height
    this.nicknameSprite.scale.set(worldHeight * aspect, worldHeight, 1)
  }

  private static findHeadNode = (model: THREE.Object3D): THREE.Object3D | null => {
    let head: THREE.Object3D | null = null
    model.traverse(child => {
      if (head) {
        return
      }
      if (!child.name) {
        return
      }
      if (/head/i.test(child.name)) {
        head = child
      }
    })
    return head
  }

  private clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value))

  private normalizeAngle = (angle: number) => {
    let a = (angle + Math.PI) % (Math.PI * 2)
    if (a < 0) {
      a += Math.PI * 2
    }
    return a - Math.PI
  }

  private applyLook = () => {
    const yaw = this.normalizeAngle(this.lookYaw + Math.PI)
    const yawOffset = this.clamp(this.normalizeAngle(yaw - this.bodyYaw), -1.3, 1.3)
    const pitch = this.clamp(this.lookPitch, -1.1, 1.1)

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yawOffset, 0, 'YXZ'))

    const headIdle = this.headIdle
    if (headIdle) {
      headIdle.quaternion.copy(this.headIdleBaseQuaternion).multiply(q)
    }
    const headMoving = this.headMoving
    if (headMoving) {
      headMoving.quaternion.copy(this.headMovingBaseQuaternion).multiply(q)
    }
  }
}
