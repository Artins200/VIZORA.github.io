/**
 * World manager — chunk streaming, block access, meshing queue.
 */

import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT, chunkKey, SEA_LEVEL } from './chunk.js';
import { Noise2D } from './noise.js';
import { isSolid, isFluid } from './blocks.js';

export class World {
  constructor(scene, THREE, options = {}) {
    this.scene = scene;
    this.THREE = THREE;
    this.seed = options.seed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.noise = new Noise2D(this.seed);
    this.chunks = new Map();
    this.renderDistance = options.renderDistance ?? 8;
    this.maxMeshesPerFrame = 2; // keep FPS stable
    this.maxGensPerFrame = 3;
    this._meshQueue = [];
    this._genQueue = [];
    this._group = new THREE.Group();
    this.scene.add(this._group);
    this.lastPlayerChunk = { x: NaN, z: NaN };
  }

  setRenderDistance(d) {
    this.renderDistance = Math.max(3, Math.min(16, d | 0));
  }

  getBlock(wx, y, wz) {
    wx = Math.floor(wx);
    y = Math.floor(y);
    wz = Math.floor(wz);
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.generated) return 0;
    const ix = wx - cx * CHUNK_SIZE;
    const iz = wz - cz * CHUNK_SIZE;
    return chunk.get(ix, y, iz);
  }

  setBlock(wx, y, wz, id) {
    wx = Math.floor(wx);
    y = Math.floor(y);
    wz = Math.floor(wz);
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk || !chunk.generated) return false;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    chunk.set(lx, y, lz, id);
    this._queueRemesh(cx, cz);
    // Neighbor chunks if on border
    if (lx === 0) this._queueRemesh(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this._queueRemesh(cx + 1, cz);
    if (lz === 0) this._queueRemesh(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this._queueRemesh(cx, cz + 1);
    return true;
  }

  _queueRemesh(cx, cz) {
    const ch = this.chunks.get(chunkKey(cx, cz));
    if (!ch) return;
    ch.dirty = true;
    const k = chunkKey(cx, cz);
    if (!this._meshQueue.includes(k)) this._meshQueue.push(k);
  }

  neighborGet = (wx, y, wz) => {
    return this.getBlock(wx, y, wz);
  };

  /** Call each frame with player world position */
  update(px, pz) {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);

    if (pcx !== this.lastPlayerChunk.x || pcz !== this.lastPlayerChunk.z) {
      this.lastPlayerChunk.x = pcx;
      this.lastPlayerChunk.z = pcz;
      this._scheduleChunks(pcx, pcz);
    }

    // Generate a few
    let gens = 0;
    while (this._genQueue.length && gens < this.maxGensPerFrame) {
      const k = this._genQueue.shift();
      const ch = this.chunks.get(k);
      if (!ch || ch.generated) continue;
      ch.generate();
      this._meshQueue.push(k);
      gens++;
    }

    // Mesh a few
    let meshes = 0;
    while (this._meshQueue.length && meshes < this.maxMeshesPerFrame) {
      const k = this._meshQueue.shift();
      const ch = this.chunks.get(k);
      if (!ch || !ch.generated || !ch.dirty) continue;
      this._rebuildChunk(ch);
      meshes++;
    }
  }

  _scheduleChunks(pcx, pcz) {
    const rd = this.renderDistance;
    const needed = new Set();

    // Spiral order from player outward
    const ordered = [];
    for (let r = 0; r <= rd; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          const k = chunkKey(cx, cz);
          needed.add(k);
          ordered.push({ cx, cz, k });
        }
      }
    }

    for (const { cx, cz, k } of ordered) {
      if (!this.chunks.has(k)) {
        const ch = new Chunk(cx, cz, this.noise, this.seed);
        this.chunks.set(k, ch);
        this._genQueue.push(k);
      } else {
        const ch = this.chunks.get(k);
        if (!ch.generated && !this._genQueue.includes(k)) this._genQueue.push(k);
        else if (ch.dirty && !this._meshQueue.includes(k)) this._meshQueue.push(k);
      }
    }

    // Unload far chunks
    const unloadDist = rd + 2;
    for (const [k, ch] of this.chunks) {
      if (needed.has(k)) continue;
      const dx = ch.cx - pcx;
      const dz = ch.cz - pcz;
      if (Math.abs(dx) > unloadDist || Math.abs(dz) > unloadDist) {
        if (ch._group) this._group.remove(ch._group);
        ch.dispose();
        this.chunks.delete(k);
      }
    }

    // Sort gen queue by distance
    this._genQueue.sort((a, b) => {
      const ca = this.chunks.get(a), cb = this.chunks.get(b);
      if (!ca || !cb) return 0;
      const da = Math.abs(ca.cx - pcx) + Math.abs(ca.cz - pcz);
      const db = Math.abs(cb.cx - pcx) + Math.abs(cb.cz - pcz);
      return da - db;
    });
  }

  _rebuildChunk(ch) {
    if (ch._group) {
      this._group.remove(ch._group);
      ch.dispose();
    }
    const group = ch.buildMesh(this.THREE, null, this.neighborGet);
    this._group.add(group);
  }

  /** Force generate around spawn for initial load */
  async preload(px, pz, radius, onProgress) {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const list = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        list.push({ cx: pcx + dx, cz: pcz + dz });
      }
    }
    // nearest first
    list.sort((a, b) => (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2 - ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2));

    for (let i = 0; i < list.length; i++) {
      const { cx, cz } = list[i];
      const k = chunkKey(cx, cz);
      let ch = this.chunks.get(k);
      if (!ch) {
        ch = new Chunk(cx, cz, this.noise, this.seed);
        this.chunks.set(k, ch);
      }
      if (!ch.generated) ch.generate();
      if (onProgress) onProgress((i + 1) / list.length);
      // yield to UI
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    // mesh all
    for (let i = 0; i < list.length; i++) {
      const { cx, cz } = list[i];
      const ch = this.chunks.get(chunkKey(cx, cz));
      if (ch && ch.dirty) this._rebuildChunk(ch);
      if (onProgress) onProgress(0.5 + 0.5 * ((i + 1) / list.length));
      if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    this.lastPlayerChunk = { x: pcx, z: pcz };
  }

  findSpawn() {
    // Search near 0,0 for solid ground above sea
    for (let r = 0; r < 64; r++) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const x = Math.floor(Math.cos(ang) * r);
        const z = Math.floor(Math.sin(ang) * r);
        // ensure chunk
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const k = chunkKey(cx, cz);
        let ch = this.chunks.get(k);
        if (!ch) {
          ch = new Chunk(cx, cz, this.noise, this.seed);
          ch.generate();
          this.chunks.set(k, ch);
        }
        for (let y = CHUNK_HEIGHT - 1; y > SEA_LEVEL; y--) {
          const b = this.getBlock(x, y, z);
          if (isSolid(b) && this.getBlock(x, y + 1, z) === 0 && this.getBlock(x, y + 2, z) === 0) {
            return { x: x + 0.5, y: y + 1, z: z + 0.5 };
          }
        }
      }
    }
    return { x: 0.5, y: SEA_LEVEL + 10, z: 0.5 };
  }

  /**
   * DDA voxel raycast. Returns {x,y,z, nx,ny,nz, dist} of hit block + face normal.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 6) {
    // Amanatides & Woo grid traversal
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    let tMaxX = dx !== 0 ? (stepX > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (stepY > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY : Infinity;
    let tMaxZ = dz !== 0 ? (stepZ > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ : Infinity;

    let nx = 0, ny = 0, nz = 0;
    let dist = 0;

    for (let i = 0; i < maxDist * 3; i++) {
      const id = this.getBlock(x, y, z);
      if (id > 0 && isSolid(id)) {
        return { x, y, z, nx, ny, nz, id, dist };
      }

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          dist = tMaxX;
          x += stepX;
          tMaxX += tDeltaX;
          nx = -stepX; ny = 0; nz = 0;
        } else {
          dist = tMaxZ;
          z += stepZ;
          tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          dist = tMaxY;
          y += stepY;
          tMaxY += tDeltaY;
          nx = 0; ny = -stepY; nz = 0;
        } else {
          dist = tMaxZ;
          z += stepZ;
          tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      }
      if (dist > maxDist) break;
    }
    return null;
  }

  collides(aabb) {
    // aabb: {minX,minY,minZ,maxX,maxY,maxZ}
    const x0 = Math.floor(aabb.minX);
    const y0 = Math.floor(aabb.minY);
    const z0 = Math.floor(aabb.minZ);
    const x1 = Math.floor(aabb.maxX);
    const y1 = Math.floor(aabb.maxY);
    const z1 = Math.floor(aabb.maxZ);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (isSolid(this.getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  get chunkCount() {
    return this.chunks.size;
  }

  reset(seed) {
    for (const ch of this.chunks.values()) {
      if (ch._group) this._group.remove(ch._group);
      ch.dispose();
    }
    this.chunks.clear();
    this._meshQueue = [];
    this._genQueue = [];
    this.seed = seed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.noise = new Noise2D(this.seed);
    this.lastPlayerChunk = { x: NaN, z: NaN };
  }
}

export { SEA_LEVEL, CHUNK_HEIGHT, CHUNK_SIZE };
