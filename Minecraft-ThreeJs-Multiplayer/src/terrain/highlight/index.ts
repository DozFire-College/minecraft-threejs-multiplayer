// highlight/index.ts - упрощённая версия
import * as THREE from 'three'
import Terrain, { BlockType } from '..'

/**
 * Highlight block on crosshair
 */
export default class BlockHighlight {
  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    terrain: Terrain
  ) {
    this.camera = camera
    this.scene = scene
    this.terrain = terrain
    this.raycaster = new THREE.Raycaster()
    this.raycaster.far = 8
  }

  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  terrain: Terrain
  raycaster: THREE.Raycaster

  // highlight block mesh
  geometry = new THREE.BoxGeometry(1.01, 1.01, 1.01)
  material = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.25,
    color: 0xffffff
  })
  mesh = new THREE.Mesh(this.geometry, this.material)
  
  currentHighlightedPosition: THREE.Vector3 | null = null

  update() {
  
    if (this.currentHighlightedPosition) {
      this.scene.remove(this.mesh)
      this.currentHighlightedPosition = null
    }
    

    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const intersects = this.raycaster.intersectObjects(this.terrain.blocks)
    
    if (intersects.length > 0) {
      const hit = intersects[0]
      const matrix = new THREE.Matrix4()
      
      if (hit.object instanceof THREE.InstancedMesh && typeof hit.instanceId === 'number') {
        hit.object.getMatrixAt(hit.instanceId, matrix)
        const position = new THREE.Vector3().setFromMatrixPosition(matrix)
        
  
        const blockType = BlockType[hit.object.name as any] as unknown as BlockType
        
        if (blockType !== BlockType.bedrock) {
          this.mesh.position.copy(position)
          this.scene.add(this.mesh)
          this.currentHighlightedPosition = position
        }
      }
    }
  }
}