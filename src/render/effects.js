import * as THREE from 'three';
import { CURB, SIDEWALK_H } from '../sim/level.js';
import { EGA, box } from './models.js';

const GRAVITY = -22;
const MAX_DEBRIS = 450;

const groundAt = (x, z) => (Math.abs(z) > CURB ? SIDEWALK_H : 0);

// Chunks of things flying about. Each piece is a real mesh with simple
// ballistic motion, bouncing and tumbling on the ground.
export class Debris {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.toppling = [];
  }

  // Tips an object over around its base (its origin), falling in direction (dx, dz).
  topple(obj, dx, dz, speed) {
    const len = Math.hypot(dx, dz) || 1;
    // axis is horizontal and perpendicular to the fall direction
    const axis = new THREE.Vector3(dz / len, 0, -dx / len);
    this.toppling.push({ obj, axis, angle: 0, w: 0.6 + Math.min(3, speed * 0.25), q0: obj.quaternion.clone(), bounces: 0 });
  }

  // A building crumbles into a heap of big chunks that fall and settle as rubble.
  collapse(b, color, particles) {
    const nx = Math.max(2, Math.round(b.w / 2.6));
    const ny = Math.max(2, Math.round(b.h / 2.6));
    const nz = 3;
    const sx = b.w / nx, sy = b.h / ny, sz = b.depth / nz;
    const x0 = b.cx - b.w / 2, z0 = b.z - b.depth / 2;
    const cols = [color, color, EGA.dgray, EGA.lgray];
    let k = 0;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        for (let l = 0; l < nz; l++) {
          const m = box(sx * 0.95, sy * 0.95, sz * 0.95, cols[k++ % cols.length]);
          m.position.set(x0 + (i + 0.5) * sx, (j + 0.5) * sy, z0 + (l + 0.5) * sz);
          const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2 - j * 0.3, (Math.random() - 0.5) * 3);
          const it = this.add(m, v, new THREE.Vector3(Math.random() * 3 - 1.5, Math.random() * 3 - 1.5, Math.random() * 3 - 1.5), 120);
          it.radius = Math.min(sx, sy, sz) * 0.4;
        }
      }
    }
    for (let i = 0; i < 90; i++) {
      particles.smoke(x0 + Math.random() * b.w, Math.random() * b.h * 0.6, z0 + Math.random() * b.depth);
    }
  }

  add(mesh, vel, spin, life = 14) {
    this.scene.add(mesh);
    const it = { mesh, v: vel.clone(), w: spin.clone(), life, age: 0, rest: false, radius: 0.08 };
    this.items.push(it);
    while (this.items.length > MAX_DEBRIS) this.remove(0);
    return it;
  }

  remove(i) {
    const it = this.items[i];
    this.scene.remove(it.mesh);
    this.items.splice(i, 1);
  }

  // Detach every mesh inside `group` and send it flying.
  explode(group, baseVel, power = 1) {
    group.updateMatrixWorld(true);
    const meshes = [];
    group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
      m.matrixWorld.decompose(wp, wq, ws);
      m.removeFromParent();
      m.position.copy(wp); m.quaternion.copy(wq); m.scale.copy(ws);
      const v = new THREE.Vector3(
        baseVel.x * (0.6 + Math.random() * 0.7) + (Math.random() - 0.5) * 4 * power,
        (2 + Math.random() * 5) * power + Math.hypot(baseVel.x, baseVel.z) * 0.35,
        baseVel.z * (0.6 + Math.random() * 0.7) + (Math.random() - 0.5) * 4 * power,
      );
      const s = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      this.add(m, v, s);
    }
  }

  // Bits that come off when you hit a wall or wreck a car.
  burst(x, y, z, colors, n, speed, dir = null) {
    for (let i = 0; i < n; i++) {
      const s = 0.12 + Math.random() * 0.28;
      const m = box(s, s * (0.5 + Math.random()), s, colors[i % colors.length]);
      m.position.set(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 1.2, z + (Math.random() - 0.5) * 0.6);
      const v = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + 1.5, (Math.random() - 0.5) * speed);
      if (dir) v.add(dir.clone().multiplyScalar(speed * 0.6));
      this.add(m, v, new THREE.Vector3(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10), 8 + Math.random() * 4);
    }
  }

  // Cars plough through debris lying on the ground.
  kick(cars) {
    for (const it of this.items) {
      if (it.mesh.position.y > 1.2 + it.radius) continue;
      for (const c of cars) {
        const b = c.body;
        const dx = it.mesh.position.x - b.x, dz = it.mesh.position.z - b.z;
        const ca = Math.cos(b.a), sa = Math.sin(b.a);
        const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
        if (Math.abs(lx) < b.hl + 0.1 && Math.abs(lz) < b.hw + 0.1) {
          const sp = Math.hypot(b.vx, b.vz);
          if (sp < 0.8) continue;
          it.v.set(b.vx * 1.3 + (Math.random() - 0.5) * 2, 1.5 + sp * 0.35, b.vz * 1.3 + (Math.random() - 0.5) * 2);
          it.w.set(Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8);
          it.rest = false;
          it.age = Math.min(it.age, it.life - 6);
        }
      }
    }
  }

  update(dt) {
    for (let i = this.toppling.length - 1; i >= 0; i--) {
      const t = this.toppling[i];
      t.w += (6 * Math.sin(t.angle) + 1.5) * dt; // falls faster as it tips
      t.angle += t.w * dt;
      if (t.angle >= Math.PI / 2 - 0.05) {
        t.angle = Math.PI / 2 - 0.05;
        t.w = -t.w * 0.25; // little bounce
        if (++t.bounces > 2 || Math.abs(t.w) < 0.3) this.toppling.splice(i, 1);
      }
      t.obj.quaternion.setFromAxisAngle(t.axis, t.angle).multiply(t.q0);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const m = it.mesh;
      if (it.age > it.life) {
        const k = 1 - (it.age - it.life) / 1.0;
        if (k <= 0) { this.remove(i); continue; }
        m.scale.multiplyScalar(0.92);
      }
      if (it.rest) continue;
      it.v.y += GRAVITY * dt;
      m.position.addScaledVector(it.v, dt);
      m.rotation.x += it.w.x * dt; m.rotation.y += it.w.y * dt; m.rotation.z += it.w.z * dt;
      const g = groundAt(m.position.x, m.position.z) + it.radius;
      if (m.position.y < g) {
        m.position.y = g;
        if (Math.abs(it.v.y) < 1.2 && Math.hypot(it.v.x, it.v.z) < 0.6) {
          it.rest = true;
          continue;
        }
        it.v.y = Math.abs(it.v.y) * 0.35;
        it.v.x *= 0.6; it.v.z *= 0.6;
        it.w.multiplyScalar(0.6);
      }
    }
  }

  clear() { while (this.items.length) this.remove(0); this.toppling = []; }
}

