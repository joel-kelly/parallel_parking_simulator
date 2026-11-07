import * as THREE from 'three';
import { RetroPass } from './post.js';
import { buildCar, buildProp, buildStreet, buildSpotMarker, EGA, box, mat } from './models.js';
import { Debris, Particles, Popups } from './effects.js';
import { CURB, SIDEWALK_H } from '../sim/level.js';
import { centreAhead } from '../sim/vehicles.js';

const PIXEL_HEIGHT = 300; // vertical resolution of the chunky render

export class View {
  constructor(canvas, popupLayer) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.post = new RetroPass(this.renderer);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 400);
    this.scene = new THREE.Scene();
    this.popups = new Popups(popupLayer, this.camera);
    this.camMode = 0;
    this.shake = 0;
    this.flash = 0;
    this.camPos = new THREE.Vector3(0, 8, 10);
    this.camLook = new THREE.Vector3();
    this.ega = true;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const scale = Math.max(1, h / PIXEL_HEIGHT);
    const rw = Math.round(w / scale), rh = Math.round(h / scale);
    this.renderer.setSize(rw, rh, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.post.setSize(rw, rh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pxScale = rh / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    if (this.particles) this.particles.material.uniforms.scale.value = this.pxScale;
  }

  setEga(on) { this.ega = on; }

  // Builds all meshes for a fresh World.
  load(world) {
    this.world = world;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0x55ffff, 90, 220);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-30, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    scene.add(sun, sun.target);
    this.sun = sun;

    scene.add(buildStreet(world.level));
    addClouds(scene, world.level);

    this.carViews = world.cars.map((c) => {
      const v = buildCar(c.spec, c.spec.color, c.spec.accent);
      scene.add(v.root);
      v.car = c;
      v.roll = 0;
      v.dist = 0;
      return v;
    });
    if (world.ai) {
      // tint the AI car so you can tell it apart
      const v = this.carViews[1];
      const tint = mat(EGA.lmagenta);
      v.body.traverse((o) => {
        if (o.isMesh && o.material.color && o.material.color.getHex() === world.ai.car.spec.color) o.material = tint;
      });
    }

    this.parkedViews = world.parked.map((p) => {
      const v = buildCar({ ...p.info, wheelbase: p.info.length * 0.62, rearOverhang: p.info.length * 0.19, wheelRadius: 0.32 }, p.info.color, EGA.white);
      v.root.position.set(p.body.x, 0, p.body.z);
      v.root.rotation.y = -p.body.a;
      scene.add(v.root);
      v.parked = p;
      v.smoke = 0;
      return v;
    });

    this.propViews = world.props.map((p) => {
      const g = buildProp(p.type);
      const y = Math.abs(p.body.z) > CURB ? SIDEWALK_H : 0;
      g.position.set(p.body.x, y, p.body.z);
      g.rotation.y = -p.body.a;
      scene.add(g);
      return { group: g, prop: p };
    });
    this.propByBody = new Map(this.propViews.map((v) => [v.prop, v]));

    this.markers = world.level.spots.map((s) => {
      const m = buildSpotMarker(s, s.owner === 'ai' ? EGA.lred : EGA.yellow);
      scene.add(m);
      return m;
    });

    this.debris = new Debris(scene);
    this.particles = new Particles(scene);
    this.particles.material.uniforms.scale.value = this.pxScale;
    this.popups.clear();
    this.geysers = [];
    this.fires = [];
    this.time = 0;
    this.snapCamera();
  }

  snapCamera() {
    this.updateCamera(1, true);
  }

  cycleCamera() { this.camMode = (this.camMode + 1) % 3; }

  // Converts sim events into effects. Returns nothing; audio is handled elsewhere.
  handle(e) {
    const P = this.particles;
    if (e.type === 'break') {
      const v = this.propByBody.get(e.prop);
      if (!v) return;
      const base = new THREE.Vector3(e.vx, 0, e.vz);
      this.debris.explode(v.group, base, 1 + Math.min(2, e.impact / 6));
      this.scene.remove(v.group);
      P.sparks(e.x, 0.6, e.z, 8, 3);
      const name = e.prop.def.name;
      if (e.prop.type === 'hydrant') this.geysers.push({ x: e.prop.body.x, z: e.prop.body.z, t: 25 });
      if (e.prop.type === 'meter') P.coins(e.x, 1, e.z, 14);
      if (e.prop.type === 'fruit') this.debris.burst(e.x, 1, e.z, [EGA.lred, EGA.yellow, EGA.lgreen, 0xff8800], 20, 6, base.clone().normalize());
      if (e.by && e.by.isPlayer) this.popups.add(`${name}! +$${e.prop.def.value}`, e.x, 2, e.z, '#ff55ff');
      this.shake = Math.max(this.shake, Math.min(0.5, e.impact * 0.04));
    } else if (e.type === 'ding') {
      if (e.impact > 0.6) P.sparks(e.x, 0.6, e.z, Math.round(4 + e.impact * 3), 2 + e.impact);
      if (e.car.isPlayer) {
        const words = e.impact > 6 ? ['KA-BLAM!', 'CRUNCH!!', 'OH NO.'] : e.impact > 2.5 ? ['CRUNCH!', 'BONK!', 'WHAM!'] : ['DING!', 'TINK!', 'BOOP.'];
        this.popups.add(words[Math.floor(Math.random() * words.length)], e.x, 1.6, e.z, e.impact > 2.5 ? '#ff5555' : '#ffff55', 1 + Math.min(1, e.impact / 6));
        this.shake = Math.max(this.shake, Math.min(0.8, e.impact * 0.06));
      }
    } else if (e.type === 'wreck') {
      const v = this.parkedViews.find((pv) => pv.parked === e.parked);
      if (v) {
        v.body.traverse((o) => { if (o.isMesh) o.material = charred(o.material); });
        // pop the wheels off for comedy
        for (const w of v.wheels) {
          this.debris.explode(w.pivot, new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6), 1.6);
        }
        v.wheels = [];
        v.body.position.y = -0.3;
      }
      this.debris.burst(e.x, 1, e.z, [EGA.dgray, EGA.black, EGA.lred], 18, 9);
      for (let i = 0; i < 40; i++) P.fire(e.x, 0.6 + Math.random(), e.z);
      for (let i = 0; i < 20; i++) P.smoke(e.x, 1.5, e.z, true);
      this.fires.push({ x: e.x, z: e.z, t: 12, parked: e.parked });
      this.popups.add('KABOOM! +$5000', e.x, 2.5, e.z, '#ff5555', 1.6);
      this.flash = 0.6;
      this.shake = 1.0;
    } else if (e.type === 'smash') {
      const dir = new THREE.Vector3(-e.nx, 0.2, -e.nz);
      this.debris.burst(e.x, 0.8, e.z, [EGA.lcyan, EGA.white, EGA.brown], Math.round(6 + e.impact * 2), 3 + e.impact * 0.6, dir);
      this.popups.add('SMASH!', e.x, 2, e.z, '#55ffff', 1.3);
      this.shake = Math.max(this.shake, 0.4);
    } else if (e.type === 'curb' && e.car.isPlayer) {
      this.popups.add('CURB HOP!', e.car.body.x, 1.8, e.car.body.z, '#ffffff');
      this.shake = Math.max(this.shake, 0.2);
    } else if (e.type === 'parked') {
      const b = e.car.body;
      P.confetti(b.x, 2, b.z, e.car.isPlayer ? 120 : 40);
      this.popups.add(e.car.isPlayer ? 'PARKED!' : 'THEY PARKED!', b.x, 3, b.z, e.car.isPlayer ? '#55ff55' : '#ff55ff', 2);
    }
  }

  update(dt, input) {
    this.time += dt;
    const w = this.world;
    for (const v of this.carViews) this.syncCar(v, dt);
    for (const v of this.parkedViews) {
      const b = v.parked.body;
      v.root.position.set(b.x, 0, b.z);
      v.root.rotation.y = -b.a;
      if (v.parked.damage > 60 && !v.parked.wrecked && Math.random() < dt * 4) this.particles.smoke(b.x, 1.2, b.z);
    }
    for (const g of this.geysers) {
      g.t -= dt;
      for (let i = 0; i < 4; i++) this.particles.water(g.x, 0.5, g.z);
    }
    this.geysers = this.geysers.filter((g) => g.t > 0);
    for (const f of this.fires) {
      f.t -= dt;
      const b = f.parked.body;
      this.particles.fire(b.x, 1.0, b.z);
      if (Math.random() < 0.5) this.particles.smoke(b.x, 1.6, b.z, true);
    }
    this.fires = this.fires.filter((f) => f.t > 0);

    // player smoke when badly damaged
    const p = w.player;
    if (p.damage > 80 && Math.random() < dt * 8) {
      const fx = p.body.x + Math.cos(p.body.a) * p.spec.length * 0.4, fz = p.body.z + Math.sin(p.body.a) * p.spec.length * 0.4;
      this.particles.smoke(fx, p.spec.height * 0.8, fz, p.damage > 200);
    }

    for (const m of this.markers) {
      const s = m.userData.sign;
      s.position.y = 3.6 + Math.abs(Math.sin(this.time * 3)) * 0.6;
      s.rotation.y = this.time * 1.5;
    }

    this.debris.kick(w.cars);
    this.debris.update(dt);
    this.particles.update(dt);
    this.updateCamera(dt, false);
    this.popups.update(dt);

    // keep the sun's shadow box around the player
    this.sun.position.set(p.body.x - 30, 60, p.body.z + 25);
    this.sun.target.position.set(p.body.x, 0, p.body.z);

    this.flash = Math.max(0, this.flash - dt * 2.5);
    const u = this.post.material.uniforms;
    u.ega.value = this.ega ? 1 : 0;
    u.flash.value = this.flash;
    this.post.render(this.scene, this.camera);
  }

  syncCar(v, dt) {
    const c = v.car, b = c.body;
    // ride height from wheels on the sidewalk
    const h = c.wheelH.map((x) => x * SIDEWALK_H);
    const front = (h[0] + h[1]) / 2, rear = (h[2] + h[3]) / 2;
    const right = (h[0] + h[3]) / 2, left = (h[1] + h[2]) / 2;
    const y = (front + rear) / 2;
    v.root.position.set(b.x, y, b.z);
    v.root.rotation.set(0, -b.a, 0);
    const pitch = Math.atan2(front - rear, c.spec.wheelbase);
    const roll = Math.atan2(right - left, c.spec.width);
    // body lean from acceleration and steering, for cartoon wobble
    const targetRoll = -c.speed * Math.tan(c.steer) * 0.012;
    v.roll += (targetRoll - v.roll) * Math.min(1, dt * 6);
    v.body.rotation.set(v.roll - roll, 0, pitch);
    v.dist += c.speed * dt;
    for (const w of v.wheels) {
      if (w.front) w.pivot.rotation.y = -c.steer;
      w.wheel.rotation.z = -v.dist / v.radius;
    }
  }

  updateCamera(dt, snap) {
    const p = this.world.player;
    const b = p.body;
    const fx = Math.cos(b.a), fz = Math.sin(b.a);
    const L = p.spec.length;
    let pos, look;
    if (this.camMode === 0) { // chase
      const back = 6 + L * 0.9;
      pos = new THREE.Vector3(b.x - fx * back, 4.2 + L * 0.35, b.z - fz * back);
      look = new THREE.Vector3(b.x + fx * 3, 0.8, b.z + fz * 3);
    } else if (this.camMode === 1) { // high chase view, good for judging gaps
      pos = new THREE.Vector3(b.x - fx * (4 + L), 11 + L, b.z - fz * (4 + L));
      look = new THREE.Vector3(b.x + fx * 2, 0, b.z + fz * 2);
    } else { // top down, street-aligned: driving direction to the right, curb at the bottom
      pos = new THREE.Vector3(b.x, 18 + L * 1.5, b.z + 0.01);
      look = new THREE.Vector3(b.x, 0, b.z);
    }
    this.camera.up.set(0, 1, 0);
    if (this.camMode === 2) this.camera.up.set(0, 0, -1);
    const k = snap ? 1 : 1 - Math.exp(-dt * (this.camMode === 0 ? 4 : 6));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this.camera.lookAt(this.camLook);
  }

  // Simple idle render used behind menus.
  renderIdle(dt) {
    if (!this.world) return;
    this.time += dt;
    // slow cinematic pan down the middle of the street
    const lv = this.world.level;
    const span = lv.xMax - lv.xMin - 30;
    const x = lv.xMin + 15 + ((this.time * 2.5) % span);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(x, 4.5 + Math.sin(this.time * 0.3), -1.5);
    this.camera.lookAt(x + 12, 1.2, 3);
    this.particles.update(dt);
    this.debris.update(dt);
    this.post.material.uniforms.ega.value = this.ega ? 1 : 0;
    this.post.material.uniforms.flash.value = 0;
    this.post.render(this.scene, this.camera);
  }
}

const charCache = new Map();
function charred(m) {
  if (!m.color) return m;
  const key = m.color.getHex();
  if (!charCache.has(key)) {
    const c = m.clone();
    c.color = m.color.clone().multiplyScalar(0.18);
    charCache.set(key, c);
  }
  return charCache.get(key);
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const bands = ['#0000aa', '#0000aa', '#5555ff', '#5555ff', '#55ffff', '#55ffff', '#ffffff'];
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i / bands.length) * 64, 4, 64 / bands.length + 1); });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addClouds(scene, level) {
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      g.add(box(4 + Math.random() * 5, 2 + Math.random() * 1.5, 3 + Math.random() * 3, EGA.white, k * 3 - n * 1.5, Math.random(), Math.random() * 2, { basic: true }));
    }
    g.position.set(level.xMin + Math.random() * (level.xMax - level.xMin), 35 + Math.random() * 20, (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 60));
    g.traverse((o) => { o.castShadow = false; });
    scene.add(g);
  }
}

export { centreAhead };
