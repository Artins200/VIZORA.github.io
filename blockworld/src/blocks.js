/**
 * BlockWorld — original block definitions.
 * No Mojang/Minecraft assets or IDs are used.
 */

export const AIR = 0;

export const BLOCKS = {
  0: { name: 'air', solid: false, opaque: false, color: null },
  1: { name: 'soil', solid: true, opaque: true, color: [0.45, 0.28, 0.12] },
  2: { name: 'turf', solid: true, opaque: true, color: [0.30, 0.55, 0.18], top: [0.35, 0.62, 0.20], side: [0.42, 0.32, 0.14] },
  3: { name: 'stone', solid: true, opaque: true, color: [0.55, 0.55, 0.58] },
  4: { name: 'sand', solid: true, opaque: true, color: [0.86, 0.78, 0.52] },
  5: { name: 'wood', solid: true, opaque: true, color: [0.48, 0.32, 0.16], top: [0.40, 0.28, 0.14] },
  6: { name: 'leaves', solid: true, opaque: false, color: [0.22, 0.52, 0.22], alpha: 0.9 },
  7: { name: 'water', solid: false, opaque: false, color: [0.15, 0.35, 0.75], alpha: 0.55, fluid: true },
  8: { name: 'snow', solid: true, opaque: true, color: [0.92, 0.94, 0.98] },
  9: { name: 'gravel', solid: true, opaque: true, color: [0.50, 0.48, 0.45] },
  10: { name: 'clay', solid: true, opaque: true, color: [0.62, 0.48, 0.38] },
  11: { name: 'planks', solid: true, opaque: true, color: [0.72, 0.55, 0.30] },
  12: { name: 'brick', solid: true, opaque: true, color: [0.70, 0.32, 0.25] },
  13: { name: 'glass', solid: true, opaque: false, color: [0.70, 0.85, 0.95], alpha: 0.35 },
  14: { name: 'coal_ore', solid: true, opaque: true, color: [0.40, 0.40, 0.42], speck: [0.12, 0.12, 0.12] },
  15: { name: 'crystal', solid: true, opaque: false, color: [0.35, 0.75, 0.95], alpha: 0.7 },
};

/** Hotbar inventory (block ids player can place) */
export const HOTBAR = [2, 1, 3, 4, 5, 11, 12, 13, 15];

export function isSolid(id) {
  return id > 0 && BLOCKS[id]?.solid;
}

export function isOpaque(id) {
  return id > 0 && BLOCKS[id]?.opaque;
}

export function isFluid(id) {
  return BLOCKS[id]?.fluid === true;
}

/**
 * Procedurally generate a 16×16 pixel texture for a block face.
 * Completely original pixel art — no third-party assets.
 */