// Square pixel particles (smoke, sparks, water, coins, confetti).
export class Particles {
  constructor(scene, max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.data = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 300 } },
      vertexShader: /* glsl */`
        attribute float size; attribute vec3 color; attribute float alpha;
        varying vec3 vC; varying float vA; uniform float scale;
        void main() {
          vC = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main() { gl_FragColor = vec4(vC, vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.material = material;
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.color = new THREE.Color();
  }

  emit(x, y, z, vx, vy, vz, color, size = 0.3, life = 1, opts = {}) {
    if (this.data.length >= this.max) this.data.shift();
    this.color.set(color).convertSRGBToLinear();
    this.data.push({ x, y, z, vx, vy, vz, r: this.color.r, g: this.color.g, b: this.color.b, size, life, age: 0,
      grav: opts.grav ?? -9, grow: opts.grow ?? 0, drag: opts.drag ?? 0, alpha: opts.alpha ?? 1, fade: !!opts.fade });
  }

  smoke(x, y, z, dark = false) {
    const c = dark ? (Math.random() < 0.5 ? EGA.dgray : EGA.black) : (Math.random() < 0.5 ? EGA.lgray : EGA.white);
    // see-through and fading, so smoke never hides the action
    this.emit(x, y, z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, c, 0.35, 1.6 + Math.random(),
      { grav: 0.6, grow: 0.5, drag: 0.8, alpha: dark ? 0.3 : 0.45, fade: true });
  }

  sparks(x, y, z, n = 12, power = 4) {
    for (let i = 0; i < n; i++) {
      this.emit(x, y, z, (Math.random() - 0.5) * power * 2, Math.random() * power, (Math.random() - 0.5) * power * 2,
        Math.random() < 0.5 ? EGA.yellow : EGA.white, 0.15, 0.4 + Math.random() * 0.4, { grav: -14 });
    }
  }

  fire(x, y, z) {
    const c = [EGA.yellow, EGA.lred, 0xff8800][Math.floor(Math.random() * 3)];
    this.emit(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8, 0, 2 + Math.random() * 2, 0, c, 0.4, 0.5 + Math.random() * 0.4, { grav: 1, grow: -0.4 });
  }

  water(x, y, z) {
    this.emit(x, y, z, (Math.random() - 0.5) * 1.4, 8 + Math.random() * 3, (Math.random() - 0.5) * 1.4,
      Math.random() < 0.6 ? EGA.lcyan : EGA.white, 0.25, 1.6, { grav: -9 });
  }

  confetti(x, y, z, n = 60) {
    const cs = [EGA.yellow, EGA.lmagenta, EGA.lcyan, EGA.lgreen, EGA.lred, EGA.white];
    for (let i = 0; i < n; i++) {
      this.emit(x, y, z, (Math.random() - 0.5) * 8, 4 + Math.random() * 6, (Math.random() - 0.5) * 8, cs[i % cs.length], 0.22, 2.5, { grav: -6, drag: 1.2 });
    }
  }

  coins(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) this.emit(x, y, z, (Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 4, EGA.yellow, 0.2, 1.5, { grav: -14 });
  }

  update(dt) {
    let n = 0;
    for (let i = this.data.length - 1; i >= 0; i--) {
      const p = this.data[i];
      p.age += dt;
      if (p.age > p.life) { this.data.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const g = groundAt(p.x, p.z);
      if (p.y < g) { p.y = g; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
      p.size = Math.max(0.02, p.size + p.grow * dt);
    }
    for (const p of this.data) {
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 3] = p.r; this.col[n * 3 + 1] = p.g; this.col[n * 3 + 2] = p.b;
      this.size[n] = p.size;
      this.alpha[n] = p.fade ? p.alpha * (1 - p.age / p.life) : p.alpha;
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }

  clear() { this.data.length = 0; }
}

// Comic-book text that floats up from the world ("DING!", "+$800").
export class Popups {
  constructor(container, camera) {
    this.el = container;
    this.camera = camera;
    this.items = [];
    this.v = new THREE.Vector3();
  }

  add(text, x, y, z, color = '#ffff55', size = 1) {
    const d = document.createElement('div');
    d.className = 'popup';
    d.textContent = text;
    d.style.color = color;
    d.style.fontSize = `${Math.round(14 * size)}px`;
    this.el.appendChild(d);
    this.items.push({ d, x, y, z, age: 0, life: 1.3 });
    if (this.items.length > 30) { this.items[0].d.remove(); this.items.shift(); }
  }

  update(dt) {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age > it.life) { it.d.remove(); this.items.splice(i, 1); continue; }
      this.v.set(it.x, it.y + it.age * 1.5, it.z).project(this.camera);
      if (this.v.z > 1) { it.d.style.display = 'none'; continue; }
      it.d.style.display = '';
      it.d.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.3 - it.age) * 2})`;
      it.d.style.opacity = String(Math.min(1, (it.life - it.age) * 3));
    }
  }

  clear() { this.items.forEach((it) => it.d.remove()); this.items = []; }
}
