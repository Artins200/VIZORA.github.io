/**
 * Build a single texture atlas from procedural block faces.
 * Layout: each block id occupies a row; columns = top, side, bottom.
 */

import { BLOCKS, makeTexture } from './blocks.js';

const FACE_W = 16;
const COLS = 3; // top, side, bottom
const PAD = 0; // no padding — nearest filter

let _atlas = null;
let _meta = null; // id -> { top, side, bottom } UV rects in 0..1

export function getAtlas(THREE) {
  if (_atlas) return { texture: _atlas, meta: _meta };

  const ids = Object.keys(BLOCKS).map(Number).filter((id) => id > 0).sort((a, b) => a - b);
  const rows = ids.length;
  const w = COLS * FACE_W;
  const h = rows * FACE_W;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // fill magenta so missing faces are obvious
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, w, h);

  _meta = {};
  ids.forEach((id, row) => {
    const faces = ['top', 'side', 'bottom'];
    _meta[id] = {};
    faces.forEach((face, col) => {
      const src = makeTexture(id, face === 'bottom' ? 'bottom' : face);
      if (src) ctx.drawImage(src, col * FACE_W, row * FACE_W);
      // UV with half-texel inset to avoid bleeding
      const u0 = (col * FACE_W + 0.5) / w;
      const v0 = 1 - ((row + 1) * FACE_W - 0.5) / h; // flip V for Three
      const u1 = ((col + 1) * FACE_W - 0.5) / w;
      const v1 = 1 - (row * FACE_W + 0.5) / h;
      _meta[id][face] = { u0, v0, u1, v1 };
    });
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.flipY = true;
  _atlas = tex;
  return { texture: _atlas, meta: _meta };
}

export function faceUV(meta, id, faceIndex, corner) {
  // faceIndex: 0+X 1-X 2+Y 3-Y 4+Z 5-Z
  // corner: 0..3 matching FACE_VERTS order
  const face = faceIndex === 2 ? 'top' : faceIndex === 3 ? 'bottom' : 'side';
  const r = meta[id]?.[face];
  if (!r) return [0, 0];
  // corner UVs: 0=(0,0), 1=(0,1), 2=(1,1), 3=(1,0) in local
  const locals = [[0, 0], [0, 1], [1, 1], [1, 0]];
  const [lu, lv] = locals[corner];
  const u = r.u0 + (r.u1 - r.u0) * lu;
  const v = r.v0 + (r.v1 - r.v0) * lv;
  return [u, v];
}