export function makeTexture(blockId, face = 'side') {
  const def = BLOCKS[blockId];
  if (!def || !def.color) return null;

  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  let base = def.color;
  if (face === 'top' && def.top) base = def.top;
  if (face === 'side' && def.side) base = def.side;
  if (face === 'bottom' && def.top) base = def.color; // underside uses body color

  // Deterministic pseudo-noise from block id
  const seed = blockId * 7919 + (face === 'top' ? 31 : face === 'bottom' ? 97 : 13);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = hashNoise(x, y, seed);
      let r = base[0], g = base[1], b = base[2];

      // Per-block style
      switch (blockId) {
        case 2: // turf
          if (face === 'top') {
            const v = 0.85 + n * 0.3;
            r *= v; g *= v; b *= v;
            if (n > 0.7) { r *= 0.85; g *= 1.1; }
          } else {
            // dirt body with grass fringe on top rows
            if (y < 3 && n > 0.3) {
              r = 0.30 + n * 0.1; g = 0.55 + n * 0.1; b = 0.18;
            } else {
              const v = 0.9 + n * 0.2;
              r *= v; g *= v; b *= v;
            }
          }
          break;
        case 3: // stone
        case 9: // gravel
        case 14: { // ore
          const v = 0.75 + n * 0.5;
          r *= v; g *= v; b *= v;
          if (blockId === 14 && n > 0.82) {
            r = def.speck[0]; g = def.speck[1]; b = def.speck[2];
          }
          // subtle crack lines
          if ((x + y * 3) % 11 === 0) { r *= 0.7; g *= 0.7; b *= 0.7; }
          break;
        }
        case 5: // wood log
          if (face === 'top' || face === 'bottom') {
            const cx = x - 7.5, cy = y - 7.5;
            const d = Math.sqrt(cx * cx + cy * cy);
            const ring = Math.sin(d * 1.8) * 0.15;
            r = 0.40 + ring; g = 0.28 + ring; b = 0.14 + ring * 0.5;
          } else {
            // bark stripes
            const stripe = Math.sin(x * 0.9 + n) * 0.08;
            r = 0.48 + stripe + n * 0.1;
            g = 0.32 + stripe * 0.5 + n * 0.05;
            b = 0.16 + n * 0.04;
          }
          break;
        case 6: // leaves
          {
            const v = 0.7 + n * 0.5;
            r *= v; g *= v; b *= v;
            if (n < 0.25) { r = 0; g = 0; b = 0; data[i + 3] = 0; continue; }
          }
          break;
        case 7: // water
          {
            const wave = Math.sin(x * 0.6 + y * 0.4) * 0.08;
            r = 0.12 + wave; g = 0.32 + wave; b = 0.72 + wave * 0.5 + n * 0.1;
          }
          break;
        case 11: // planks
          {
            const board = Math.floor(y / 4);
            const seam = y % 4 === 0;
            const v = 0.9 + n * 0.2 + (board % 2) * 0.05;
            r *= v; g *= v; b *= v;
            if (seam) { r *= 0.65; g *= 0.65; b *= 0.65; }
            if (x === 8) { r *= 0.75; g *= 0.75; b *= 0.75; }
          }
          break;
        case 12: // brick
          {
            const row = Math.floor(y / 4);
            const offset = (row % 2) * 4;
            const bx = (x + offset) % 8;
            const seam = y % 4 === 0 || bx === 0;
            if (seam) {
              r = 0.55; g = 0.50; b = 0.45;
            } else {
              const v = 0.9 + n * 0.2;
              r *= v; g *= v; b *= v;
            }
          }
          break;
        case 13: // glass
          {
            r = 0.75; g = 0.88; b = 0.95;
            // frame
            if (x === 0 || y === 0 || x === 15 || y === 15) {
              r = 0.55; g = 0.7; b = 0.8;
            }
          }
          break;
        case 15: // crystal
          {
            const cx = x - 7.5, cy = y - 7.5;
            const d = Math.sqrt(cx * cx + cy * cy) / 8;
            r = 0.25 + (1 - d) * 0.4 + n * 0.1;
            g = 0.55 + (1 - d) * 0.35;
            b = 0.85 + (1 - d) * 0.15;
            if (Math.abs(x - y) < 1 || Math.abs(x + y - 15) < 1) {
              r = Math.min(1, r + 0.3); g = Math.min(1, g + 0.3); b = 1;
            }
          }
          break;
        default: {
          const v = 0.88 + n * 0.24;
          r *= v; g *= v; b *= v;
        }
      }

      data[i] = Math.min(255, Math.max(0, r * 255)) | 0;
      data[i + 1] = Math.min(255, Math.max(0, g * 255)) | 0;
      data[i + 2] = Math.min(255, Math.max(0, b * 255)) | 0;
      if (data[i + 3] === 0 && blockId !== 6) {
        // leave leaves holes; everything else opaque unless alpha set
      }
      if (data[i + 3] !== 0 || blockId === 0) {
        // already set alpha 0 for leaf holes
      } else {
        const a = def.alpha != null ? def.alpha : 1;
        data[i + 3] = (a * 255) | 0;
      }
      if (blockId !== 6) {
        const a = def.alpha != null ? def.alpha : 1;
        data[i + 3] = (a * 255) | 0;
      } else if (data[i + 3] !== 0) {
        data[i + 3] = 230;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function hashNoise(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h & 0xffff) / 0xffff);
}

/** Build Three.js materials for all blocks */
export function createMaterials(THREE) {
  const materials = {}; // id -> { top, bottom, side, transparent? }
  const loader = new THREE.CanvasTexture.bind(THREE); // not used directly

  for (const idStr of Object.keys(BLOCKS)) {
    const id = +idStr;
    if (id === 0) continue;
    const def = BLOCKS[id];

    const mk = (face) => {
      const canvas = makeTexture(id, face);
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    };

    const transparent = def.alpha != null && def.alpha < 1 || id === 6 || id === 7 || id === 13 || id === 15;
    const opacity = def.alpha != null ? def.alpha : 1;

    const common = {
      transparent,
      opacity,
      alphaTest: id === 6 ? 0.4 : 0,
      depthWrite: !transparent || id === 6,
      side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    };

    materials[id] = {
      top: new THREE.MeshLambertMaterial({ map: mk('top'), ...common }),
      bottom: new THREE.MeshLambertMaterial({ map: mk('bottom'), ...common }),
      side: new THREE.MeshLambertMaterial({ map: mk('side'), ...common }),
      transparent,
      fluid: !!def.fluid,
    };
  }

  return materials;
}

/** Small icon canvas for hotbar */
export function makeIcon(blockId) {
  return makeTexture(blockId, 'side');
}
