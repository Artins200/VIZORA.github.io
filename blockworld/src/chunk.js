/**
 * Chunk mesh builder — greedy-ish face culling for performance.
 * Only emits faces adjacent to air / transparent blocks.
 */

import { isOpaque, isSolid, BLOCKS } from './blocks.js';
import { Noise2D, hash3 } from './noise.js';
import { getAtlas, faceUV } from './atlas.js';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 96;
export const SEA_LEVEL = 28;

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
// Face corners relative to block origin (x,y,z)
// order: +X -X +Y -Y +Z -Z
const FACE_VERTS = [
  // +X
  [[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
  // -X
  [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
  // +Y
  [[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  // -Y
  [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  // +Z
  [[1,0,1],[1,1,1],[0,1,1],[0,0,1]],
  // -Z
  [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
];
const FACE_UV = [
  [[0,0],[0,1],[1,1],[1,0]],
  [[0,0],[0,1],[1,1],[1,0]],
  [[0,0],[0,1],[1,1],[1,0]],
  [[0,0],[0,1],[1,1],[1,0]],
  [[0,0],[0,1],[1,1],[1,0]],
  [[0,0],[0,1],[1,1],[1,0]],
];
const FACE_NORMAL = [
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]
];
const FACE_SHADE = [0.8, 0.8, 1.0, 0.55, 0.9, 0.7];

export class Chunk {
  /**
   * @param {number} cx chunk x
   * @param {number} cz chunk z
   * @param {Noise2D} noise
   * @param {number} seed
   */
  constructor(cx, cz, noise, seed) {
    this.cx = cx;
    this.cz = cz;
    this.noise = noise;
    this.seed = seed;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.mesh = null;
    this.waterMesh = null;
    this.dirty = true;
    this.generated = false;
  }

  idx(x, y, z) {
    return y * (CHUNK_SIZE * CHUNK_SIZE) + z * CHUNK_SIZE + x;
  }

  get(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return -1; // outside
    return this.blocks[this.idx(x, y, z)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return;
    this.blocks[this.idx(x, y, z)] = id;
    this.dirty = true;
  }

  generate() {
    const { cx, cz, noise, seed } = this;
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;

        // Continental height
        const h1 = noise.fbm(wx * 0.008, wz * 0.008, 5, 2.0, 0.5);
        const h2 = noise.fbm(wx * 0.03, wz * 0.03, 3, 2.1, 0.45);
        const ridge = 1 - Math.abs(noise.fbm(wx * 0.012, wz * 0.012, 3));
        let height = Math.floor(SEA_LEVEL + h1 * 22 + h2 * 8 + ridge * ridge * 14);
        height = Math.max(4, Math.min(CHUNK_HEIGHT - 8, height));

        // Biome-ish
        const temp = noise.fbm(wx * 0.004 + 100, wz * 0.004, 3);
        const moist = noise.fbm(wx * 0.005 - 50, wz * 0.005, 3);

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let id = 0;
          if (y === 0) {
            id = 3; // bedrock-ish stone floor
          } else if (y > height) {
            if (y <= SEA_LEVEL) id = 7; // water
            else id = 0;
          } else if (y === height) {
            if (height < SEA_LEVEL - 1) id = 4; // sand under water
            else if (temp < -0.35 && height > SEA_LEVEL + 10) id = 8; // snow peaks
            else if (height <= SEA_LEVEL + 1) id = 4; // beach
            else id = 2; // turf
          } else if (y > height - 4) {
            if (height < SEA_LEVEL) id = 4;
            else id = 1; // soil
          } else {
            id = 3; // stone
            // ore pockets
            if (y < 40 && hash3(wx, y, wz, seed) > 0.97) id = 14;
          }

          // Caves
          if (id !== 0 && id !== 7 && y > 2 && y < height - 1) {
            const cave = noise.fbm(wx * 0.05, y * 0.07 + wz * 0.05);
            const cave2 = noise.noise(wx * 0.08 + 20, y * 0.08);
            if (cave > 0.55 && cave2 > 0.2) id = 0;
          }

          this.blocks[this.idx(lx, y, lz)] = id;
        }

        // Trees
        if (height > SEA_LEVEL + 1 && height < CHUNK_HEIGHT - 12) {
          const surface = this.blocks[this.idx(lx, height, lz)];
          if (surface === 2 && moist > -0.1) {
            const t = hash3(wx, height, wz, seed + 99);
            if (t > 0.978) {
              this._plantTree(lx, height + 1, lz, t);
            }
          }
        }
      }
    }

    this.generated = true;
    this.dirty = true;
  }

  _plantTree(x, y, z, rnd) {
    const trunkH = 4 + ((rnd * 100) | 0) % 3;
    for (let i = 0; i < trunkH; i++) {
      if (y + i < CHUNK_HEIGHT) this.set(x, y + i, z, 5);
    }
    const top = y + trunkH - 1;
    const radius = 2;
    for (let dy = -1; dy <= 2; dy++) {
      const r = dy >= 1 ? 1 : radius;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < 1) continue;
          if (Math.abs(dx) === r && Math.abs(dz) === r && rnd < 0.5) continue;
          const lx = x + dx, ly = top + dy, lz = z + dz;
          if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
          if (ly < 0 || ly >= CHUNK_HEIGHT) continue;
          if (this.get(lx, ly, lz) === 0) this.set(lx, ly, lz, 6);
        }
      }
    }
  }

  /**
   * Build geometry. neighborGet(wx,y,wz) returns block id in world space
   * for seamless culling across chunk borders.
   */
  buildMesh(THREE, materials, neighborGet) {
    const { texture: atlasTex, meta } = getAtlas(THREE);
    // Two meshes: opaque + translucent — keeps overdraw low
    const opaque = { pos: [], norm: [], uv: [], col: [], idx: [], vi: 0 };
    const translucent = { pos: [], norm: [], uv: [], col: [], idx: [], vi: 0 };

    const ox = this.cx * CHUNK_SIZE;
    const oz = this.cz * CHUNK_SIZE;

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = this.blocks[this.idx(x, y, z)];
          if (id === 0) continue;
          const def = BLOCKS[id];
          if (!def) continue;

          const isTrans = !def.opaque;
          const bucket = isTrans ? translucent : opaque;

          for (let f = 0; f < 6; f++) {
            const nx = x + DX[f];
            const ny = y + DY[f];
            const nz = z + DZ[f];

            let neighbor;
            if (ny < 0 || ny >= CHUNK_HEIGHT) {
              neighbor = 0;
            } else if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
              neighbor = neighborGet(ox + nx, ny, oz + nz);
            } else {
              neighbor = this.blocks[this.idx(nx, ny, nz)];
            }

            if (neighbor > 0 && isOpaque(neighbor)) continue;
            if (id === 7 && neighbor === 7) continue;
            if (isTrans && neighbor === id) continue;

            this._emitFace(bucket, meta, x, y, z, f, id, def);
          }
        }
      }
    }

    const group = new THREE.Group();
    group.position.set(ox, 0, oz);

    if (opaque.pos.length) {
      const mesh = this._toMesh(THREE, opaque, false, atlasTex);
      group.add(mesh);
      this.mesh = mesh;
    } else {
      this.mesh = null;
    }

    if (translucent.pos.length) {
      const mesh = this._toMesh(THREE, translucent, true, atlasTex);
      group.add(mesh);
      this.waterMesh = mesh;
    } else {
      this.waterMesh = null;
    }

    this.dirty = false;
    this._group = group;
    return group;
  }

  _emitFace(bucket, meta, x, y, z, f, id, def) {
    const verts = FACE_VERTS[f];
    const n = FACE_NORMAL[f];
    const shade = FACE_SHADE[f];

    // Directional AO-ish shade only (texture carries albedo)
    const cr = shade, cg = shade, cb = shade;

    const base = bucket.vi;
    for (let i = 0; i < 4; i++) {
      const v = verts[i];
      bucket.pos.push(x + v[0], y + v[1], z + v[2]);
      bucket.norm.push(n[0], n[1], n[2]);
      const [u, vv] = faceUV(meta, id, f, i);
      bucket.uv.push(u, vv);
      bucket.col.push(cr, cg, cb);
    }
    bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    bucket.vi += 4;
  }

  _toMesh(THREE, bucket, transparent, atlasTex) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.norm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(bucket.col, 3));
    geo.setIndex(bucket.idx);
    geo.computeBoundingSphere();

    const mat = new THREE.MeshLambertMaterial({
      map: atlasTex,
      vertexColors: true,
      transparent,
      opacity: transparent ? 0.8 : 1,
      alphaTest: transparent ? 0.15 : 0,
      depthWrite: !transparent,
      side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  dispose() {
    if (this._group) {
      this._group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        // Do NOT dispose shared atlas texture
        if (obj.material) obj.material.dispose();
      });
      this._group = null;
    }
    this.mesh = null;
    this.waterMesh = null;
  }
}

export function chunkKey(cx, cz) {
  return (cx + 32768) + ',' + (cz + 32768);
}
