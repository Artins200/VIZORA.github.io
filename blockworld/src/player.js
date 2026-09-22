/**
 * First-person controller with AABB physics.
 */

import { isSolid, isFluid } from './blocks.js';

const WIDTH = 0.6;
const HEIGHT = 1.7;
const EYE = 1.55;
const HALF = WIDTH / 2;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.x = 0;
    this.y = 40;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.speed = 4.8;
    this.sprintMul = 1.45;
    this.jumpSpeed = 8.2;
    this.gravity = 24;
    this.sensitivity = 0.002;
    this.flying = false;

    this.keys = Object.create(null);
    this.lookLocked = false;
  }

  /** Feed key state from the single global input handler in main.js */
  setKey(code, down) {
    this.keys[code] = down;
  }

  setPosition(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
  }

  get eyeX() { return this.x; }
  get eyeY() { return this.y + EYE; }
  get eyeZ() { return this.z; }

  get lookDir() {
    const cp = Math.cos(this.pitch);
    return {
      x: Math.sin(this.yaw) * cp,
      y: -Math.sin(this.pitch), // pitch positive = look down? we'll use standard
      z: -Math.cos(this.yaw) * cp,
    };
    // Actually: yaw 0 looks -Z; pitch positive looks up
  }

  // Correct look direction: pitch+ = up
  getLookDir() {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return {
      x: Math.sin(this.yaw) * cp,
      y: sp,
      z: -Math.cos(this.yaw) * cp,
    };
  }

  onMouseMove(dx, dy) {
    if (!this.lookLocked) return;
    this.yaw += dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  aabb(x = this.x, y = this.y, z = this.z) {
    return {
      minX: x - HALF,
      maxX: x + HALF,
      minY: y,
      maxY: y + HEIGHT,
      minZ: z - HALF,
      maxZ: z + HALF,
    };
  }

  update(dt) {
    if (dt > 0.05) dt = 0.05; // avoid tunneling on hitch

    const forward = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const strafe = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const sprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];

    // Water check
    const feetId = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
    const headId = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + EYE), Math.floor(this.z));
    this.inWater = isFluid(feetId) || isFluid(headId);

    if (this.flying) {
      let sp = this.speed * 2 * (sprint ? 2 : 1);
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      this.vx = (forward * -sy + strafe * cy) * sp; // wait
      // yaw 0 = -Z; forward moves -Z when yaw=0 → dir (-sin? )
      // lookDir xz: (sin(yaw), -cos(yaw))
      const lx = Math.sin(this.yaw);
      const lz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = Math.sin(this.yaw);
      this.vx = (lx * forward + rx * strafe) * sp;
      this.vz = (lz * forward + rz * strafe) * sp;
      this.vy = 0;
      if (this.keys['Space']) this.vy = sp;
      if (this.keys['ControlLeft'] || this.keys['KeyC']) this.vy = -sp;
    } else {
      const sp = this.speed * (sprint ? this.sprintMul : 1) * (this.inWater ? 0.5 : 1);
      const lx = Math.sin(this.yaw);
      const lz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = Math.sin(this.yaw);
      const wishX = lx * forward + rx * strafe;
      const wishZ = lz * forward + rz * strafe;
      const len = Math.hypot(wishX, wishZ);
      if (len > 0) {
        this.vx = (wishX / len) * sp;
        this.vz = (wishZ / len) * sp;
      } else {
        this.vx *= this.onGround ? 0 : 0.9;
        this.vz *= this.onGround ? 0 : 0.9;
        if (this.onGround) { this.vx = 0; this.vz = 0; }
      }

      if (this.inWater) {
        this.vy += -this.gravity * 0.25 * dt;
        if (this.keys['Space']) this.vy = 4.5;
        if (this.keys['ShiftLeft']) this.vy = -4;
        this.vy *= 0.9;
      } else {
        this.vy -= this.gravity * dt;
        if (this.keys['Space'] && this.onGround) {
          this.vy = this.jumpSpeed;
          this.onGround = false;
        }
      }
    }

    this._moveAxis(this.vx * dt, 0, 0);
    this._moveAxis(0, this.vy * dt, 0);
    this._moveAxis(0, 0, this.vz * dt);

    // Sync camera (YXZ). Default look = -Z.
    // Ry(yaw) maps -Z → (sin yaw, 0, -cos yaw) — matches getLookDir.
    // +rotation.x tilts view down, so pitch-up uses -rotation.x.
    this.camera.position.set(this.x, this.y + EYE, this.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = -this.pitch;
  }

  _moveAxis(dx, dy, dz) {
    this.x += dx;
    this.y += dy;
    this.z += dz;

    const box = this.aabb();
    const x0 = Math.floor(box.minX);
    const y0 = Math.floor(box.minY);
    const z0 = Math.floor(box.minZ);
    const x1 = Math.floor(box.maxX);
    const y1 = Math.floor(box.maxY);
    const z1 = Math.floor(box.maxZ);

    if (dy !== 0) this.onGround = false;

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!isSolid(this.world.getBlock(x, y, z))) continue;
          // block AABB [x,x+1] etc
          if (box.maxX <= x || box.minX >= x + 1) continue;
          if (box.maxY <= y || box.minY >= y + 1) continue;
          if (box.maxZ <= z || box.minZ >= z + 1) continue;

          // Resolve along the movement axis
          if (dx > 0) {
            this.x = x - HALF - 0.0001;
            this.vx = 0;
          } else if (dx < 0) {
            this.x = x + 1 + HALF + 0.0001;
            this.vx = 0;
          }
          if (dz > 0) {
            this.z = z - HALF - 0.0001;
            this.vz = 0;
          } else if (dz < 0) {
            this.z = z + 1 + HALF + 0.0001;
            this.vz = 0;
          }
          if (dy > 0) {
            this.y = y - HEIGHT - 0.0001;
            this.vy = 0;
          } else if (dy < 0) {
            this.y = y + 1 + 0.0001;
            this.vy = 0;
            this.onGround = true;
          }
          // refresh box after resolution
          const b2 = this.aabb();
          box.minX = b2.minX; box.maxX = b2.maxX;
          box.minY = b2.minY; box.maxY = b2.maxY;
          box.minZ = b2.minZ; box.maxZ = b2.maxZ;
        }
      }
    }
  }
}
