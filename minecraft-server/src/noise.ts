// minecraft-server/src/noise.ts
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

export class ServerNoise {
  private noise: ImprovedNoise;
  private static readonly WORLD_SEED = 12345;
  
  gap = 22;
  amp = 8;
  stoneGap = 12;
  stoneAmp = 8;
  stoneThreshold = 3.5;
  coalGap = 3;
  coalAmp = 8;
  coalThreshold = 3;
  treeGap = 2;
  treeAmp = 6;
  treeHeight = 10;
  treeThreshold = 4;

  constructor() {
    this.noise = new ImprovedNoise();
  }

  static getWorldSeed(): number {
    return ServerNoise.WORLD_SEED;
  }

  get2D(x: number, z: number): number {
    return this.noise.noise(x, 0, z);
  }

  get3D(x: number, y: number, z: number): number {
    return this.noise.noise(x, y, z);
  }

  getGroundHeight(x: number, z: number): number {
    const yOffset = Math.floor(
      this.get2D(x / this.gap, z / this.gap) * this.amp
    );
    return 30 + yOffset;
  }

  getBlockType(x: number, y: number, z: number): number | null {
    const groundHeight = this.getGroundHeight(x, z);
    
    if (y > groundHeight) return null;
    if (y === 0) return 11; // bedrock
 
    if (y < groundHeight) {
      const stoneOffset = this.get3D(x / this.stoneGap, y / this.stoneGap, z / this.stoneGap) * this.stoneAmp;
      
      if (stoneOffset > this.stoneThreshold) {
        const coalOffset = this.get3D(x / this.coalGap, y / this.coalGap, z / this.coalGap) * this.coalAmp;
        if (coalOffset > this.coalThreshold) {
          return 6; // coal
        }
        return 5; // stone
      }
      return 5; // stone
    }
    
  
    if (y === groundHeight) {
      const stoneOffset = this.get3D(x / this.stoneGap, y / this.stoneGap, z / this.stoneGap) * this.stoneAmp;
      
      if (stoneOffset > this.stoneThreshold) {
        return 5; // stone
      }
      
      const yOffset = Math.floor(this.get2D(x / this.gap, z / this.gap) * this.amp);
      if (yOffset < -3) {
        return 1; // sand
      }
      return 0; // grass
    }
    

    if (y === groundHeight - 1) {
      return 4; // dirt
    }
    
    return 5; // stone
  }

  shouldGenerateTree(x: number, z: number, groundHeight: number): boolean {
    const treeOffset = this.get2D(x / this.treeGap, z / this.treeGap) * this.treeAmp;
    const stoneOffset = this.get2D(x / this.stoneGap, z / this.stoneGap) * this.stoneAmp;
    
    return treeOffset > this.treeThreshold && groundHeight >= 27 && stoneOffset < this.stoneThreshold;
  }
}
